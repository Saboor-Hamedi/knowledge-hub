import type { TextChunk } from './types'

/**
 * Rough token count estimation (4 chars ≈ 1 token for English text).
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Split text into overlapping chunks targeting ~500 tokens each.
 *
 * Strategy:
 *  1. Split on double-newlines (paragraph boundaries) first.
 *  2. Accumulate paragraphs until the chunk reaches the target size.
 *  3. If a single paragraph exceeds the target, split it by sentences.
 *  4. If a single sentence exceeds the target, hard-split by approximate token count.
 *  5. Apply a small overlap (10%) between consecutive chunks for context continuity.
 */
export function chunkText(
  text: string,
  targetTokens: number = 200,
  _overlapTokens: number = 30
): TextChunk[] {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)

  const chunks: TextChunk[] = []
  let current: string[] = []
  let currentTokens = 0

  function flushCurrent(): void {
    if (current.length === 0) return
    const combined = current.join('\n\n')
    chunks.push({ content: combined, tokenCount: estimateTokenCount(combined) })
    current = []
    currentTokens = 0
  }

  for (const para of paragraphs) {
    const paraTokens = estimateTokenCount(para)

    if (paraTokens >= targetTokens) {
      flushCurrent()
      // Split large paragraph by sentences
      const sentences = para.match(/[^.!?\n]+[.!?]*\s*/g) || [para]
      let sentBuf: string[] = []
      let sentTokens = 0

      for (const sentence of sentences) {
        const st = estimateTokenCount(sentence)
        if (sentTokens + st > targetTokens && sentBuf.length > 0) {
          chunks.push({
            content: sentBuf.join(' '),
            tokenCount: estimateTokenCount(sentBuf.join(' '))
          })
          // Keep some sentences for overlap
          const overlapSentences = sentBuf.slice(-Math.max(1, Math.floor(sentBuf.length * 0.2)))
          sentBuf = [...overlapSentences]
          sentTokens = estimateTokenCount(overlapSentences.join(' '))
        }
        sentBuf.push(sentence.trim())
        sentTokens += st
      }
      if (sentBuf.length > 0) {
        chunks.push({
          content: sentBuf.join(' '),
          tokenCount: estimateTokenCount(sentBuf.join(' '))
        })
      }
    } else if (currentTokens + paraTokens > targetTokens) {
      flushCurrent()
      // Start new chunk with overlap from the end of the previous chunk
      if (chunks.length > 0) {
        const lastChunk = chunks[chunks.length - 1]
        const overlapText = lastChunk.content
          .split(/\n\s*\n/)
          .slice(-Math.max(1, Math.floor(lastChunk.content.split('\n\n').length * 0.15)))
          .join('\n\n')
        current = overlapText.trim() ? [overlapText] : []
        currentTokens = estimateTokenCount(overlapText)
      } else {
        current = []
        currentTokens = 0
      }
      current.push(para)
      currentTokens += paraTokens
    } else {
      current.push(para)
      currentTokens += paraTokens
    }
  }

  flushCurrent()

  // If we got nothing meaningful, fall back to the raw text
  if (chunks.length === 0 && text.trim()) {
    chunks.push({ content: text.trim(), tokenCount: estimateTokenCount(text) })
  }

  return chunks
}
