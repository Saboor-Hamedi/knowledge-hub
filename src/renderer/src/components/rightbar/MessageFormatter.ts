import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { createElement, Copy, Play } from 'lucide'

/**
 * MessageFormatter - Handles markdown rendering, HTML sanitization, and code block formatting
 */
export class MessageFormatter {
  private md: MarkdownIt

  constructor() {
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      breaks: true,
      typographer: true,
      highlight: (str: string, lang: string) => {
        const normalizedLang = lang ? lang.toLowerCase().trim() : ''
        const escaped = this.md.utils.escapeHtml(str)
        const copyIcon = this.createCopyIcon()
        const playIcon = this.createPlayIcon()

        const copyBtn = `<button class="rightbar__code-action rightbar__code-copy" data-action="copy-code" title="Copy code" aria-label="Copy code">${copyIcon}</button>`
        const applyBtn = `<button class="rightbar__code-action rightbar__code-apply" data-action="apply-code" title="Apply to Editor" aria-label="Apply to Editor">${playIcon}</button>`

        const header = `<div class="rightbar__code-header">
          <span class="rightbar__code-lang">${normalizedLang || 'code'}</span>
          <div class="rightbar__code-actions">
            ${applyBtn}
            ${copyBtn}
          </div>
        </div>`

        return `<div class="rightbar__code-block">
          ${header}
          <pre><code class="language-${this.md.utils.escapeHtml(normalizedLang)}" data-lang="${this.md.utils.escapeHtml(normalizedLang)}" data-code="${this.md.utils.escapeHtml(str)}">${escaped}</code></pre>
        </div>`
      }
    })
  }

  private createCopyIcon(): string {
    const svgElement = createElement(Copy, { size: 14, 'stroke-width': 2 })
    return svgElement?.outerHTML || ''
  }

  private createPlayIcon(): string {
    const svgElement = createElement(Play, { size: 14, 'stroke-width': 2, fill: 'currentColor' })
    return svgElement?.outerHTML || ''
  }

  private renderCache = new Map<string, string>()

  format(text: string, isAssistant: boolean, isStreaming: boolean = false): string {
    if (!isAssistant) {
      return this.escapeHtml(text).replace(/\n/g, '<br>')
    }

    // Check cache first for assistant messages (only for non-streaming)
    if (!isStreaming && this.renderCache.has(text)) {
      return this.renderCache.get(text)!
    }

    let processedText = text

    // ANTIGRAVITY FILTER: Detect and hide code blocks that are already in [RUN:] commands
    // This prevents "Duplex Writing" from cluttering the UI.
    const runMatches = Array.from(
      processedText.matchAll(/\[RUN:\s*(\w+)\s+"?(.+?)"?\s+([\s\S]+?)\s*\]/g)
    )
    if (runMatches.length > 0) {
      runMatches.forEach((match) => {
        const commandCode = match[3].trim()
        if (commandCode.length < 20) return // Skip tiny snippets to avoid false positives

        // Normalize command for comparison
        const normalizedCommand = commandCode.replace(/\s+/g, ' ')

        // First, check for Markdown blocks
        const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g
        let innerMatch
        while ((innerMatch = codeBlockRegex.exec(processedText)) !== null) {
          const blockContent = innerMatch[1].trim()
          const normalizedBlock = blockContent.replace(/\s+/g, ' ')

          // MATCH: If block is identical to command, or if command contains this block (surgical)
          if (
            normalizedBlock === normalizedCommand ||
            normalizedCommand.includes(normalizedBlock) ||
            normalizedBlock.includes(normalizedCommand)
          ) {
            processedText = processedText.replace(innerMatch[0], '')
          }
        }

        // Second, check for naked code - DISABLED (too aggressive, causes clipping)
        /*
        if (processedText.includes(commandCode)) {
           processedText = processedText.replace(commandCode, '')
        }
        */
      })

      // Clean up multiple newlines left behind
      processedText = processedText.replace(/\n{3,}/g, '\n\n').trim()
    }

    // 0. Handle [FILE: path] tags (Iterative Headers)
    processedText = processedText.replace(/\[FILE:\s*(.+?)\s*\]/g, (_match, path) => {
      return `<div class="rightbar__file-header">
        <span class="rightbar__file-path">${this.escapeHtml(path)}</span>
      </div>`
    })

    // 1. Handle <thought> tags (minimal technical log)
    // We auto-open the accordion during streaming so the user sees progress
    const isOpen = isStreaming ? 'open' : ''
    processedText = processedText.replace(
      /<thought>\s*([\s\S]*?)(?:<\/thought>|$)/g,
      (_match, content) => {
        return `
        <details class="rightbar__thought-details" ${isOpen}>
          <summary class="rightbar__thought-summary">
            <span class="rightbar__thought-icon">🧠</span>
            <span class="rightbar__thought-label">LOGIC</span>
          </summary>
          <div class="rightbar__thought-content">${this.escapeHtml(content.trim())}</div>
        </details>
      `
      }
    )

    // 2. Clear remaining tool tags from text (Assistant only)
    // ChatRenderer handles tool output formatting separately.
    processedText = processedText.replace(/\[(?:RUN|DONE|TX):\s*[\s\S]*?\]/g, '')

    // 3. Handle @mentions and [[wikilinks]] (Make them interactive)
    processedText = processedText.replace(
      /@([a-zA-Z0-9_\-.]+)|\[\[(.*?)\]\]/g,
      (match, atName, wikiName) => {
        const name = atName || wikiName
        return `<span class="rightbar__message-mention" data-name="${this.escapeHtml(name)}">${this.escapeHtml(match)}</span>`
      }
    )

    const rawHtml = this.md.render(processedText)

    // Sanitize HTML - ensure we allow our custom elements and attributes
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: [
        'class',
        'target',
        'rel',
        'data-lang',
        'data-code',
        'data-action',
        'aria-label',
        'title'
      ],
      ADD_TAGS: ['pre', 'code', 'button', 'svg', 'path', 'rect', 'div', 'span'],
      KEEP_CONTENT: true,
      ALLOW_DATA_ATTR: true
    })

    // Cache the result if the message is "complete" (i.e. not actively being streamed)
    // Note: We cache even partial chunks because we render every 40ms,
    // and caching the previous 40ms worth of work is still a win.
    if (text.length > 0) {
      this.renderCache.set(text, cleanHtml)
      // Basic cache management: Keep it from blowing up
      if (this.renderCache.size > 200) {
        const firstKey = this.renderCache.keys().next().value
        if (firstKey) this.renderCache.delete(firstKey)
      }
    }

    return cleanHtml
  }

  /**
   * Clear the render cache (e.g. when clearing chat)
   */
  clearCache(): void {
    this.renderCache.clear()
  }

  /**
   * Simple HTML escaping helper
   */
  escapeHtml(raw: string): string {
    const div = document.createElement('div')
    div.textContent = raw
    return div.innerHTML
  }
}

export const messageFormatter = new MessageFormatter()
