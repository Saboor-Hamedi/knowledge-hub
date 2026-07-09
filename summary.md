# Knowledge Hub — Complete Technical Summary

> **Last updated:** July 2026  
> **Stack:** Electron · TypeScript · PostgreSQL + pgvector · Transformers.js · Vite

---

## 1. What is Knowledge Hub?

Knowledge Hub is an **offline-first, AI-powered document intelligence system** built inside an Electron desktop app. It lets you drag in any document — PDF, Word, Excel, CSV, plain text — and then ask questions about your entire document library using natural language. Everything runs locally on your machine. No cloud, no API keys required.

---

## 2. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                      │
│                                                                   │
│  IngestionModal (drag & drop) ──► IPC: extractor:startBatch       │
│                                        │                          │
│                               DocumentProcessor                   │
│                          ┌────────────┼────────────┐              │
│                     PdfExtractor  DocxExtractor  SpreadsheetExt.  │
│                          └────────────┼────────────┘              │
│                                  Chunker (500 tok)                │
│                                       │                           │
│                               PostgreSQL (pg pool)                │
│                          ┌────────────┴────────────┐              │
│                      documents          embedding_documents        │
│                      (1 row/file)       (N chunks + vector)        │
└───────────────────────────────────────────────────────────────────┘
                                  ▲  IPC bridge (preload)
┌───────────────────────────────────────────────────────────────────┐
│                       Electron Renderer Process                   │
│                                                                   │
│   SearchModal (Chat UI)                                           │
│       │                                                           │
│       ├─► ragService.embed(query)                                 │
│       │       └─► Web Worker ──► Transformers.js (MiniLM-L12)     │
│       │               returns: Float32Array[384]                  │
│       │                                                           │
│       └─► window.api.extractor.hybridSearch(query, vec, 3)        │
│               └─► IPC ──► hybridSearchChunks() (Postgres RRF)     │
│                       returns: top-3 chunks with similarity score │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. The Embedding Model — `paraphrase-multilingual-MiniLM-L12-v2`

**Where it lives:** `src/renderer/src/knm/rag/`

The embedding model is loaded **inside a Web Worker** so it never blocks the UI. It runs entirely on the CPU — no GPU needed.

| Property | Value |
|----------|-------|
| Model | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` |
| Library | Transformers.js (ONNX runtime in browser) |
| Output | `Float32Array` of **384 dimensions** |
| Languages | **50+ languages** — Arabic, English, French, German, Chinese, etc. |
| Speed | ~30–150ms per query on modern CPU |
| Download | ~120MB, cached locally after first run |

**How it produces a vector:**

A sentence like *"What is RAG?"* is tokenized → passed through 12 transformer layers → the output is mean-pooled into a single 384-dimensional vector. Two semantically similar sentences will have vectors close together in that 384-dimensional space (measured by cosine similarity).

**Backfill loop:** When you ingest a new document, chunks are stored in Postgres with `embedding = NULL`. The `ragService` runs a background interval every 2 seconds (`startBackfill()`) that picks 10 unembedded chunks at a time, embeds them via the worker, and writes the vector back into Postgres. This means the UI stays responsive while embeddings fill in quietly in the background.

---

## 4. Document Ingestion Pipeline

**Entry point:** `IngestionModal` → drag & drop or Browse Files → IPC call to main process

```
File(s) selected by user
   │
   ▼ src/main/knm/extractor/registry.ts
getExtractorForFile(path) → pick by extension
   │
   ├─ .pdf  → PdfExtractor  (pdf-parse v2)
   ├─ .docx → DocxExtractor (mammoth)
   ├─ .xlsx/.csv → SpreadsheetExtractor (SheetJS)
   └─ .txt/.md/.ts/.py/etc → TextExtractor
   │
   ▼ src/main/knm/extractor/processor.ts
readFile(buffer) → extract() → returns { content, metadata }
   │
   ▼ src/main/knm/extractor/cleaner.ts
cleanExtractedText():
  - Strip null bytes & control chars (fixes Arabic/scanned PDFs)
  - Remove TOC lines (Chapter 1 ........ 12)
  - Remove page number footers
  - Fix PDF hard-wrapping (join broken lines)
  - Collapse excessive whitespace
  - Trim References / Bibliography from end
   │
   ▼ SHA-256 content hash
Compare with stored hash → if unchanged, SKIP (deduplication)
   │
   ▼ src/main/knm/extractor/chunker.ts
