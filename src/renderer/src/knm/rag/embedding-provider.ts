/**
 * Interface for embedding providers.
 * Allows switching between Local (Transformers.js) and API (OpenAI/DeepSeek) modes easily.
 */
export interface EmbeddingProvider {
  /**
   * Initialize the model (load weights or check API connection)
   */
  init(): Promise<void>

  /**
   * Convert text into a vector embedding
   */
  embed(text: string): Promise<number[]>

  /**
   * Convert multiple texts in batch (for faster indexing)
   */
  embedBatch(texts: string[]): Promise<number[][]>
}
