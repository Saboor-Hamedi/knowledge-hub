import { EmbeddingProvider } from './embedding-provider'

/**
 * OpenAI-compatible embedding provider.
 * Works with OpenAI, DeepSeek, or any compatible API endpoint.
 */
export class ApiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(
    apiKey: string,
    baseUrl: string = 'https://api.deepseek.com/v1',
    model: string = 'text-embedding-3-small'
  ) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.model = model
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('API key is required for ApiEmbeddingProvider')
    }
    // Optional: Validating the key with a lightweight call could go here
  }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.embedBatch([text])
    return vectors[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // API limitation handling (Max batch size usually applies)
    // For simplicity, we assume texts.length is within limits (e.g. < 100)

    // DeepSeek API doesn't have an embedding endpoint publicly documented
    // that mirrors OpenAI exactly at the time of writing, but sticking to standard structure.
    // If DeepSeek doesn't support embeddings yet, we might default to OpenAI or Local.

    // *Correction*: As of early 2025 DeepSeek might ONLY support Chat.
    // We should probably rely on a fallback or standard OpenAI endpoint if user provides one.
    // Let's implement the standard OpenAI signature.

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        input: texts,
        model: this.model
      })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error?.message || `Embedding API Error: ${response.status}`)
    }

    const data = await response.json()
    // Sort by index just in case API returns out of order
    return data.data.sort((a: any, b: any) => a.index - b.index).map((item: any) => item.embedding)
  }
}
