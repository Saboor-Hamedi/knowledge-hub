import { query, queryOne } from './database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DocumentRow {
  id: string
  vault_path: string
  file_name: string
  file_type: string
  file_size: number | null
  metadata: Record<string, unknown>
  content_hash: string | null
  created_at: string
  updated_at: string
}

export interface ChunkRow {
  id: string
  document_id: string
  chunk_index: number
  content: string
  embedding: Float32Array | null
  token_count: number | null
}

export interface DocumentStats {
  total_docs: number
  total_chunks: number
  by_type: Record<string, number>
}

export interface SearchResult {
  chunk_id: string
  document_id: string
  chunk_index: number
  content: string
  vault_path: string
  file_name: string
  file_type: string
  similarity: number
}

// ---------------------------------------------------------------------------
// Documents CRUD
// ---------------------------------------------------------------------------
export async function upsertDocument(doc: {
  vault_path: string
  file_name: string
  file_type: string
  file_size: number | null
  metadata: Record<string, unknown>
  content_hash: string | null
}): Promise<DocumentRow> {
  const rows = await query<DocumentRow>(
    `INSERT INTO documents (vault_path, file_name, file_type, file_size, metadata, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (vault_path)
     DO UPDATE SET
       file_name     = EXCLUDED.file_name,
       file_type     = EXCLUDED.file_type,
       file_size     = EXCLUDED.file_size,
       metadata      = EXCLUDED.metadata,
       content_hash  = EXCLUDED.content_hash,
       updated_at    = NOW()
     RETURNING *`,
    [
      doc.vault_path,
      doc.file_name,
      doc.file_type,
      doc.file_size,
      JSON.stringify(doc.metadata),
      doc.content_hash
    ]
  )
  return rows[0]
}

export async function getDocumentByPath(vaultPath: string): Promise<DocumentRow | null> {
  return queryOne<DocumentRow>('SELECT * FROM documents WHERE vault_path = $1', [vaultPath])
}

export async function getDocumentById(id: string): Promise<DocumentRow | null> {
  return queryOne<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id])
}

export async function getAllDocuments(): Promise<DocumentRow[]> {
  return query<DocumentRow>('SELECT * FROM documents ORDER BY updated_at DESC')
}

export async function deleteDocumentByPath(vaultPath: string): Promise<void> {
  await query('DELETE FROM documents WHERE vault_path = $1', [vaultPath])
}

export async function deleteDocumentById(id: string): Promise<void> {
  await query('DELETE FROM documents WHERE id = $1', [id])
}

