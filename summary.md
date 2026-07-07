# Document Extraction Pipeline — Summary

## Overview

A complete document extraction pipeline integrated into the KnowledgeHub Electron app. Watches vault directories for new/changed files, extracts plain text from supported formats, and stores results in **PostgreSQL with pgvector** for semantic search.

---

## Files Created

### 1. Root Schema — `schema.sql`

Full PostgreSQL DDL for the extraction pipeline. Includes:

- **`documents`** table — one row per extracted file (vault_path, file_name, file_type, content, metadata JSONB, content_hash)
- **`document_chunks`** table — ~500-token overlapping chunks with `VECTOR(384)` embedding column
- **`search_feedback`** table — user relevance feedback (+1/-1)
- **pgvector IVFFlat index** for cosine similarity search
- **Helper functions**: `delete_document_by_path()`, `get_document_stats()`, `search_chunks()`

Run against your PostgreSQL database before using the app:

```
psql -d knowledgehub -f schema.sql
```

---

### 2. Database Module — `src/main/database/`

| File            | Purpose                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `index.ts`      | Public API, re-exports everything                                                                            |
| `connection.ts` | pg Pool creation, `query()` / `queryOne()` helpers, lifecycle                                                |
| `migrations.ts` | Auto-run `CREATE TABLE IF NOT EXISTS` on app startup                                                         |
| `queries.ts`    | Full CRUD: `upsertDocument`, `insertChunks`, `searchChunks` (pgvector), `getDocumentStats`, `recordFeedback` |

---

### 3. Extractor Module — `src/main/extractor/`

| File                                  | Purpose                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ---- | ----- |
| `index.ts`                            | `DocumentExtractor` class — Chokidar watcher with 1.5s debounce, `extractFile()`, `reindexAll()`  |
| `types.ts`                            | `Extractor` interface, `ExtractedDocument`, `TextChunk`, `EmbeddedChunk`                          |
| `registry.ts`                         | Extension → Extractor mapping, `getExtractorForFile()`, `isSupportedFile()`                       |
| `processor.ts`                        | Pipeline: read buffer → extract → SHA-256 hash check → chunk → upsert document → insert chunks    |
| `chunker.ts`                          | Text → overlapping chunks (~500 tokens, 10% overlap), paragraph/sentence-aware splitting          |
| `extractors/text-extractor.ts`        | `.txt .md .csv .json .xml .yaml .yml .log .ini .env .toml .sql .js .ts .py` and ~50+ code formats |
| `extractors/pdf-extractor.ts`         | `.pdf` — uses pdf-parse v2 (class-based API), extracts text + metadata (Author, Title, etc.)      |
| `extractors/docx-extractor.ts`        | `.docx` — uses mammoth, extracts raw text + paragraph count                                       |
| `extractors/spreadsheet-extractor.ts` | `.xlsx .xls .xlsm .xlsb .ods .csv .tsv` — uses SheetJS, serialises as "SheetName:\n cell          | cell | cell" |

---

### 4. IPC Handlers — `src/main/index.ts`

| Handler               | Function                                               |
| --------------------- | ------------------------------------------------------ |
| `database:connect`    | Initialise pg Pool + run migrations                    |
| `database:disconnect` | Close pool                                             |
| `database:status`     | Connection health + document stats                     |
| `database:query`      | Execute raw SQL (admin use)                            |
| `extractor:start`     | Start Chokidar watcher on vault                        |
| `extractor:stop`      | Stop watcher                                           |
| `extractor:extract`   | One-shot extraction of a single file                   |
| `extractor:reindex`   | Walk entire vault and re-extract all files             |
| `extractor:status`    | Watcher status + DB stats                              |
| `extractor:search`    | pgvector cosine similarity search (takes Float32Array) |

**Auto-lifecycle**: On app start, if `database.autoConnect` is true in settings → connect PG → run migrations → start extractor watcher. On quit → stop watcher → close pool.

---

### 5. Preload Updates — `src/preload/index.ts` + `index.d.ts`

New API surface exposed to the renderer:

```typescript
window.api.database = {
  connect(config?) → { success, message }
  disconnect() → { success }
  getStatus() → DatabaseStatus
  query(sql, params?) → { success, rows }
}

window.api.extractor = {
  start(vaultPath?) → { success, message }
  stop() → { success }
  extractFile(filePath) → { success, chunkCount, error }
  reindex() → { success, processed, failed }
  getStatus() → ExtractorStatus
  search(queryVector, limit?) → { success, results }
}
```

---

### 6. Settings Updates — `src/main/settings.ts`

New settings fields added to the `Settings` type:

```typescript
database?: {
  host?: string        // default: 'localhost'
  port?: number        // default: 5432
  database?: string    // default: 'knowledgehub'
  user?: string        // default: 'postgres'
  password?: string
  autoConnect?: boolean // default: false
}

extractor?: {
  enabled?: boolean     // default: false
  autoExtract?: boolean // default: true
  chunkSize?: number    // default: 500
  chunkOverlap?: number // default: 50
}
```

Also updated `NESTED_SETTING_OBJECTS` list for deep-merge support, and `renderer/src/core/types.ts` for type alignment.

---

### 7. npm Dependencies Added

| Package     | Version | Purpose                            |
| ----------- | ------- | ---------------------------------- |
| `pg`        | ^8.x    | PostgreSQL client                  |
| `pgvector`  | ^0.x    | pgvector type support              |
| `pdf-parse` | ^2.x    | PDF text extraction                |
| `mammoth`   | ^1.x    | DOCX text extraction               |
| `xlsx`      | ^0.18.x | SheetJS — XLSX/XLS/ODS/CSV parsing |
| `@types/pg` | (dev)   | TypeScript types for pg            |

---

## Pipeline Flow

```
Chokidar 'add' / 'change' event
  │  1.5s debounce (prevents cascade on saves)
  ▼
Read file buffer + stat
  ▼
Lookup extractor by extension (.pdf → PdfExtractor, .xlsx → SpreadsheetExtractor, etc.)
  ▼
Extract text + metadata
  ▼
Compute SHA-256 content hash
  ▼
Compare with stored hash → skip if unchanged
  ▼
Chunk text into ~500 token segments (paragraph-aware, 10% overlap)
  ▼
Upsert document row in PostgreSQL
  ▼
Delete old chunks → insert new chunks (embeddings = NULL, backfilled by renderer)
```

**Embeddings**: Chunk embeddings are stored as `NULL` initially. The renderer's existing Transformers.js RAG pipeline can backfill them via the `extractor:search` IPC or by reading unembedded chunks and processing them in the Web Worker.

---

## Verification

To verify everything is working:

1. Run `schema.sql` against your PostgreSQL database
2. Start the app with `database.autoConnect = true` in settings
3. Drop a PDF/DOCX/XLSX file into the vault → watch the console for extraction logs
4. Check PostgreSQL: `SELECT count(*) FROM documents;`
5. Run `npm run typecheck` — should pass with no new errors
