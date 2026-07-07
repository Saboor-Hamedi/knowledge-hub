import './ingestion-modal.css'

export class IngestionModal {
  private container: HTMLElement
  private overlay: HTMLElement

  constructor() {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay ingestion-overlay'
    this.overlay.style.display = 'none'

    this.container = document.createElement('div')
    this.container.className = 'ingestion-modal'
    
    this.overlay.appendChild(this.container)
    document.body.appendChild(this.overlay)

    this.render()
    this.setupListeners()
  }

  async show(): Promise<void> {
    this.overlay.style.display = 'flex'
    // Fetch batch status when opened
    try {
      const status = await window.api.extractor.getBatchStatus()
      if (status.isProcessing) {
        const dropzone = this.container.querySelector('#ingestion-dropzone') as HTMLElement
        const progressContainer = this.container.querySelector('.ingestion-progress-container') as HTMLElement
        const fileList = this.container.querySelector('#ingestion-file-list') as HTMLElement

        dropzone.style.display = 'none'
        progressContainer.style.display = 'block'
        
        fileList.innerHTML = ''
        status.queue.forEach(filePath => {
          const li = document.createElement('li')
          li.textContent = filePath.split(/[\\/]/).pop() || filePath
          li.className = 'pending'
          fileList.appendChild(li)
        })

        // Also add currently extracting item to top if available
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

  hide(): void {
    this.overlay.style.display = 'none'
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="ingestion-modal__header">
        <div class="ingestion-modal__title-group">
          <h3 class="ingestion-modal__title">Import Data</h3>
        </div>
        <div class="ingestion-modal__actions">
          <button class="ingestion-modal__close wh-btn">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M10.707 2.707L9.293 1.293 6 4.586 2.707 1.293 1.293 2.707 4.586 6l-3.293 3.293 1.414 1.414L6 7.414l3.293 3.293 1.414-1.414L7.414 6l3.293-3.293z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="ingestion-body">
        <div class="ingestion-dropzone" id="ingestion-dropzone">
          <p>Drag and drop PDF, DOCX, XLSX, CSV, or TXT files here to ingest</p>
          <input type="file" id="ingestion-file-input" multiple style="display: none;" accept=".pdf,.docx,.xlsx,.csv,.txt" />
          <button class="btn btn-primary" id="ingestion-browse-btn">Browse Files</button>
        </div>
        <div class="ingestion-progress-container" style="display: none;">
          <div class="ingestion-progress-header">
            <h3>Processing Files</h3>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" id="ingestion-progress-fill"></div>
            </div>
            <p id="ingestion-progress-text">0% Complete</p>
          </div>
          <div class="ingestion-file-list-wrapper">
            <ul id="ingestion-file-list" class="ingestion-file-list"></ul>
          </div>
          <div class="ingestion-modal__footer">
            <button class="btn btn-secondary" id="ingestion-add-more-btn" style="margin-right: 8px;">Add More Files</button>
            <button class="btn btn-danger" id="ingestion-cancel-btn">Cancel Processing</button>
          </div>
        </div>
      </div>
    `
  }

  private setupListeners(): void {
    const closeBtn = this.container.querySelector('.ingestion-modal__close')
    closeBtn?.addEventListener('click', () => this.hide())

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

  private handleFiles(files: File[]): void {
    const dropzone = this.container.querySelector('#ingestion-dropzone') as HTMLElement
    const progressContainer = this.container.querySelector('.ingestion-progress-container') as HTMLElement
    const fileList = this.container.querySelector('#ingestion-file-list') as HTMLElement
    const cancelBtn = this.container.querySelector('#ingestion-cancel-btn') as HTMLElement

    // If we were just in a success state, reset the UI first
    if (cancelBtn && cancelBtn.textContent === 'Close') {
      this.resetUI()
    }

    const isAlreadyProcessing = progressContainer.style.display === 'flex' || progressContainer.style.display === 'block'
    
    dropzone.style.display = 'none'
    progressContainer.style.display = 'flex'
    
    if (!isAlreadyProcessing) {
      fileList.innerHTML = ''
    }

    files.forEach(file => {
      const li = document.createElement('li')
      li.textContent = file.name
      li.className = 'pending'
      fileList.appendChild(li)
    })

    // Trigger IPC to copy these files into the vault's import folder.
    // The main process will handle copying them over, which will trigger the chokidar extraction.
    this.startIngestion(files.map(f => f.path))
  }

  private async startIngestion(filePaths: string[]): Promise<void> {
    // Listen for progress updates
    const removeListener = window.api.extractor.onProgress((percent, status) => {
      this.updateProgress(percent, status)
      
      // Update file list if status mentions extracting
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
      console.log('Batch ingestion finished:', result)
      
      if (result.success) {
        this.updateProgress(100, result.message || 'Batch ingestion complete!')
        
        // Show success status in the file list area
        const fileList = this.container.querySelector('#ingestion-file-list') as HTMLElement
        fileList.innerHTML = `
          <li class="ingestion-success-state" style="text-align: center; padding: 24px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success, #4caf50)" stroke-width="2" style="margin-bottom: 12px;">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
            <h4 style="margin: 0 0 8px 0; color: var(--text-primary, #ffffff); font-size: 16px;">Ingestion Successful</h4>
            <p style="margin: 0; color: var(--text-secondary, #cccccc); font-size: 13px;">${result.message}</p>
          </li>
        `

        const cancelBtn = this.container.querySelector('#ingestion-cancel-btn') as HTMLElement
        cancelBtn.textContent = 'Close'
        cancelBtn.classList.remove('btn-danger')
        cancelBtn.classList.add('btn-primary')
        
        // Overwrite the listener by replacing the button clone
        const newBtn = cancelBtn.cloneNode(true) as HTMLElement
        cancelBtn.parentNode?.replaceChild(newBtn, cancelBtn)
        newBtn.addEventListener('click', () => {
          this.hide()
          this.resetUI()
        })
      } else {
        alert('Ingestion failed: ' + (result.message || 'Unknown error'))
        this.resetUI()
      }
    } catch (err) {
      console.error('Failed to start ingestion:', err)
      this.updateProgress(0, 'Error occurred')
    } finally {
      removeListener()
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
    progressContainer.style.display = 'none'
    dropzone.style.display = 'flex'
    
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
      })
    }
  }
}
