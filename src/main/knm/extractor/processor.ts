import { readFile, stat } from 'fs/promises'
import { relative } from 'path'
import { createHash } from 'crypto'
import type { ExtractedDocument, TextChunk } from './types'
import { getExtractorForFile } from './registry'
import { chunkText } from './chunker'
import { cleanExtractedText } from './cleaner'
import * as db from '../database'

/**
 * Compute SHA-256 hash of a string.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Full extraction pipeline for a single file:
 *  extract → chunk → embed → store in PostgreSQL.
 *
 * @param vaultRoot  Absolute path to the vault root.
 * @param filePath   Absolute path to the file being ingested.
 */
export async function processFile(
  vaultRoot: string,
  filePath: string
): Promise<{ documentId: string; chunkCount: number } | null> {
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  const normalizedVaultRoot = vaultRoot.replace(/\\/g, '/')
  const relPath = normalizedFilePath.startsWith(normalizedVaultRoot) 
    ? relative(vaultRoot, filePath).replace(/\\/g, '/')
    : normalizedFilePath
  const extractor = getExtractorForFile(filePath)

  if (!extractor) {
    console.log(`[Extractor] No extractor for ${relPath} — skipping`)
    return null
  }

  // 1. Read file buffer + stats
  let buffer: Buffer
  let fileSize: number | null
  try {
    buffer = await readFile(filePath)
    const stats = await stat(filePath)
    fileSize = stats.size
  } catch (err) {
    console.error(`[Extractor] Failed to read ${relPath}:`, (err as Error).message)
    return null
  }

  // 2. Extract text content
  let extracted: ExtractedDocument
  try {
    extracted = await extractor.extract(filePath, buffer)
    extracted.vaultPath = relPath
    extracted.fileSize = fileSize
  } catch (err) {
    console.error(`[Extractor] Extraction failed for ${relPath}:`, (err as Error).message)
    return null
  }

  // Sanitize and clean up the raw text
  extracted.content = cleanExtractedText(extracted.content)

  const contentHash = hashContent(extracted.content)

  // 3. Check if unchanged (skip re-indexing)
  const existing = await db.queries.getDocumentByPath(relPath).catch(() => null)
  if (existing && existing.content_hash === contentHash) {
    const existingChunks = await db.queries.getChunksByDocumentId(existing.id).catch(() => [])
    if (existingChunks.length > 0) {
      console.log(`[Extractor] ${relPath} unchanged — skipping`)
      return { documentId: existing.id, chunkCount: existingChunks.length }
    }
  }

  // 4. Chunk the text
  const chunks: TextChunk[] = chunkText(extracted.content, 500, 50)
  console.log(`[Extractor] ${relPath} → ${chunks.length} chunks`)

  // 5. Upsert the document record
  let documentId: string
  try {
    const doc = await db.queries.upsertDocument({
      vault_path: relPath,
      file_name: extracted.fileName,
      file_type: extracted.fileType,
      file_size: extracted.fileSize,
      metadata: extracted.metadata,
      content_hash: contentHash
    })
    documentId = doc.id
  } catch (err) {
    console.error(`[Extractor] DB upsert failed for ${relPath}:`, (err as Error).message)
    return null
  }

  // 6. Generate embeddings for each chunk and insert
  // (Embeddings are generated via Transformers.js — we delegate to the
  // renderer's RAG worker for this. But since we're in the main process,
  // we store chunks without embeddings first; the renderer can backfill
  // embeddings via a separate IPC call.)
  try {
    await db.queries.insertChunks(
      chunks.map((chunk, i) => ({
        document_id: documentId,
        chunk_index: i,
        content: chunk.content,
        embedding: null, // embeddings backfilled by renderer
        token_count: chunk.tokenCount
      }))
    )
  } catch (err) {
    console.error(`[Extractor] Failed to insert chunks for ${relPath}:`, (err as Error).message)
    return null
  }

  console.log(`[Extractor] ✓ ${relPath} stored (doc=${documentId}, ${chunks.length} chunks)`)
  return { documentId, chunkCount: chunks.length }
}

/**
 * Process a file path that was removed — delete from DB.
 */
export async function removeFile(vaultRoot: string, filePath: string): Promise<void> {
  const relPath = relative(vaultRoot, filePath).replace(/\\/g, '/')
  try {
    await db.queries.deleteDocumentByPath(relPath)
    console.log(`[Extractor] ✗ ${relPath} removed from DB`)
  } catch (err) {
    console.error(`[Extractor] Failed to remove ${relPath}:`, (err as Error).message)
  }
}
