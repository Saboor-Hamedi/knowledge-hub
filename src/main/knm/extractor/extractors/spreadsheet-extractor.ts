import { extname, basename } from 'path'
import type { Extractor, ExtractedDocument } from '../types'

let XLSX: typeof import('xlsx') | null = null

async function getXLSX(): Promise<typeof import('xlsx')> {
  if (!XLSX) {
    XLSX = await import('xlsx')
  }
  return XLSX
}

/**
 * Spreadsheet Extractor — extracts text from Excel (.xlsx, .xls, .xlsm),
 * OpenDocument (.ods), and delimited formats (.csv, .tsv).
 *
 * Uses SheetJS (xlsx) to parse all supported formats uniformly.
 * Content is serialised as "SheetName:\n  cell contents per row".
 */
export class SpreadsheetExtractor implements Extractor {
  type = 'spreadsheet'

  supportedExtensions = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv']

  async extract(filePath: string, buffer: Buffer): Promise<ExtractedDocument> {
    const x = await getXLSX()
    const name = basename(filePath)
    const ext = extname(filePath).toLowerCase()

    const workbook = x.read(buffer, { type: 'buffer', cellDates: true })

    const sheetNames = workbook.SheetNames
    const contentParts: string[] = []
    let totalRows = 0
    let totalCols = 0

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue

      const ref = sheet['!ref']
      if (!ref) continue

      const range = x.utils.decode_range(ref)
      const rows = range.e.r - range.s.r + 1
      const cols = range.e.c - range.s.c + 1
      totalRows += rows
      totalCols = Math.max(totalCols, cols)

      // Convert sheet to a 2D array of strings
      const data: string[][] = x.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false
      })

      contentParts.push(`=== Sheet: ${sheetName} (${rows} rows × ${cols} cols) ===`)

      for (const row of data) {
        const line = row
          .map((cell: unknown) => String(cell ?? '').trim())
          .filter(Boolean)
          .join(' | ')
        if (line) {
          contentParts.push(`  ${line}`)
        }
      }

      contentParts.push('')
    }

    return {
      content: contentParts.join('\n'),
      metadata: {
        sheetNames,
        sheetCount: sheetNames.length,
        totalRows,
        totalCols
      },
      fileType: ext,
      fileName: name,
      fileSize: buffer.length,
      vaultPath: ''
    }
  }
}
