import './search-modal.css'
import { formatMarkdown } from '../../utils/markdown'
import { aiProviderManager } from '../../services/ai/provider-manager'

export class SearchModal {
  private container: HTMLElement
  private overlay: HTMLElement
  private removeProgressCb?: () => void

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

  async show(): Promise<void> {
    this.overlay.style.display = 'flex'
    const input = this.container.querySelector('#search-input') as HTMLInputElement
    if (input) setTimeout(() => input.focus(), 50)
      
    // Fetch batch status when opened to see if ingestion is running
    try {
      const status = await window.api.extractor.getBatchStatus()
      if (status.isProcessing) {
        this.switchView('upload', 'Upload Documents')
        
        const dropzone = this.container.querySelector('#ingestion-dropzone') as HTMLElement
        const progressContainer = this.container.querySelector('.ingestion-progress-container') as HTMLElement
        const fileList = this.container.querySelector('#ingestion-file-list') as HTMLElement

        dropzone.style.display = 'none'
        progressContainer.style.display = 'flex'
        
        fileList.innerHTML = ''
        status.queue.forEach(filePath => {
          const li = document.createElement('li')
          li.textContent = filePath.split(/[\\/]/).pop() || filePath
          li.className = 'pending'
          fileList.appendChild(li)
        })

        if (status.status.startsWith('Extracting ')) {
          const fileName = status.status.replace('Extracting ', '').replace('...', '')
          const li = document.createElement('li')
          li.textContent = fileName
          li.className = 'processing'
          fileList.insertBefore(li, fileList.firstChild)
        }

        this.updateProgress(status.percent, status.status)
      }
    } catch (err) {
      console.error('Failed to get batch status:', err)
    }
  }

  async showUpload(): Promise<void> {
    await this.show()
    this.switchView('upload', 'Upload Documents')
  }

