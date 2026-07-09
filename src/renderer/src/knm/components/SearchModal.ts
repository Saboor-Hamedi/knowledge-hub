import './search-modal.css'
import { formatMarkdown } from '../../utils/markdown'
import { aiProviderManager } from '../../services/ai/provider-manager'

export class SearchModal {
  private container: HTMLElement
  private overlay: HTMLElement

  constructor() {
    this.overlay = document.createElement('div')
    this.overlay.className = 'search-overlay'
    this.overlay.style.display = 'none'

    this.container = document.createElement('div')
    this.container.className = 'search-modal'

    this.overlay.appendChild(this.container)
    document.body.appendChild(this.overlay)

    this.render()
    this.setupListeners()
  }

  show(): void {
    this.overlay.style.display = 'flex'
    const input = this.container.querySelector('#search-input') as HTMLInputElement
    if (input) setTimeout(() => input.focus(), 50)
  }

  hide(): void {
    this.overlay.style.display = 'none'
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="km-titlebar">
        <span class="km-titlebar__title">Knowledge Hub</span>
        <div class="km-titlebar__right">
          <span class="km-titlebar__hint">esc to close</span>
          <button class="km-titlebar__close" id="km-close-btn">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M9 1L1 9M1 1l8 8"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="km-chat-messages" id="km-chat-messages">
        <div class="km-welcome" id="km-welcome">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <p>Search your Knowledge Hub</p>
        </div>
      </div>
      <div class="km-input-bar">
        <div class="km-input-wrap">
          <input id="search-input" type="text" placeholder="Ask anything about your documents..." autocomplete="off" />
          <button id="km-send" class="km-send-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    `
  }

