import { basename } from 'path'
import type { Extractor, ExtractedDocument } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PDFParseClass: any = null

async function getPDFParseClass(): Promise<any> {
  if (!PDFParseClass) {
    // Polyfill missing DOM classes for pdf.js in Node.js Main Process
    if (typeof globalThis.DOMMatrix === 'undefined') {
      globalThis.DOMMatrix = class DOMMatrix {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        constructor(args?: any) {
          if (args && args.length === 6) {
            this.a = args[0]; this.b = args[1]; this.c = args[2];
            this.d = args[3]; this.e = args[4]; this.f = args[5];
          }
        }
      } as any
    }
    if (typeof globalThis.ImageData === 'undefined') {
      globalThis.ImageData = class ImageData {} as any
    }
    if (typeof globalThis.Path2D === 'undefined') {
      globalThis.Path2D = class Path2D {} as any
    }

    const mod = (await import('pdf-parse')) as any
    // Handle ESM/CommonJS interop by checking for default
    PDFParseClass = mod.default || mod.PDFParse || mod
  }
  return PDFParseClass
}

/**
 * PDF Extractor — extracts plain text from PDF files.
 *
 * Uses pdf-parse v2 (class-based) to extract text content
 * and metadata from PDF documents.
 */
export class PdfExtractor implements Extractor {
  type = 'pdf'

  supportedExtensions = ['.pdf']

  async extract(_filePath: string, buffer: Buffer): Promise<ExtractedDocument> {
    const PClass = await getPDFParseClass()
    const name = basename(_filePath)
    
    let text = ''
    let metadata: Record<string, unknown> = {}
    
    try {
      // Some versions/forks of pdf-parse export a class, others a function
      let isClass = false
      
      try {
        // Test if it's a class by looking at its string representation or prototype
        if (PClass.prototype && PClass.prototype.load) {
          isClass = true
        } else if (PClass.toString().indexOf('class') === 0) {
          isClass = true
        }
      } catch (e) {
        // Ignore
      }

      if (!isClass && typeof PClass === 'function') {
        try {
          // Standard pdf-parse API (v1)
          const data = await PClass(buffer)
          text = data.text || ''
          metadata = data.info || {}
        } catch (err: any) {
          if (err && err.message && err.message.includes("cannot be invoked without 'new'")) {
            isClass = true // Fallback to class mode
          } else {
            throw err
          }
        }
      } 
      
      if (isClass || typeof PClass !== 'function') {
        // Class based API (v2 or fork)
        const instance = new PClass({ verbosity: 0, data: new Uint8Array(buffer) })
        await instance.load()
        const rawText: any = await instance.getText()
        text = typeof rawText === 'string' ? rawText : (rawText.text || '')
        let info: Record<string, unknown> = {}
        try {
          info = (await instance.getInfo()) || {}
        } catch {}
        
        for (const key of ['Author', 'Title', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Pages']) {
          if (info[key] !== undefined) {
            metadata[key.toLowerCase()] = info[key]
          }
        }
        if (typeof instance.destroy === 'function') {
          instance.destroy()
        }
      }
    } catch (err) {
      console.error(`[PdfExtractor] Failed to parse PDF: ${err}`)
      throw err
    }

    return {
      content: text || '',
      metadata,
      fileType: 'pdf',
      fileName: name,
      fileSize: buffer.length,
      vaultPath: ''
    }
  }
}
