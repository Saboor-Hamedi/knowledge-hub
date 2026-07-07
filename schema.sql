-- ============================================================================
-- KnowledgeHub: Document Extraction Pipeline — PostgreSQL Schema
-- ============================================================================
-- Requirements: PostgreSQL 14+ with pgvector extension installed.
--
-- Install pgvector (on the PostgreSQL server, once):
--   CREATE EXTENSION IF NOT EXISTS vector;
--
-- Then run this entire file against your database to create all tables,
-- indexes, and helper functions.
-- ============================================================================

-- ============================================================================
-- EXTENSION
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- TABLE: documents
-- Stores one row per extracted file from the vault.
-- ============================================================================
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_path    TEXT NOT NULL,                           -- relative path within vault
  file_name     TEXT NOT NULL,                           -- basename with extension
  file_type     TEXT NOT NULL,                           -- pdf|docx|xlsx|csv|txt|md|json|...
  file_size     BIGINT,                                  -- bytes on disk
  content       TEXT NOT NULL,                           -- full extracted plain text
  metadata      JSONB DEFAULT '{}',                      -- { pageCount, author, sheetNames, ... }
  content_hash  TEXT,                                     -- SHA-256 hex digest for change detection
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vault_path)
);
SELECT * FROM documents;
-- ============================================================================
-- TABLE: document_chunks
-- Stores overlapping ~500-token chunks of each document with pgvector
-- embeddings (384 dimensions from MiniLM-L6-v2 via Transformers.js).
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,                            -- ordinal position in document
  content       TEXT NOT NULL,                            -- chunk plain text (~500 tokens)
  embedding     VECTOR(384),                             -- MiniLM-L6-v2 embedding vector
  token_count   INT,                                     -- actual token count for this chunk
  UNIQUE(document_id, chunk_index)
);

-- ============================================================================
-- TABLE: search_feedback
-- Stores user relevance feedback for pgvector search results to allow
-- future fine-tuning or re-ranking.
-- ============================================================================
CREATE TABLE IF NOT EXISTS search_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text    TEXT NOT NULL,
  chunk_id      UUID REFERENCES document_chunks(id) ON DELETE SET NULL,
  document_id   UUID REFERENCES documents(id) ON DELETE SET NULL,
  score         INT NOT NULL CHECK (score IN (-1, 1)),  -- +1 relevant, -1 irrelevant
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Lookup by type and path
CREATE INDEX IF NOT EXISTS idx_documents_type   ON documents(file_type);
CREATE INDEX IF NOT EXISTS idx_documents_hash   ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);

-- Chunk parent lookup
CREATE INDEX IF NOT EXISTS idx_chunks_document   ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_index      ON document_chunks(document_id, chunk_index);

-- pgvector: IVFFlat index for approximate nearest-neighbour search
-- (lists = 100 is a sensible default for up to ~1M vectors; tune as needed)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================================
-- HELPER: delete_document(vault_path TEXT)
-- Removes a document and its chunks by vault path (handy for cleanup).
-- ============================================================================
CREATE OR REPLACE FUNCTION delete_document_by_path(p_vault_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM documents WHERE vault_path = p_vault_path;
END;
$$;

-- ============================================================================
-- HELPER: get_document_stats()
-- Returns summary statistics about extracted documents.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_document_stats()
RETURNS TABLE (
  total_docs     BIGINT,
  total_chunks   BIGINT,
  by_type        JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM documents)::BIGINT AS total_docs,
    (SELECT COUNT(*) FROM document_chunks)::BIGINT AS total_chunks,
    COALESCE(
      (SELECT jsonb_object_agg(file_type, cnt)
       FROM (SELECT file_type, COUNT(*) AS cnt FROM documents GROUP BY file_type) sub),
      '{}'::JSONB
    ) AS by_type;
END;
$$;

-- ============================================================================
-- HELPER: search_documents(query_embedding VECTOR(384), limit INT)
-- Performs cosine similarity search across chunks.
-- ============================================================================
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding VECTOR(384),
  result_limit INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id      UUID,
  document_id   UUID,
  chunk_index   INT,
  content       TEXT,
  vault_path    TEXT,
  file_name     TEXT,
  file_type     TEXT,
  similarity    FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    d.vault_path,
    d.file_name,
    d.file_type,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE dc.embedding IS NOT NULL
  ORDER BY dc.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$;
