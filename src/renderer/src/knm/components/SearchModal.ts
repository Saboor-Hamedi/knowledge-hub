import './search-modal.css'

export class SearchModal {
  private container: HTMLElement
  private overlay: HTMLElement

  constructor() {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay search-overlay'
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
    const input = this.container.querySelector('#search-modal-input') as HTMLInputElement
    if (input) {
      setTimeout(() => input.focus(), 50)
    }
  }

  hide(): void {
    this.overlay.style.display = 'none'
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="search-body">
        <div class="search-results-container">
          <ul id="search-results-list" class="search-results-list"></ul>
          <div class="search-empty-state" id="search-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 16px; opacity: 0.5;">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <p style="font-size: 1.1rem;">How can I help you? Type a message...</p>
          </div>
          <div class="search-loading" id="search-loading" style="display: none;">
            <div class="spinner"></div>
            <p>Thinking...</p>
          </div>
        </div>
      </div>
      <div class="search-input-area">
        <div class="chat-input-wrapper">
          <input type="text" id="search-modal-input" placeholder="Message the Knowledge Hub..." autocomplete="off" />
          <button class="chat-send-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    `
  }

  private setupListeners(): void {
    // The close button is removed, we'll rely on Escape or clicking outside


    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide()
      }
    })

    const input = this.container.querySelector('#search-modal-input') as HTMLInputElement
    let debounceTimer: ReturnType<typeof setTimeout>

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer)
      const query = input.value.trim()
      
      if (!query) {
        this.clearResults()
        return
      }

      debounceTimer = setTimeout(() => {
        this.performSearch(query)
      }, 400)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide()
      }
    })
  }

  private clearResults(): void {
    const list = this.container.querySelector('#search-results-list') as HTMLElement
    const emptyState = this.container.querySelector('#search-empty-state') as HTMLElement
    const loadingState = this.container.querySelector('#search-loading') as HTMLElement
    
    list.innerHTML = ''
    emptyState.style.display = 'flex'
    loadingState.style.display = 'none'
  }

  private async performSearch(query: string): Promise<void> {
    const list = this.container.querySelector('#search-results-list') as HTMLElement
    const emptyState = this.container.querySelector('#search-empty-state') as HTMLElement
    const loadingState = this.container.querySelector('#search-loading') as HTMLElement
    
    list.innerHTML = ''
    emptyState.style.display = 'none'
    loadingState.style.display = 'flex'

    try {
      // Add a timeout helper
      const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms))
        ])
      }

      // 1. Get embedding for the query. 
      console.log('Generating embedding for query:', query)
      const embeddingVector = await withTimeout(
        (window as any).ragService.embed(query),
        10000,
        'Generating embedding'
      )

      if (!embeddingVector) {
         throw new Error("Failed to generate embedding for the search query.")
      }

      console.log('Running hybrid search in database...')
      const result = await withTimeout(
        window.api.extractor.hybridSearch(query, embeddingVector, 3),
        10000,
        'Database search'
      )
      
      loadingState.style.display = 'none'
      
      if (result && result.success && result.results && result.results.length > 0) {
        result.results.forEach((res: any) => {
          const li = document.createElement('li')
          li.className = 'search-result-item'
          li.innerHTML = `
            <div class="result-title">
              <span class="file-name">${res.file_name}</span>
              <span class="similarity-score">${Math.round(res.similarity * 100)}%</span>
            </div>
            <div class="result-path">${res.vault_path}</div>
            <div class="result-snippet">${this.highlightSnippet(res.content, query)}</div>
          `
          
          li.addEventListener('click', () => {
            // Logic to open the document goes here.
            this.hide()
            if (window.api.revealVault) {
              window.api.revealVault(res.vault_path)
            }
          })
          
          list.appendChild(li)
        })
      } else {
        emptyState.innerHTML = '<p>No results found.</p>'
        emptyState.style.display = 'flex'
      }
    } catch (err) {
      console.error('Search failed:', err)
      loadingState.style.display = 'none'
      emptyState.innerHTML = '<p>An error occurred while searching.</p>'
      emptyState.style.display = 'flex'
    }
  }
  
  private highlightSnippet(content: string, _query: string): string {
    if (!content) return ''
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
