export interface ExtractedDocument {
  content: string
  metadata: Record<string, unknown>
  fileType: string
  fileName: string
  fileSize: number | null
  vaultPath: string
}

export interface TextChunk {
  content: string
  tokenCount: number
}

export interface EmbeddedChunk {
  content: string
  tokenCount: number
  embedding: Float32Array
}

export interface Extractor {
  type: string
  supportedExtensions: string[]
  extract(filePath: string, buffer: Buffer): Promise<ExtractedDocument>
}

export type ExtractorRegistry = Map<string, Extractor>