// ---------------------------------------------------------------------------
// Chunks CRUD
// ---------------------------------------------------------------------------
export async function insertChunks(
  chunks: {
    document_id: string
    chunk_index: number
    content: string
    embedding: Float32Array | null
    token_count: number | null
  }[]
): Promise<void> {
  if (chunks.length === 0) return

  const placeholders: string[] = []
  const values: unknown[] = []
  let idx = 1

  for (const c of chunks) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`)
    values.push(
      c.document_id,
      c.chunk_index,
      c.content,
      c.embedding ? Buffer.from(c.embedding.buffer) : null,
      c.token_count
    )
    idx += 5
  }

  // Delete existing chunks for this document first, then insert
  await query('DELETE FROM embedding_documents WHERE document_id = $1', [chunks[0].document_id])

  await query(
    `INSERT INTO embedding_documents (document_id, chunk_index, content, embedding, token_count)
     VALUES ${placeholders.join(', ')}`,
    values
  )
}

export async function getChunksByDocumentId(documentId: string): Promise<ChunkRow[]> {
  return query<ChunkRow>(
    'SELECT * FROM embedding_documents WHERE document_id = $1 ORDER BY chunk_index',
    [documentId]
  )
}

export async function getUnembeddedChunks(limit: number = 50): Promise<ChunkRow[]> {
  return query<ChunkRow>(
    'SELECT * FROM embedding_documents WHERE embedding IS NULL ORDER BY document_id, chunk_index LIMIT $1',
    [limit]
  )
}

export async function updateChunkEmbedding(chunkId: string, embedding: Float32Array): Promise<void> {
  const vectorStr = JSON.stringify(Array.from(embedding))
  await query(
    'UPDATE embedding_documents SET embedding = $1 WHERE id = $2',
    [vectorStr, chunkId]
  )
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
export async function getDocumentStats(): Promise<DocumentStats> {
  const rows = await query<{
    total_docs: number
    total_chunks: number
    by_type: Record<string, number>
  }>(
    `SELECT
       (SELECT COUNT(*) FROM documents) AS total_docs,
       (SELECT COUNT(*) FROM embedding_documents) AS total_chunks,
       COALESCE(
         (SELECT jsonb_object_agg(file_type, cnt)
          FROM (SELECT file_type, COUNT(*) AS cnt FROM documents GROUP BY file_type) sub),
         '{}'::JSONB
       ) AS by_type`
  )
  return rows[0] || { total_docs: 0, total_chunks: 0, by_type: {} }
}

// ---------------------------------------------------------------------------
// Search (pgvector cosine similarity)
// ---------------------------------------------------------------------------
export async function searchChunks(
  embedding: Float32Array,
  limit: number = 10
): Promise<SearchResult[]> {
  // pgvector expects a string format: '[0.1,0.2,...]'
  const vecStr = `[${Array.from(embedding).join(',')}]`
  return query<SearchResult>(
    `SELECT
       dc.id            AS chunk_id,
       dc.document_id,
       dc.chunk_index,
       dc.content,
       d.vault_path,
       d.file_name,
       d.file_type,
       1 - (dc.embedding <=> $1::vector) AS similarity
     FROM embedding_documents dc
     JOIN documents d ON d.id = dc.document_id
     WHERE dc.embedding IS NOT NULL
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $2`,
    [vecStr, limit]
  )
}

// ---------------------------------------------------------------------------
// Hybrid Search (Semantic + Keyword via RRF)
// ---------------------------------------------------------------------------
export async function hybridSearchChunks(
  keywordQuery: string,
  embedding: Float32Array,
  limit: number = 10,
  rrfK: number = 60
): Promise<SearchResult[]> {
  const vecStr = `[${Array.from(embedding).join(',')}]`
  
  // Use Reciprocal Rank Fusion (RRF) to combine semantic and keyword scores.
  // We query both and assign a rank, then compute RRF score = 1 / (k + rank)
  return query<SearchResult>(
    `WITH semantic_search AS (
       SELECT
         dc.id,
         1 - (dc.embedding <=> $1::vector) AS similarity,
         ROW_NUMBER() OVER (ORDER BY dc.embedding <=> $1::vector) AS semantic_rank
       FROM embedding_documents dc
       WHERE dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $1::vector
       LIMIT 100
     ),
     keyword_search AS (
       SELECT
         dc.id,
         ts_rank_cd(to_tsvector('english', dc.content), plainto_tsquery('english', $2)) AS keyword_score,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('english', dc.content), plainto_tsquery('english', $2)) DESC) AS keyword_rank
       FROM embedding_documents dc
       WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', $2)
       ORDER BY keyword_score DESC
       LIMIT 100
     ),
     combined AS (
       SELECT
         COALESCE(s.id, k.id) AS id,
         COALESCE(s.similarity, 0.0) AS similarity,
         COALESCE(1.0 / ($4 + s.semantic_rank), 0.0) +
         COALESCE(1.0 / ($4 + k.keyword_rank), 0.0) AS rrf_score
       FROM semantic_search s
       FULL OUTER JOIN keyword_search k ON s.id = k.id
     )
     SELECT
       dc.id AS chunk_id,
       dc.document_id,
       dc.chunk_index,
       dc.content,
       d.vault_path,
       d.file_name,
       d.file_type,
       c.similarity
     FROM combined c
     JOIN embedding_documents dc ON c.id = dc.id
     JOIN documents d ON d.id = dc.document_id
     ORDER BY c.rrf_score DESC
     LIMIT $3`,
    [vecStr, keywordQuery, limit, rrfK]
  )
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export async function recordFeedback(fb: {
  query_text: string
  chunk_id?: string
  document_id?: string
  score: number
}): Promise<void> {
  await query(
    `INSERT INTO search_feedback (query_text, chunk_id, document_id, score)
     VALUES ($1, $2, $3, $4)`,
    [fb.query_text, fb.chunk_id || null, fb.document_id || null, fb.score]
  )
}