  private setupListeners(): void {
    // Close on backdrop click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })

    const input = this.container.querySelector('#search-input') as HTMLInputElement
    const sendBtn = this.container.querySelector('#km-send') as HTMLButtonElement
    const closeBtn = this.container.querySelector('#km-close-btn') as HTMLButtonElement

    if (closeBtn) closeBtn.addEventListener('click', () => this.hide())

    const submit = () => {
      const q = input.value.trim()
      if (!q) return
      input.value = ''
      sendBtn.disabled = true
      this.runSearch(q).finally(() => { sendBtn.disabled = false })
    }

    sendBtn.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit() }
    })

    // Global ESC key to close modal when active
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.style.display !== 'none') {
        this.hide()
      }
    })

    // Clear highlights on click anywhere in the container
    this.container.addEventListener('click', () => {
      this.container.querySelectorAll('.km-highlight.km-active').forEach(el => {
        el.classList.remove('km-active')
      })
    })
  }

  private scrollToBottom(): void {
    const el = this.container.querySelector('#km-chat-messages') as HTMLElement
    if (el) el.scrollTop = el.scrollHeight
  }

  private addMessage(html: string, role: 'user' | 'assistant'): HTMLElement {
    const welcome = this.container.querySelector('#km-welcome') as HTMLElement
    if (welcome) welcome.style.display = 'none'

    const msgs = this.container.querySelector('#km-chat-messages') as HTMLElement
    const row = document.createElement('div')
    row.className = `km-row km-row--${role}`
    row.innerHTML = html
    msgs.appendChild(row)
    this.scrollToBottom()
    return row
  }

  private async runSearch(query: string): Promise<void> {
    // User bubble
    this.addMessage(
      `<div class="km-bubble km-bubble--user">${this.escape(query)}</div>`,
      'user'
    )

    // Thinking bubble
    const thinkingRow = this.addMessage(
      `<div class="km-bubble km-bubble--assistant">
         <span class="km-dots"><span></span><span></span><span></span></span>
       </div>`,
      'assistant'
    )

    try {
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))])

      const vec = await withTimeout((window as any).ragService.embed(query), 12000)
      if (!vec) throw new Error('No embedding')

      const result = await withTimeout(
        window.api.extractor.hybridSearch(query, vec, 3),
        12000
      )

      // Replace thinking bubble with results
      thinkingRow.remove()

      if (result?.success && result.results?.length > 0) {
        // 1. Create a bubble for the AI streamed answer (initially showing thinking dots)
        const answerBubble = this.addMessage(
          `<div class="km-bubble km-bubble--assistant km-ai-answer" style="padding-bottom: 8px;">
             <span class="km-dots"><span></span><span></span><span></span></span>
           </div>`,
          'assistant'
        )
        const answerEl = answerBubble.querySelector('.km-ai-answer') as HTMLElement

        // 2. Add the source cards bubble
        const cardsHtml = result.results.map((res: any) => `
          <div class="km-source-card" data-path="${this.escape(res.vault_path)}">
            <div class="km-source-header">
              <span class="km-source-name">${this.highlight(res.file_name, query)}</span>
              <span class="km-source-score">${Math.round(res.similarity * 100)}%</span>
            </div>
            <div class="km-source-text">${this.highlight(res.content, query)}</div>
          </div>
        `).join('')

        this.addMessage(
          `<div class="km-bubble km-bubble--assistant" style="opacity: 0.85;">
             <div class="km-source-label">Sources Used</div>
             ${cardsHtml}
           </div>`,
          'assistant'
        )

        // 3. Build the prompt for the LLM
        const contextText = result.results.map((r: any) => `[Source: ${r.file_name}]\n${r.content}`).join('\n\n---\n\n')
        const prompt = `You are a helpful knowledge assistant. Use the provided source documents to answer the user's question. 
If the documents contain relevant information, synthesize it into a clear, well-written summary paragraph. 
If the documents do not contain the answer, use your general knowledge to answer, but briefly mention that the specific answer wasn't found in the provided documents.

SOURCES:
${contextText}

USER QUESTION: ${query}`

        // 4. Stream the LLM response
        try {
          let fullText = ''
          for await (const chunk of aiProviderManager.streamResponse([{ role: 'user', content: prompt }])) {
            if (fullText === '') {
              answerEl.innerHTML = '' // remove dots on first chunk
            }
            fullText += chunk
            answerEl.innerHTML = formatMarkdown(fullText)
            this.scrollToBottom()
          }
          if (fullText.trim() === '') {
             answerEl.innerHTML = '<em>No response generated.</em>'
          }
        } catch (e: any) {
          console.error('[KM LLM]', e)
          if (answerEl.querySelector('.km-dots')) {
            answerEl.innerHTML = `<em>AI generation failed: ${this.escape(e.message)}</em>`
          } else {
            answerEl.innerHTML += `<br/><br/><em>[Connection interrupted: ${this.escape(e.message)}]</em>`
          }
        }
      } else {
        this.addMessage(
          `<div class="km-bubble km-bubble--assistant">No relevant documents found for that query.</div>`,
          'assistant'
        )
      }
    } catch (err) {
      console.error('[KM Search]', err)
      thinkingRow.remove()
      this.addMessage(
        `<div class="km-bubble km-bubble--assistant km-bubble--error">Search failed. Check your database connection.</div>`,
        'assistant'
      )
    }
  }

  private escape(s: string): string {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  /** Escape HTML then wrap each query word in <mark> */
  private highlight(text: string, query: string): string {
    const safe = this.escape(text)
    if (!query.trim()) return safe

    // Split query into individual words, filter empties and stop words, escape regex special chars
    const stopWords = new Set(['is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'with', 'what', 'who', 'whom', 'where', 'when', 'why', 'how', 'which', 'in', 'of', 'this', 'that', 'these', 'those'])
    const words = query.trim()
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

    if (!words.length) return safe

    // Use word boundaries \b so we don't highlight 'is' inside 'English'
    const pattern = new RegExp(`\\b(${words.join('|')})\\b`, 'gi')
    return safe.replace(pattern, '<mark class="km-highlight km-active">$1</mark>')
  }
}