  hide(): void {
    this.overlay.style.display = 'none'
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="km-sidebar">
        <div class="km-sidebar-header">
          <h3>Knowledge Hub</h3>
        </div>
        <div class="km-sidebar-menu">
          <div class="km-sidebar-item active" data-view="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            Search
          </div>
          <div class="km-sidebar-item" data-view="upload">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Documents
          </div>
        </div>
      </div>
      
      <div class="km-main">
        <div class="km-titlebar">
          <span class="km-titlebar__title" id="km-view-title">Search</span>
          <div class="km-titlebar__right">
            <span class="km-titlebar__hint">esc to close</span>
            <button class="km-titlebar__close" id="km-close-btn">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M11 1L1 11M1 1l10 10"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- SEARCH VIEW -->
        <div class="km-view active" id="view-search">
          <div class="km-chat-messages" id="km-chat-messages">
            <div class="km-welcome" id="km-welcome">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <p>Search your Knowledge Hub</p>
            </div>
          </div>
          <div class="km-input-bar">
            <div class="km-input-wrap">
              <textarea id="search-input" placeholder="Ask anything about your documents..." rows="1"></textarea>
              <button id="km-send" class="km-send-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- UPLOAD VIEW -->
        <div class="km-view" id="view-upload">
          <div class="ingestion-body">
            <div class="ingestion-dropzone" id="ingestion-dropzone">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p>Drop files here to ingest</p>
              <span class="drop-hint">PDF, DOCX, XLSX, CSV, TXT, MD</span>
              <input type="file" id="ingestion-file-input" multiple style="display:none;" accept=".pdf,.docx,.xlsx,.csv,.txt,.md" />
              <button class="km-browse-btn" id="ingestion-browse-btn">Browse Files</button>
            </div>
            <div class="ingestion-progress-container" style="display: none;">
              <div class="ingestion-progress-header">
                <h3>Processing</h3>
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" id="ingestion-progress-fill"></div>
                </div>
                <p id="ingestion-progress-text">Starting…</p>
              </div>
              <div class="ingestion-file-list-wrapper">
                <ul id="ingestion-file-list" class="ingestion-file-list"></ul>
              </div>
            </div>
          </div>
          <div class="ingestion-modal__footer" id="ingestion-footer" style="display:none;">
            <button class="btn btn-secondary" id="ingestion-add-more-btn">Add More</button>
            <button class="btn btn-danger" id="ingestion-cancel-btn">Cancel Processing</button>
          </div>
        </div>
      </div>
    `
  }

  private switchView(viewId: string, title: string): void {
    // Update sidebar active state
    this.container.querySelectorAll('.km-sidebar-item').forEach(el => {
      el.classList.remove('active')
      if (el.getAttribute('data-view') === viewId) {
        el.classList.add('active')
      }
    })

    // Update title
    const titleEl = this.container.querySelector('#km-view-title')
    if (titleEl) titleEl.textContent = title

    // Show correct view
    this.container.querySelectorAll('.km-view').forEach(el => {
      el.classList.remove('active')
      if (el.id === 'view-' + viewId) {
        el.classList.add('active')
      }
    })

    if (viewId === 'search') {
      const input = this.container.querySelector('#search-input') as HTMLInputElement
      if (input) input.focus()
    }
  }

  private setupListeners(): void {
    // Close on backdrop click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })

    const closeBtn = this.container.querySelector('#km-close-btn') as HTMLButtonElement
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide())

    // Global ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.style.display !== 'none') {
        this.hide()
      }
    })
    
    // Sidebar switching
    const sidebarItems = this.container.querySelectorAll('.km-sidebar-item')
    sidebarItems.forEach(item => {
      item.addEventListener('click', () => {
        const viewId = item.getAttribute('data-view')
        const title = item.textContent?.trim() || 'Search'
        if (viewId) this.switchView(viewId, title)
      })
    })

    // --- SEARCH LISTENERS ---
    const input = this.container.querySelector('#search-input') as HTMLTextAreaElement
    const sendBtn = this.container.querySelector('#km-send') as HTMLButtonElement

    const submitSearch = () => {
      const q = input.value.trim()
      if (!q) return
      input.value = ''
      input.style.height = 'auto'
      sendBtn.disabled = true
      this.runSearch(q).finally(() => { sendBtn.disabled = false })
    }

    sendBtn.addEventListener('click', submitSearch)
    
    input.addEventListener('input', () => {
      input.style.height = 'auto'
      input.style.height = (input.scrollHeight) + 'px'
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault()
        submitSearch() 
      }
    })

    // Clear highlights on click anywhere in the container
    this.container.addEventListener('click', (e) => {
      // Don't clear if clicking on a highlight
      if ((e.target as HTMLElement).classList.contains('km-highlight')) return;
      this.container.querySelectorAll('.km-highlight.km-active').forEach(el => {
        el.classList.remove('km-active')
      })
    })

    // --- UPLOAD LISTENERS ---
    const dropzone = this.container.querySelector('#ingestion-dropzone') as HTMLElement
    const fileInput = this.container.querySelector('#ingestion-file-input') as HTMLInputElement
    const browseBtn = this.container.querySelector('#ingestion-browse-btn')

    browseBtn?.addEventListener('click', () => fileInput.click())

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault()
      dropzone.classList.add('dragover')
    })

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover')
    })

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault()
      dropzone.classList.remove('dragover')
      if (e.dataTransfer?.files) {
        this.handleFiles(Array.from(e.dataTransfer.files))
      }
    })

    fileInput.addEventListener('change', () => {
      if (fileInput.files) {
        this.handleFiles(Array.from(fileInput.files))
      }
    })

    const cancelBtn = this.container.querySelector('#ingestion-cancel-btn')
    cancelBtn?.addEventListener('click', () => {
      window.api.invoke('extractor:cancelBatchIngestion')
    })
    
    const addMoreBtn = this.container.querySelector('#ingestion-add-more-btn')
    addMoreBtn?.addEventListener('click', () => {
      fileInput?.click()
    })
  }

  // ====== SEARCH METHODS ======
  
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
    this.addMessage(
      `<div class="km-bubble km-bubble--user">${this.escape(query)}</div>`,
      'user'
    )

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

      thinkingRow.remove()

      if (result?.success && result.results?.length > 0) {
        const answerBubble = this.addMessage(
          `<div class="km-bubble km-bubble--assistant km-ai-answer" style="padding-bottom: 8px;">
             <span class="km-dots"><span></span><span></span><span></span></span>
           </div>`,
          'assistant'
        )
        const answerEl = answerBubble.querySelector('.km-ai-answer') as HTMLElement

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

        const contextText = result.results.map((r: any) => `[Source: ${r.file_name}]\n${r.content}`).join('\n\n---\n\n')
        const prompt = `You are a helpful knowledge assistant. Use the provided source documents to answer the user's question. 
If the documents contain relevant information, synthesize it into a clear, well-written summary paragraph. 
If the documents do not contain the answer, use your general knowledge to answer, but briefly mention that the specific answer wasn't found in the provided documents.

SOURCES:
${contextText}

USER QUESTION: ${query}`

        try {
          let fullText = ''
          for await (const chunk of aiProviderManager.streamResponse([{ role: 'user', content: prompt }])) {
            if (fullText === '') {
              answerEl.innerHTML = ''
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

  private highlight(text: string, query: string): string {
    const safe = this.escape(text)
    if (!query.trim()) return safe

    const stopWords = new Set(['is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'with', 'what', 'who', 'whom', 'where', 'when', 'why', 'how', 'which', 'in', 'of', 'this', 'that', 'these', 'those'])
    const words = query.trim()
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

    if (!words.length) return safe

    const pattern = new RegExp(`\\b(${words.join('|')})\\b`, 'gi')
    return safe.replace(pattern, '<mark class="km-highlight km-active">$1</mark>')
  }

  // ====== UPLOAD METHODS ======
  
  private handleFiles(files: File[]): void {
    const dropzone = this.container.querySelector('#ingestion-dropzone') as HTMLElement
    const progressContainer = this.container.querySelector('.ingestion-progress-container') as HTMLElement
    const footer = this.container.querySelector('#ingestion-footer') as HTMLElement
    const fileList = this.container.querySelector('#ingestion-file-list') as HTMLElement
    const cancelBtn = this.container.querySelector('#ingestion-cancel-btn') as HTMLElement

    if (cancelBtn && cancelBtn.textContent === 'Done') {
      this.resetUI()
    }

    const isAlreadyProcessing = progressContainer.style.display === 'flex' || progressContainer.style.display === 'block'
    
    dropzone.style.display = 'none'
    progressContainer.style.display = 'flex'
    if (footer) footer.style.display = 'flex'

    if (!isAlreadyProcessing) {
      fileList.innerHTML = ''
    }

    files.forEach(file => {
      const li = document.createElement('li')
      li.textContent = file.name
      li.className = 'pending'
      fileList.appendChild(li)
    })

    this.startIngestion(files.map(f => f.path))
  }

  private async startIngestion(filePaths: string[]): Promise<void> {
    if (this.removeProgressCb) {
      this.removeProgressCb()
    }
    
    this.removeProgressCb = window.api.extractor.onProgress((percent, status) => {
      this.updateProgress(percent, status)
      
      if (status.startsWith('Extracting ')) {
        const fileName = status.replace('Extracting ', '').replace('...', '')
        const listItems = this.container.querySelectorAll('#ingestion-file-list li')
        listItems.forEach(li => {
          if (li.textContent === fileName) {
            li.className = 'processing'
          } else if (li.className === 'processing') {
            li.className = 'done'
          }
        })
      }
    })

    try {
      const result = await window.api.extractor.startBatchIngestion(filePaths)
      
      if (result.success) {
        this.updateProgress(100, result.message || 'Batch ingestion complete!')
        setTimeout(() => {
          this.resetUI()
        }, 1500)
      } else {
        alert('Ingestion failed: ' + (result.message || 'Unknown error'))
        this.resetUI()
      }
    } catch (err) {
      console.error('Failed to start ingestion:', err)
      this.updateProgress(0, 'Error occurred')
      this.resetUI()
    } finally {
      if (this.removeProgressCb) {
        this.removeProgressCb()
        this.removeProgressCb = undefined
      }
    }
  }

  public updateProgress(percentage: number, statusText: string): void {
    const fill = this.container.querySelector('#ingestion-progress-fill') as HTMLElement
    const text = this.container.querySelector('#ingestion-progress-text') as HTMLElement
    if (fill) fill.style.width = `${percentage}%`
    if (text) text.textContent = statusText
  }

  private resetUI(): void {
    const dropzone = this.container.querySelector('#ingestion-dropzone') as HTMLElement
    const progressContainer = this.container.querySelector('.ingestion-progress-container') as HTMLElement
    const footer = this.container.querySelector('#ingestion-footer') as HTMLElement
    const fileInput = this.container.querySelector('#ingestion-file-input') as HTMLInputElement
    
    progressContainer.style.display = 'none'
    dropzone.style.display = 'flex'
    if (footer) footer.style.display = 'none'
    
    // Clear input
    if (fileInput) fileInput.value = ''
    
    // Restore cancel button state
    const cancelBtn = this.container.querySelector('#ingestion-cancel-btn') as HTMLElement
    if (cancelBtn) {
      cancelBtn.textContent = 'Cancel Processing'
      cancelBtn.classList.remove('btn-primary')
      cancelBtn.classList.add('btn-danger')
      const newBtn = cancelBtn.cloneNode(true) as HTMLElement
      cancelBtn.parentNode?.replaceChild(newBtn, cancelBtn)
      newBtn.addEventListener('click', () => {
        window.api.invoke('extractor:cancelBatchIngestion')
        this.resetUI()
      })
    }
  }
}
