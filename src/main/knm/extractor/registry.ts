import { extname } from 'path'
import type { Extractor, ExtractorRegistry } from './types'
import { TextExtractor } from './extractors/text-extractor'
import { PdfExtractor } from './extractors/pdf-extractor'
import { DocxExtractor } from './extractors/docx-extractor'
import { SpreadsheetExtractor } from './extractors/spreadsheet-extractor'

/**
 * Build the extension → extractor lookup map.
 */
let registry: ExtractorRegistry | null = null

export function getRegistry(): ExtractorRegistry {
  if (registry) return registry

  registry = new Map()
  const extractors: Extractor[] = [
    new TextExtractor(),
    new PdfExtractor(),
    new DocxExtractor(),
    new SpreadsheetExtractor()
  ]

  for (const extractor of extractors) {
    for (const ext of extractor.supportedExtensions) {
      registry.set(ext.toLowerCase(), extractor)
    }
  }

  return registry
}

/**
 * Get the appropriate extractor for a given file path.
 * Returns undefined if no extractor supports the extension.
 */
export function getExtractorForFile(filePath: string): Extractor | undefined {
  const ext = extname(filePath).toLowerCase()
  const r = getRegistry()
  return r.get(ext)
}

/**
 * Get all registered extractors.
 */
export function getAllExtractors(): Extractor[] {
  const r = getRegistry()
  const seen = new Set<string>()
  const result: Extractor[] = []

  for (const extractor of r.values()) {
    if (!seen.has(extractor.type)) {
      seen.add(extractor.type)
      result.push(extractor)
    }
  }

  return result
}

/**
 * Check whether a file path has a supported extension.
 */
export function isSupportedFile(filePath: string): boolean {
  return getExtractorForFile(filePath) !== undefined
}
