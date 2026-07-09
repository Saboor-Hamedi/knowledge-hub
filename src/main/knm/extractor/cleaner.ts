/**
 * Utility functions for cleaning up raw extracted text from PDFs and other documents.
 */

export function cleanExtractedText(text: string): string {
  if (!text) return ''

  let cleaned = text

  // 0. Strip null bytes and other control characters Postgres UTF-8 cannot store.
  //    PostgreSQL rejects \x00 (null byte) outright — this is the most common PDF artifact.
  //    Also strip other C0/C1 control chars except tab (\x09), LF (\x0A), CR (\x0D).
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // 1. Remove Table of Contents (TOC) lines
  // Matches lines that end with dots and a number, e.g., "Chapter 1 ..... 12"
  cleaned = cleaned.replace(/^.*(?:\.{3,}|\.\s\.\s\.)\s*\d+\s*$/gm, '')

  // 1.5 Remove pdf-parse page markers (e.g., "-- 1 of 485 --")
  cleaned = cleaned.replace(/^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/gm, '')

  // 2. Remove standalone page numbers or simple header/footer lines
  // Matches lines that are just a number, possibly surrounded by dashes e.g., " 12 ", "- 12 -"
  cleaned = cleaned.replace(/^\s*-?\s*\d+\s*-?\s*$/gm, '')

  // 2.5 Fix PDF hard-wrapping (dirty data)
  // If a line ends with a normal word character and the next line starts with a lowercase letter,
  // join them with a space instead of a newline.
  cleaned = cleaned.replace(/([a-zA-Z,])\n([a-z])/g, '$1 $2')
  
  // 3. Remove excessive whitespace
  // Replace 3 or more newlines with double newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  // 4. Strip References / Bibliography (only if found in the last 25% of the document)
  const referencePatterns = [
    /\n\s*References\s*\n/i,
    /\n\s*Bibliography\s*\n/i,
    /\n\s*Works Cited\s*\n/i,
    /\n\s*REFERENCES\s*\n/
  ]

  // We only want to truncate if the reference section is near the end,
  // to avoid accidentally cutting off a paper that mentions "References" in the intro.
  const thresholdIndex = Math.floor(cleaned.length * 0.75)
  
  for (const pattern of referencePatterns) {
    const match = cleaned.match(pattern)
    if (match && match.index !== undefined && match.index > thresholdIndex) {
      cleaned = cleaned.substring(0, match.index)
      break // truncate on the first one we find near the end
    }
  }

  // 5. Final trim
  return cleaned.trim()
}
