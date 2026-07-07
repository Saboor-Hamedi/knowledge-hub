import { EmbeddingProvider } from './embedding-provider'
import { ragService } from './ragService'

/**
 * Local embedding provider using Transformers.js via Web Worker.
 * Delegates the actual embedding logic to the RagService/Worker
 * to avoid main thread blocking and Vite path issues.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  constructor() {
    // No-op - logic moved to worker
  }

  async init(): Promise<void> {
    // Shared with RagService.init()
    return Promise.resolve()
  }

  async embed(text: string): Promise<number[]> {
    // Delegate to RagService which talks to the worker
    return (ragService as any).dispatch('embed', { text })
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}