Split into ~500-token chunks with 10% overlap
  - Paragraph-aware: tries not to cut mid-paragraph
  - Sentence-aware: tries not to cut mid-sentence
  - Each chunk stores: content, token_count, chunk_index
   │
   ▼ src/main/knm/database/queries.ts
upsertDocument() → INSERT ... ON CONFLICT (vault_path) DO UPDATE
deleteOldChunks() → insertChunks() (embedding = NULL initially)
   │
   ▼ Done — progress bar updates via IPC onProgress events
```

**The file is never copied.** The original path is stored in `vault_path`. Nothing is saved inside the app's internal folder.

---

## 5. The Database Schema

**Two core tables in PostgreSQL:**

### `documents` — one row per file
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vault_path` | TEXT UNIQUE | Absolute path on disk — used as the dedup key |
| `file_name` | TEXT | Display name (e.g., `cookbook.pdf`) |
| `file_type` | TEXT | `.pdf`, `.docx`, etc. |
| `file_size` | BIGINT | Bytes |
| `metadata` | JSONB | Author, page count, sheet names, warnings… |
| `content_hash` | TEXT | SHA-256 of cleaned text — skips re-ingestion if unchanged |
| `created_at` / `updated_at` | TIMESTAMPTZ | Auto-managed |

### `embedding_documents` — N rows per file (the chunks)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `document_id` | UUID FK → documents | Parent document |
| `chunk_index` | INT | Order within the document |
| `content` | TEXT | The 500-token text chunk |
| `embedding` | VECTOR(384) | pgvector column — filled by backfill loop |
| `token_count` | INT | Approximate token count |

### `search_feedback` — user signal (future use)
| Column | Type | Description |
|--------|------|-------------|
| `query_text` | TEXT | What the user searched |
| `chunk_id` | UUID | Which result was rated |
| `score` | INT | +1 (relevant) or -1 (not relevant) |

---

## 6. Hybrid Search — How Queries Work

When you type a query in the chat and press Enter:

1. **Embed the query** — the query string is sent to the Web Worker → MiniLM model → returns `Float32Array[384]`

2. **Hybrid search via RRF (Reciprocal Rank Fusion):**

```sql
-- Semantic arm: cosine similarity via pgvector
WITH semantic_search AS (
  SELECT id, 1 - (embedding <=> $1::vector) AS similarity,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
  FROM embedding_documents WHERE embedding IS NOT NULL
  LIMIT 100
),
-- Keyword arm: PostgreSQL full-text search
keyword_search AS (
  SELECT id, ts_rank_cd(...) AS score,
         ROW_NUMBER() OVER (...) AS rank
  FROM embedding_documents
  WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $2)
  LIMIT 100
),
-- Fusion: RRF score = 1/(60 + semantic_rank) + 1/(60 + keyword_rank)
combined AS (
  SELECT COALESCE(s.id, k.id),
         1/(60 + semantic_rank) + 1/(60 + keyword_rank) AS rrf_score
  FROM semantic_search s FULL OUTER JOIN keyword_search k ON s.id = k.id
)
SELECT ... ORDER BY rrf_score DESC LIMIT 3
```

**Why hybrid?** Pure vector search is great for conceptual similarity ("machine learning" finds "neural networks") but misses exact keyword matches. Full-text search is great for exact words but misses synonyms. RRF combines both — documents that rank high in *both* arms float to the top.

3. **Results returned** — top 3 chunks with `file_name`, `vault_path`, `content`, `similarity` score  
4. **Rendered** — user's query appears as a blue bubble (right), results appear as a clean assistant response (left) with keywords highlighted in amber

---

## 7. The Chat UI — `SearchModal.ts`

**File:** `src/renderer/src/knm/components/SearchModal.ts`  
**Style:** `src/renderer/src/knm/components/search-modal.css`

Key design decisions:
- **Chat history is preserved** within the session — each query appends to the bottom, never replaces
- **Input clears on submit** — ready for the next query immediately
- **Auto-scrolls** to the latest message
- **Keyword highlighting** — each word in the query is highlighted in matching snippets using a regex against the escaped HTML content
- **Animated thinking dots** — three pulsing dots while the embedding + search runs
- **Title bar** — matches the app's window chrome (`var(--panel-strong)`, `var(--border)`, `var(--text-muted)`)
- **Close**: `×` button or `Escape` key

---

## 8. The Ingestion Modal — `IngestionModal.ts`

**File:** `src/renderer/src/knm/components/IngestionModal.ts`  
**Style:** `src/renderer/src/knm/components/ingestion-modal.css`

- Fixed size: `490×470px` — never expands or shrinks
- Title bar matches window chrome
- Drag & drop or Browse Files
- Progress bar (3px thin line) + per-file status dots (grey → pulsing blue → green)
- File list scrolls inside the fixed container

