import type { RagWorkerJob, RagWorkerResponse } from './worker/rag.worker.types'
import { EmbeddingProvider } from './embedding-provider'
import { LocalEmbeddingProvider } from './local-embedding-provider'
import { ApiEmbeddingProvider } from './api-embedding-provider'

/**
 * Service to manage the RAG Web Worker and Embedding Provider
 * Handles lifecycle of the worker, job dispatching, and embedding generation
 */
export class RagService {
  private worker: Worker | null = null
  private jobs: Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }> =
    new Map()
  private embeddingProvider: EmbeddingProvider | null = null
  private initPromise: Promise<void> | null = null

  constructor() {
    this.initWorker()
  }

  /**
   * Configure the embedding provider
   */
  async configureProvider(type: 'local' | 'api', apiKey?: string): Promise<void> {
    if (type === 'local') {
      this.embeddingProvider = new LocalEmbeddingProvider()
    } else {
      if (!apiKey) {
        console.warn('[RagService] API provider selected but no key provided')
        return
      }
      this.embeddingProvider = new ApiEmbeddingProvider(apiKey)
    }

    await this.embeddingProvider.init()
    
    // Start background embedding generation for chunks that need it (e.g., extracted PDFs)
    this.startBackfill()
  }

  private initWorker(): void {
    try {
      // Use '?worker' suffix and types-only import for the worker script
      this.worker = new Worker(new URL('./worker/rag.worker.ts', import.meta.url), {
        type: 'module'
      })

      this.worker.onmessage = (event: MessageEvent<RagWorkerResponse>) => {
        const { id, success, payload, error } = event.data
        const job = this.jobs.get(id)

        if (job) {
          if (success) {
            job.resolve(payload)
          } else {
            job.reject(new Error(error))
          }
          this.jobs.delete(id)
        }
      }

      this.worker.onerror = (err) => {
        console.error('[RagService] Worker error:', err)
      }
    } catch (err) {
      console.error('[RagService] Failed to initialize worker:', err)
    }
  }

  /**
   * Dispatch a job to the worker
   */
  public async dispatch<T>(
    type: RagWorkerJob['type'],
    payload: unknown,
    timeoutMs: number = 120000
  ): Promise<T> {
    if (!this.worker) this.initWorker()
    if (!this.worker) throw new Error('RAG Worker not available')

    const id = crypto.randomUUID()

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.jobs.has(id)) {
          this.jobs.delete(id)
          reject(new Error(`RAG Worker timed out (${type})`))
        }
      }, timeoutMs)

      this.jobs.set(id, {
        resolve: (val: unknown) => {
          clearTimeout(timeout)
          resolve(val as T)
        },
        reject: (err: Error) => {
          clearTimeout(timeout)
          reject(err)
        }
      })
      this.worker!.postMessage({ id, type, payload })
    })
  }

  /**
   * Initialize the RAG system (Worker + DB)
   */
  async init(): Promise<void> {
    if (!this.embeddingProvider) {
      await this.configureProvider('local')
    }
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      // Init model check can take a long time on cold boot (downloads)
      // We give it 5 minutes instead of 2.
      await this.dispatch('init', {}, 300000)
    })()

    return this.initPromise
  }

  async search(
    query: string,
    limit: number = 5
  ): Promise<{ id: string; score: number; metadata: { title: string; path?: string } }[]> {
    if (!this.embeddingProvider) {
      // RAG is disabled, return empty to trigger TF-IDF fallback
      return []
    }

    try {
      if (this.embeddingProvider instanceof LocalEmbeddingProvider) {
        return this.dispatch('search', { query, limit })
      } else {
        const queryVector = await this.embeddingProvider.embed(query)
        // Ensure we still pass the query string for feedback matching
        return this.dispatch('search', { queryVector, query, limit })
      }
    } catch (err) {
      console.error('[RagService] Search failed:', err)
      return []
    }
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.embeddingProvider) {
      return null
    }
    try {
      if (this.embeddingProvider instanceof LocalEmbeddingProvider) {
        return this.dispatch('embed', { text })
      } else {
        return await this.embeddingProvider.embed(text)
      }
    } catch (err) {
      console.error('[RagService] Embed failed:', err)
      return null
    }
  }

  /**
   * Record user feedback for a search result
   * @param query The original query string
   * @param noteId The ID of the note being rated
   * @param score +1 for positive, -1 for negative
   */
  async recordFeedback(query: string, noteId: string, score: number): Promise<void> {
    try {
      await this.dispatch('add-feedback', { query, noteId, score })
    } catch (err) {
      console.error('[RagService] Failed to record feedback:', err)
    }
  }

  async indexNote(
    noteId: string,
    content: string,
    metadata: { title: string; path?: string; updatedAt?: number },
    contentHash?: string
  ): Promise<void> {
    if (!this.embeddingProvider) return

    // Skip indexing if content is empty or only whitespace
    if (!content || !content.trim()) {
      return
    }

    try {
      if (this.embeddingProvider instanceof LocalEmbeddingProvider) {
        await this.dispatch('index', { id: noteId, content, metadata, updatedAt: metadata?.updatedAt, contentHash })
      } else {
        const vector = await this.embeddingProvider.embed(content)
        await this.dispatch('index', { id: noteId, vector, metadata, updatedAt: metadata?.updatedAt, contentHash })
      }
    } catch (err) {
      console.error(`[RagService] Failed to index note ${noteId}:`, err)
    }
  }

  async updateMetadata(noteId: string, updatedAt: number, contentHash?: string): Promise<void> {
    try {
      await this.dispatch('update-metadata', { id: noteId, updatedAt, contentHash })
    } catch (err) {
      console.error(`[RagService] Failed to update metadata for note ${noteId}:`, err)
    }
  }

  async deleteNote(noteId: string): Promise<void> {
    try {
      await this.dispatch('delete', { id: noteId })
    } catch (err) {
      console.error(`[RagService] Failed to delete note ${noteId}:`, err)
    }
  }

  async getStats(): Promise<{ count: number; modelLoaded: boolean; dbName: string }> {
    return this.dispatch('debug', {})
  }

  async getAllMetadata(): Promise<Record<string, { updatedAt: number; contentHash?: string }>> {
    return this.dispatch('get-all-metadata', {})
  }

  async switchVault(vaultPath: string): Promise<void> {
    // Basic hash-like key from path
    const dbName = `vectors-${vaultPath.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
    await this.dispatch('switch-vault', { dbName })
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    window.removeEventListener('beforeunload', this.handleUnload)
    if (this.backfillTimer) {
      clearInterval(this.backfillTimer)
      this.backfillTimer = null
    }
  }
  private backfillTimer: number | null = null
  private isBackfilling = false

  private async startBackfill(): Promise<void> {
    if (this.backfillTimer) return
    
    const runBackfill = async () => {
      if (!this.embeddingProvider || !window.api.extractor.getUnembeddedChunks || this.isBackfilling) return
      
      this.isBackfilling = true
      try {
        const res = await window.api.extractor.getUnembeddedChunks(10)
        if (res.success && res.chunks && res.chunks.length > 0) {
          for (const chunk of res.chunks) {
            // We use standard embed here. We will throttle the loop slightly to let high-priority items slip through.
            const vector = await this.embeddingProvider.embed(chunk.content)
            await window.api.extractor.updateChunkEmbedding(chunk.id, vector)
            // Yield to the event loop so other worker messages (like search) can be processed
            await new Promise(r => setTimeout(r, 100))
          }
        }
      } catch (err) {
        // Silently ignore backfill errors
      } finally {
        this.isBackfilling = false
      }
    }
    
    // Run backfill every 2 seconds
    this.backfillTimer = setInterval(runBackfill, 2000) as unknown as number
    // Run immediately once
    setTimeout(runBackfill, 1000)
  }
}

export const ragService = new RagService()

if (typeof window !== 'undefined') {
  ;(window as any).ragService = ragService
}
