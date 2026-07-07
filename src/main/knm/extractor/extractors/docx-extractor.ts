import { extname, basename } from 'path'
import type { Extractor, ExtractedDocument } from '../types'

let mammoth: typeof import('mammoth') | null = null

async function getMammoth(): Promise<typeof import('mammoth')> {
  if (!mammoth) {
    mammoth = await import('mammoth')
  }
  return mammoth
}

/**
 * DOCX Extractor — extracts plain text from Word (.docx) files.
 *
 * Uses mammoth to extract raw text content. Extracts basic metadata
 * such as number of paragraphs.
 */
export class DocxExtractor implements Extractor {
  type = 'docx'

  supportedExtensions = ['.docx']

  async extract(filePath: string, buffer: Buffer): Promise<ExtractedDocument> {
    const m = await getMammoth()
    const name = basename(filePath)
    const ext = extname(filePath).toLowerCase()

    const result = await m.extractRawText({ buffer })

    const content = result.value || ''
    const warnings = result.messages || []

    return {
      content,
      metadata: {
        paragraphCount: content.split('\n').filter((l) => l.trim().length > 0).length,
        charCount: content.length,
        warnings: warnings.map((w) => w.message)
      },
      fileType: ext,
      fileName: name,
      fileSize: buffer.length,
      vaultPath: ''
    }
  }
}