---

## 9. Suggestions — What to Build Next

These are ordered by impact for an **advanced knowledge management system:**

### 🔴 High Impact

#### A. LLM-Powered Answer Synthesis
Right now the system retrieves chunks but doesn't *answer*. The next level is feeding the top-3 chunks into an LLM and generating a cited, conversational answer — true RAG.
- **Local:** Integrate [Ollama](https://ollama.com/) via its REST API (`llama3`, `mistral`, `qwen`)
- **Cloud:** OpenAI / Anthropic / Gemini API (user provides key)
- The response would look like: *"Based on your cookbook, RAG stands for Retrieval-Augmented Generation, which… [Source: cookbook.pdf, p.3]"*

#### B. Document Library / Knowledge Browser
A dedicated panel (not just a search modal) that shows all ingested documents:
- Sortable table: file name, type, date ingested, chunk count, embedding status
- Delete / re-index individual documents
- Preview the extracted text

#### C. Smart Re-ingestion on File Change
Currently re-ingestion is manual. Add a **file watcher** (`chokidar`) on the original file paths. When a PDF changes on disk, automatically re-ingest it silently in the background.

---

### 🟡 Medium Impact

#### D. Conversation Memory (Multi-turn Chat)
Store the last N messages in the session and include them as context for the next search. This allows follow-up questions: *"Tell me more about the second point"* — the system knows what the second point was.

#### E. Document Tags & Collections
Let users group documents into named collections (e.g., "Work", "Research", "Personal"). Searches can be scoped to a collection.

#### F. Annotation Layer
Allow highlighting text in the chat result and saving it as a note in the Markdown vault. Bridges the gap between the knowledge hub and the note editor.

#### G. Similarity Between Documents
*"What documents are similar to this PDF?"* — embed the entire document, find other documents whose chunk vectors are close. Useful for finding duplicates or related reading.

---

### 🟢 Nice to Have

#### H. Export Search Session
Export the current chat session (queries + results) as a Markdown file into the vault.

#### I. Chunk Inspector
A developer-mode panel that shows: which chunks were retrieved, their raw similarity scores, whether they came from the semantic arm or keyword arm of the hybrid search.

#### J. Multi-language Search
The MiniLM model already supports 50+ languages. Add a language selector so users can search in Arabic, French, or Chinese explicitly. Add a `language` column to the `documents` table.

#### K. Audio / Video Transcription
Integrate [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) to transcribe MP3/MP4 files and ingest the transcript as a document. Makes meetings, lectures, and podcasts searchable.

---

## 10. File Map

```
src/
├── main/
│   ├── index.ts                          IPC handlers, app lifecycle
│   ├── settings.ts                       Database + extractor settings
│   └── knm/
│       ├── database/
│       │   ├── database.ts               pg Pool, query() / queryOne()
│       │   ├── migrations.ts             Auto CREATE TABLE IF NOT EXISTS
│       │   ├── queries.ts                CRUD + hybridSearchChunks (RRF)
│       │   └── index.ts                  Re-exports
│       └── extractor/
│           ├── processor.ts              Main pipeline orchestrator
│           ├── chunker.ts                500-token overlap chunker
│           ├── cleaner.ts                Null-byte strip, TOC removal
│           ├── registry.ts               Extension → Extractor map
│           ├── types.ts                  Interfaces
│           └── extractors/
│               ├── pdf-extractor.ts      pdf-parse v2
│               ├── docx-extractor.ts     mammoth
│               ├── spreadsheet-extractor.ts  SheetJS
│               └── text-extractor.ts     Plain text / code / markdown
├── preload/
│   └── index.ts                          IPC bridge (contextBridge)
└── renderer/src/knm/
    ├── rag/
    │   ├── ragService.ts                 Worker lifecycle, embed(), backfill loop
    │   ├── local-embedding-provider.ts   Delegates to worker
    │   ├── api-embedding-provider.ts     OpenAI-compatible API fallback
    │   └── worker/
    │       ├── rag.worker.ts             Transformers.js (MiniLM-L12-v2)
    │       ├── vector-db.ts              In-memory vector store (notes)
    │       └── rag.worker.types.ts       Job/response types
    └── components/
        ├── SearchModal.ts                Chat UI, highlight(), embed → search
        ├── search-modal.css              Chat bubble styles, keyword mark
        ├── IngestionModal.ts             Drag & drop, progress, file list
        └── ingestion-modal.css           Fixed 490×470 modal styles
```
