import { extname, basename } from 'path'
import type { Extractor, ExtractedDocument } from '../types'

/**
 * Text Extractor — handles plain-text and code file types.
 *
 * Reads the file as UTF-8 and returns the content directly.
 * Extracts basic metadata: character count, line count.
 */
export class TextExtractor implements Extractor {
  type = 'text'

  supportedExtensions = [
    '.txt',
    '.md',
    '.mdx',
    '.csv',
    '.tsv',
    '.json',
    '.jsonc',
    '.xml',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.env',
    '.env.example',
    '.env.local',
    '.log',
    '.sql',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.rb',
    '.php',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.dart',
    '.swift',
    '.m',
    '.mm',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.html',
    '.sh',
    '.bash',
    '.zsh',
    '.bat',
    '.ps1',
    '.makefile',
    'dockerfile',
    '.gitignore',
    '.gitattributes',
    '.editorconfig',
    '.prettierrc',
    '.eslintrc',
    '.npmrc',
    '.nvmrc',
    '.gradle',
    '.gradle.kts',
    '.ipynb',
    '.r',
    '.pl',
    '.lua',
    '.hs'
  ]

  async extract(filePath: string, buffer: Buffer): Promise<ExtractedDocument> {
    const content = buffer.toString('utf-8')
    const name = basename(filePath)
    const ext = extname(filePath).toLowerCase()

    return {
      content,
      metadata: {
        charCount: content.length,
        lineCount: content.split('\n').length,
        encoding: 'utf-8'
      },
      fileType: ext || 'txt',
      fileName: name,
      fileSize: buffer.length,
      vaultPath: ''
    }
  }
}
