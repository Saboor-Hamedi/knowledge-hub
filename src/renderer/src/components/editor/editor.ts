import 'monaco-editor/min/vs/editor/editor.main.css'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { state } from '../../core/state'
import { themes } from '../../core/themes'
import type { NotePayload, AppSettings } from '../../core/types'
import { registerWikiLinkProviders } from '../wikilink/wikilink'
import { PreviewComponent } from '../preview/preview'
import './editor.css'
import '../wikilink/wikilink.css'
import './slash-menu.css'
import { SlashMenu } from './slash-menu'
import './selection-toolbar.css'
import { SelectionToolbar } from './selection-toolbar'
import { SuggestionManager } from './suggestion-handler'

type Monaco = any // Use any to bypass stubborn type resolution in dynamic imports

const globalScope = self as unknown as {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: string) => Worker
  }
}

globalScope.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  }
}

export class EditorComponent {
  private container: HTMLElement
  private emptyState: HTMLElement
  private editorHost: HTMLElement
  private monacoInstance: Monaco | null = null
  private editor: Monaco['editor']['IStandaloneCodeEditor'] | null = null
  private pendingSave?: number
  private onContentChange?: () => void
  private listenerAttached: boolean = false
  private shortcutsAttached: boolean = false
  private onSave?: (payload: NotePayload) => void
  private onLinkClick?: (target: string) => void
  private onGetHoverContent?: (target: string) => Promise<string | null>
  private onContextMenu?: (e: MouseEvent) => void
  private onCursorPositionChange?: () => void
  private decorations: string[] = []
  private cachedSettings: AppSettings | null = null
  private providers: { dispose: () => void }[] = []
  private initPromise: Promise<void> | null = null
  private hashtagDecorations: string[] = []
  private preview?: PreviewComponent
  private previewHost?: HTMLElement
  public isPreviewMode: boolean = false
  private suggestionManager: SuggestionManager | null = null

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.render()
    this.emptyState = this.container.querySelector('.editor-empty') as HTMLElement
    this.editorHost = this.container.querySelector('.editor-host') as HTMLElement
    this.previewHost = this.container.querySelector('.preview-host') as HTMLElement

    // Start loading Monaco in background immediately
    void this.ensureEditor()

    // Initialize preview after DOM is ready
    setTimeout(() => {
      const previewContainer = document.getElementById('preview-container')
      if (previewContainer) {
        this.preview = new PreviewComponent('preview-container')
        this.preview.setWikiLinkHandler((target) => {
          if (this.onLinkClick) {
            this.onLinkClick(target)
          }
        })
      }
    }, 0)
  }

  setContentChangeHandler(handler: () => void): void {
    this.onContentChange = handler
  }

  setSaveHandler(handler: (payload: NotePayload) => void): void {
    this.onSave = handler
  }

  setLinkClickHandler(handler: (target: string) => void): void {
    this.onLinkClick = handler
  }

  setHoverContentHandler(handler: (target: string) => Promise<string | null>): void {
    this.onGetHoverContent = handler
  }

  setContextMenuHandler(handler: (e: MouseEvent) => void): void {
    this.onContextMenu = handler
  }

  setCursorPositionChangeHandler(handler: () => void): void {
    this.onCursorPositionChange = handler
  }

  setDropHandler(handler: (path: string, isFile: boolean) => void): void {
    const setupDropListener = (element: HTMLElement) => {
      element.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.container.classList.add('drag-over')
      })

      element.addEventListener('dragleave', (e) => {
        // Only remove class if leaving the editor container entirely
        if (e.target === this.container || !this.container.contains(e.relatedTarget as Node)) {
          this.container.classList.remove('drag-over')
        }
      })

      element.addEventListener('drop', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.container.classList.remove('drag-over')

        let filePath: string | null = null

        // Try files array first (most reliable in Electron)
        const files = e.dataTransfer?.files
        if (files && files.length > 0) {
          const file = files[0]
          filePath = (file as any).path
        }

        // If no path from files, try items (fallback)
        if (!filePath) {
          const items = e.dataTransfer?.items
          if (items && items.length > 0) {
            const item = items[0]
            const entry = (item as any).webkitGetAsEntry?.()
            if (entry) {
              filePath = (entry as any).fullPath || (entry as any).path
            }
          }
        }

        // If coming from sidebar, we might have 'from-sidebar' data
        if (!filePath) {
          const sidebarPath = e.dataTransfer?.getData('text/plain')
          const fromSidebar = e.dataTransfer?.getData('from-sidebar')
          if (fromSidebar === 'true' && sidebarPath) {
            filePath = sidebarPath
          }
        }

        if (filePath) {
          const ext = filePath.split('.').pop()?.toLowerCase() || ''
          const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)

          if (isImage) {
            // Handle image drop directly
            const files = e.dataTransfer?.files
            let file: File | null = null

            if (files && files.length > 0) {
              file = files[0]
            } else {
              // If we only have path (e.g. from sidebar), we can't easily read it as blob in renderer without node integration?
              // Actually, "preload" exposes specific APIs.
              // We don't have "readFile".
              // But if it's external drag, we have 'files'.
              // If it's internal sidebar drag, it's not a new asset, just a link?
              // If dragging image FROM sidebar to editor?
              // Sidebar currently doesn't show images.
              // So likely external drop.
            }

            if (file) {
              try {
                const buffer = await file.arrayBuffer()
                const name = file.name // or `image-${Date.now()}.${ext}`
                const savedPath = await window.api.saveAsset(buffer, name)

                // Calculate drop position
                // Monaco doesn't use standard caretRange easily.
                // We can use editor.getTargetAtClientPoint

                const target = this.editor?.getTargetAtClientPoint({ x: e.clientX, y: e.clientY })
                if (target && target.position) {
                  this.editor!.executeEdits('', [
                    {
                      range: new this.monacoInstance!.Range(
                        target.position.lineNumber,
                        target.position.column,
                        target.position.lineNumber,
                        target.position.column
                      ),
                      text: `![${name}](${savedPath})`,
                      forceMoveMarkers: true
                    }
                  ])
                } else {
                  // Fallback to cursor
                  const pos = this.editor?.getPosition()
                  if (pos) {
                    this.editor!.executeEdits('', [
                      {
                        range: new this.monacoInstance!.Range(
                          pos.lineNumber,
                          pos.column,
                          pos.lineNumber,
                          pos.column
                        ),
                        text: `![${name}](${savedPath})`,
                        forceMoveMarkers: true
                      }
                    ])
                  }
                }
              } catch (err) {
                console.error('Failed to save dropped image', err)
              }
              return
            }
          }

          const isFile = /\.[^.]+$/.test(filePath)
          handler(filePath, isFile)
        } else {
          console.warn('No file path found in drop event')
        }
      })
    }

    // Listen on both empty state and editor host for drops
    setupDropListener(this.emptyState)
    setupDropListener(this.editorHost)
    setupDropListener(this.container)
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="editor-empty" style="display: none;">Select or create a note to start writing</div>
      <div class="editor-host" aria-label="Note editor"></div>
      <div class="preview-host" style="display: none;">
        <div id="preview-container"></div>
      </div>
    `

    // Initialize preview after DOM is ready
    setTimeout(() => {
      const previewContainer = document.getElementById('preview-container')
      if (previewContainer) {
        this.preview = new PreviewComponent('preview-container')
        this.preview.setWikiLinkHandler((target) => {
          if (this.onLinkClick) {
            this.onLinkClick(target)
          }
        })
      }
    }, 0)
  }

  public async loadNote(payload: NotePayload): Promise<void> {
    state.applyingRemote = true
    this.container.classList.add('is-loading')
    this.editorHost.classList.remove('fade-in')

    // Hide empty state immediately so user doesn't see "Select a note" while loading
    this.emptyState.style.display = 'none'
    this.editorHost.style.display = 'block'

    await this.ensureEditor()

    // Ensure keyboard shortcuts are attached after editor is ready
    this.attachKeyboardShortcuts()

    if (!this.editor) {
      this.container.classList.remove('is-loading')
      state.applyingRemote = false
      return
    }

    const model = this.editor.getModel()
    if (!model) {
      this.container.classList.remove('is-loading')
      state.applyingRemote = false
      return
    }

    // Fresh Providers check
    this.reRegisterProviders()

    const currentContent = model.getValue()
    if (currentContent !== payload.content) {
      this.editor.setValue(payload.content)
    }

    try {
      const lang = this.getLanguageFromFilename(payload.title || payload.id)
      this.monacoInstance!.editor.setModelLanguage(model, lang)
    } catch {
      // Language setting failed, continue with current language
    }
    state.applyingRemote = false
    state.isDirty = false
    state.lastSavedAt = payload.updatedAt || Date.now()

    this.emptyState.style.display = 'none'
    this.editorHost.style.display = 'block'
    this.updatePreview()
    this.updateDecorations()
    this.updateHashtagDecorations()

    // Reveal content with animation
    this.container.classList.remove('is-loading')
    this.editorHost.classList.add('fade-in')

    // Restore cursor position if saved
    if (state.cursorPositions.has(payload.id)) {
      const pos = state.cursorPositions.get(payload.id)!
      setTimeout(() => {
        if (this.editor && state.activeId === payload.id) {
          // Force both cursor and selection to the same point
          const selection = new this.monacoInstance!.Selection(
            pos.lineNumber,
            pos.column,
            pos.lineNumber,
            pos.column
          )
          this.editor.setSelection(selection)
          this.editor.revealPositionInCenterIfOutsideViewport(pos)
          this.editor.focus()

          // Secondary insurance for scroll position
          if (pos.lineNumber > 5) {
            this.editor.revealLineInCenterIfOutsideViewport(pos.lineNumber)
          }
        }
      }, 150) // Reliable delay for Monaco rendering
    }
  }

  private updatePreview(): void {
    if (!this.preview || !this.editor) return
    const content = this.editor.getValue()
    // Pass the current note's title as file path for language detection
    const filePath = state.activeId
      ? state.notes.find((n) => n.id === state.activeId)?.title || state.activeId
      : null
    this.preview.update(content, filePath || undefined)
  }

  private reRegisterProviders(): void {
    if (!this.monacoInstance || !this.onGetHoverContent) return

    this.providers.forEach((p) => p.dispose())
    this.providers = []

    try {
      const wikilinkProviders = registerWikiLinkProviders(
        this.monacoInstance,
        this.onGetHoverContent
      )
      this.providers.push(...wikilinkProviders)
    } catch (err) {
      console.error('[Editor] Refresh failure:', err)
    }
  }

  public async showPreview(content: string): Promise<void> {
    if (!this.previewHost || !this.editorHost || !this.preview) return

    // Ensure main container is visible (in case it was hidden by welcome page)
    this.container.style.display = 'block'

    // Hide editor, show preview
    this.editorHost.style.display = 'none'
    this.previewHost.style.display = 'block'
    this.emptyState.style.display = 'none'

    // Update preview content with file path for language detection
    const filePath = state.activeId
      ? state.notes.find((n) => n.id === state.activeId)?.title || state.activeId
      : null
    this.preview.update(content, filePath || undefined)
    this.isPreviewMode = true
  }

  showEmpty(): void {
    this.container.classList.remove('is-loading')
    this.editorHost.classList.remove('fade-in')
    this.emptyState.style.display = 'flex'
    this.editorHost.style.display = 'none'
    if (this.previewHost) {
      this.previewHost.style.display = 'none'
    }
    if (this.editor) {
      state.applyingRemote = true
      this.editor.setValue('')
      state.applyingRemote = false
      state.isDirty = false
    }
  }

  hideAll(): void {
    this.container.classList.remove('is-loading')
    this.editorHost.classList.remove('fade-in')
    this.emptyState.style.display = 'none'
    this.editorHost.style.display = 'none'
    if (this.previewHost) {
      this.previewHost.style.display = 'none'
    }
  }

  getValue(): string {
    return this.editor?.getValue() ?? ''
  }

  getSelectionContent(): string | null {
    if (!this.editor) return null
    const selection = this.editor.getSelection()
    if (!selection || selection.isEmpty()) return null
    return this.editor.getModel()?.getValueInRange(selection) || null
  }

  getSelection(): string {
    if (!this.editor) return ''
    const selection = this.editor.getSelection()
    if (!selection) return ''
    return this.editor.getModel()?.getValueInRange(selection) ?? ''
  }

  focus(): void {
    this.editor?.focus()
  }

  getCursorPosition(): { line: number; ch: number } | null {
    if (!this.editor) return null
    const pos = this.editor.getPosition()
    if (!pos) return null
    return { line: pos.lineNumber - 1, ch: pos.column - 1 }
  }

  layout(): void {
    if (this.editor) {
      const width = this.container.clientWidth
      // Auto-hide minimap on narrow screens to prevent overlap
      this.editor.updateOptions({
        minimap: { enabled: width > 600 && (state.settings?.minimap ?? true) }
      })
      this.editor.layout()
    }
  }

  insertAtCursor(text: string): void {
    if (!this.editor || !this.monacoInstance) return
    const selection = this.editor.getSelection()
    if (!selection) return

    this.editor.executeEdits('keyboard', [
      {
        range: selection,
        text,
        forceMoveMarkers: true
      }
    ])
  }

  triggerAction(actionId: string): void {
    this.editor?.trigger('context-menu', actionId, null)
  }

  public highlightTerm(
    query: string,
    matchCase: boolean = false,
    wholeWord: boolean = false,
    useRegex: boolean = false
  ): void {
    if (!this.editor) return

    const model = this.editor.getModel()
    if (!model) return

    if (!query) {
      this.clearHighlights()
      return
    }

    let findMatches: any[] = []
    try {
      findMatches = model.findMatches(
        query,
        true,
        useRegex,
        matchCase,
        wholeWord ? ' ' : null,
        true
      )
    } catch (err) {
      console.error('[Editor] Search failed:', err)
      return
    }

    if (findMatches.length > 0) {
      const newDecorations = findMatches.map((match) => ({
        range: match.range,
        options: {
          styleSheet: true,
          className: 'search-highlight',
          inlineClassName: 'search-highlight-inline',
          stickiness: 1 // monaco.editor.TrackedRangeStickiness.NeverGutterOrLineNumbers
        }
      }))

      this.decorations = this.editor.deltaDecorations(this.decorations, newDecorations)

      // Only scroll to first match if we're not currently focused in the editor
      // so we don't jump around while the user is typing
      if (document.activeElement !== this.editor.getDomNode()) {
        this.editor.revealRangeInCenter(findMatches[0].range)
      }
    } else {
      this.clearHighlights()
    }
  }

  public clearHighlights(): void {
    if (this.editor) {
      this.decorations = this.editor.deltaDecorations(this.decorations, [])
    }
  }

  public proposeChanges(newContent: string, options: { skipScroll?: boolean } = {}): void {
    if (!this.suggestionManager) return
    this.suggestionManager.propose(newContent, options)
  }

  private getLanguageFromFilename(filename: string): string {
    const lower = filename.toLowerCase()
    const parts = lower.split('.')

    const map: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      sql: 'sql',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      py: 'python',
      go: 'go',
      rs: 'rust',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'shell',
      bash: 'shell',
      ipynb: 'json',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      java: 'java',
      php: 'php',
      rb: 'ruby',
      swift: 'swift'
    }

    // Case 1: Full compound extension like tables.sql.md
    if (
      parts.length >= 3 &&
      (parts[parts.length - 1] === 'md' || parts[parts.length - 1] === 'markdown')
    ) {
      const subExt = parts[parts.length - 2]
      if (map[subExt]) return map[subExt]
    }

    // Case 2: Extension is already stripped or it's a direct code file
    // e.g. "tables.sql" (likely from "tables.sql.md")
    if (parts.length >= 2) {
      const ext = parts[parts.length - 1]
      if (map[ext]) return map[ext]
    }

    return 'markdown'
  }

  private async ensureEditor(): Promise<void> {
    if (this.editor) return

    // Prevent race conditions if multiple calls happen before init completes
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = (async () => {
      try {
        const monaco = await this.loadMonaco()
        // Double check inside the lock
        if (this.editor) return

        const editorThemeId = state.settings?.editorTheme || state.settings?.theme || 'dark'
        const isLight = editorThemeId === 'light' || editorThemeId === 'github-light'
        this.editor = monaco.editor.create(this.editorHost, {
          value: '',
          language: 'markdown',
          theme: isLight ? 'vs' : 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: this.cachedSettings?.minimap ?? false },
          wordWrap: this.cachedSettings?.wordWrap ? 'on' : 'off',
          fontSize: this.cachedSettings?.fontSize ?? 14,
          padding: { top: 12, bottom: 12 },
          renderWhitespace: 'selection',
          lineNumbers: this.cachedSettings?.lineNumbers !== false ? 'on' : 'off',
          glyphMargin: false, // Ensure no extra icons in the gutter
          folding: false, // Disable the "checkbox" symbols for folding
          scrollBeyondLastLine: false,
          fixedOverflowWidgets: true,
          breadcrumbs: { enabled: false }, // Remove the "meta header" path breadcrumbs
          quickSuggestions: {
            other: true,
            comments: false,
            strings: true
          },
          inlineSuggest: {
            enabled: true // Enable inline suggestions for wiki links
          },
          stickyScroll: { enabled: false },
          suggest: {
            snippetsPreventQuickSuggestions: false,
            filterGraceful: true,
            showIcons: false, // Remove icons for a cleaner look
            showDetails: false, // Remove the "layer on top" detail/documentation window
            maxVisibleSuggestions: 6
          },
          hover: {
            enabled: true,
            delay: 300,
            sticky: true
          },
          contextmenu: false // Disable Monaco's native menu
        })

        this.editor.onDidChangeModelContent(() => {
          this.updateDecorations()
          this.updateHashtagDecorations()
          if (state.applyingRemote) return
          this.markDirty()
        })

        const updateCursorState = () => {
          if (!this.editor) return
          const pos = this.editor.getPosition()
          if (
            pos &&
            state.activeId &&
            state.activeId !== 'settings' &&
            state.activeId !== 'graph'
          ) {
            state.cursorPositions.set(state.activeId, {
              lineNumber: pos.lineNumber,
              column: pos.column
            })
            if (this.onCursorPositionChange) {
              this.onCursorPositionChange()
            }
          }
        }

        this.editor.onDidChangeCursorPosition(() => updateCursorState())
        this.editor.onDidChangeCursorSelection(() => updateCursorState())

        // Register WikiLink Providers
        try {
          if (this.onGetHoverContent && this.monacoInstance) {
            const wikilinkProviders = registerWikiLinkProviders(
              this.monacoInstance,
              this.onGetHoverContent
            )
            this.providers.push(...wikilinkProviders)
          }
        } catch {
          // WikiLink registration failed
        }

        // Register custom hashtag syntax highlighting
        try {
          this.registerHashtagHighlighting()
        } catch {
          // Hashtag highlighting registration failed
        }

        this.editorHost.addEventListener('contextmenu', (e) => {
          if (this.onContextMenu) {
            e.preventDefault()
            e.stopPropagation()
            this.onContextMenu(e)
          }
        })

        this.editor.onMouseDown((e) => {
          if (!e.target || !e.target.position) return

          if (e.event.ctrlKey || e.event.metaKey) {
            const model = this.editor!.getModel()
            if (!model) return

            const lineContent = model.getLineContent(e.target.position.lineNumber)
            const regex = /\[\[(.*?)\]\]/g
            let match

            while ((match = regex.exec(lineContent)) !== null) {
              const startCol = match.index + 1
              const endCol = match.index + match[0].length + 1

              if (e.target.position.column >= startCol && e.target.position.column < endCol) {
                const linkContent = match[1]
                const [target] = linkContent.split('|')
                this.onLinkClick?.(target.trim())
                e.event.preventDefault()
                e.event.stopPropagation()
                return
              }
            }
          }
        })

        // Apply cached settings immediately after creation
        if (this.cachedSettings) {
          this.applySettings(this.cachedSettings)
        }

        // Initialize Slash Menu
        new SlashMenu(this.editor)

        // Initialize Selection Toolbar
        new SelectionToolbar(this.editor)

        // Initialize Suggestion Manager
        this.suggestionManager = new SuggestionManager(this.editor, this.monacoInstance)
      } finally {
        this.initPromise = null
      }
    })()

    return this.initPromise
  }

  private updateDecorations(): void {
    if (!this.editor || !this.monacoInstance) return
    const model = this.editor.getModel()
    if (!model) return

    const text = model.getValue()
    const regex = /\[\[(.*?)\]\]/g
    const newDecorations: Monaco['editor']['IModelDeltaDecoration'][] = []

    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const startPos = model.getPositionAt(match.index)
      const endPos = model.getPositionAt(match.index + match[0].length)

      newDecorations.push({
        range: new this.monacoInstance.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column
        ),
        options: { inlineClassName: 'wiki-link' }
      })
    }

    this.decorations = this.editor.deltaDecorations(this.decorations, newDecorations)
  }

  // Old provider methods removed (logic moved to wikilink.ts)

  private markDirty(): void {
    state.isDirty = true
    this.onContentChange?.()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (!state.activeId || !this.editor) return
    if (this.pendingSave) window.clearTimeout(this.pendingSave)
    const delay = state.settings?.autoSaveDelay || 800
    this.pendingSave = window.setTimeout(() => this.triggerSave(), delay)
  }

  private triggerSave(): void {
    const isNote = state.notes.some((n) => n.id === state.activeId)
    if (
      !state.activeId ||
      state.activeId === 'settings' ||
      !isNote ||
      !this.editor ||
      !this.onSave
    ) {
      return
    }

    const content = this.editor.getValue()
    const note = state.notes.find((n) => n.id === state.activeId)
    const title = note?.title || state.projectName

    const payload: NotePayload = {
      id: state.activeId,
      title,
      content,
      updatedAt: state.lastSavedAt,
      path: note?.path
    }

    this.onSave(payload)
  }

  manualSave(): void {
    if (this.pendingSave) {
      window.clearTimeout(this.pendingSave)
      this.pendingSave = undefined
    }
    this.triggerSave()
  }

  private async loadMonaco(): Promise<Monaco> {
    if (this.monacoInstance) return this.monacoInstance
    // Import full monaco to get all language features (Markdown, etc)
    const mod = (await import('monaco-editor')) as any
    this.monacoInstance = mod
    return mod
  }

  attachKeyboardShortcuts(): void {
    if (!this.listenerAttached) {
      window.addEventListener('keydown', this.handleKeyDown.bind(this))
      this.listenerAttached = true
    }

    // Override Ctrl+D to delete active note instead of Monaco's default
    if (this.editor && !this.shortcutsAttached) {
      this.editor.addCommand(
        this.monacoInstance.KeyMod.CtrlCmd | this.monacoInstance.KeyCode.KeyD,
        () => {
          window.dispatchEvent(new CustomEvent('delete-active-note'))
        }
      )

      // Add Ctrl+\ (or Cmd+\ on Mac) to toggle preview
      this.editor.addCommand(
        this.monacoInstance.KeyMod.CtrlCmd | this.monacoInstance.KeyCode.Backslash,
        () => {
          this.togglePreview()
        }
      )

      // Override Ctrl+I to toggle right sidebar
      this.editor.addCommand(
        this.monacoInstance.KeyMod.CtrlCmd | this.monacoInstance.KeyCode.KeyI,
        () => {
          window.dispatchEvent(new CustomEvent('toggle-right-sidebar'))
        }
      )

      // Add Ctrl+J to toggle HUB console (Handled globally in app.ts)
      // We don't register it here to prevent conflicts with KeyboardManager.
      /* this.editor.addCommand(
        this.monacoInstance.KeyMod.CtrlCmd | this.monacoInstance.KeyCode.KeyJ,
        () => {
          window.dispatchEvent(new CustomEvent('toggle-hub-console'))
        }
      ) */

      // Add Ctrl+Shift+\ to toggle documentation modal
      this.editor.addCommand(
        this.monacoInstance.KeyMod.CtrlCmd |
          this.monacoInstance.KeyMod.Shift |
          this.monacoInstance.KeyCode.Backslash,
        () => {
          window.dispatchEvent(new CustomEvent('toggle-documentation-modal'))
        }
      )

      // Add Ctrl+Shift+, to toggle theme modal
      this.editor.addCommand(
        this.monacoInstance.KeyMod.CtrlCmd |
          this.monacoInstance.KeyMod.Shift |
          this.monacoInstance.KeyCode.Comma,
        () => {
          window.dispatchEvent(new CustomEvent('toggle-theme-modal'))
        }
      )

      this.shortcutsAttached = true
    }
  }

  togglePreview(): void {
    if (!this.previewHost || !this.editorHost) return

    // Do not toggle if no note is active
    const isNote = state.notes.some((n) => n.id === state.activeId)
    if (!state.activeId || state.activeId === 'settings' || !isNote) return

    this.isPreviewMode = !this.isPreviewMode

    if (this.isPreviewMode) {
      // Show preview, hide editor
      this.editorHost.style.display = 'none'
      this.previewHost.style.display = 'block'
      // Update preview with current content
      this.updatePreview()
    } else {
      // Show editor, hide preview
      this.editorHost.style.display = 'block'
      this.previewHost.style.display = 'none'
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const isMod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    // Global Documentation shortcut (ensure it works even if no note is open)
    if (isMod && event.shiftKey && key === '|') {
      // Note: event.key for shift+\ is often |
      event.preventDefault()
      window.dispatchEvent(new CustomEvent('toggle-documentation-modal'))
      return
    }

    if (isMod && event.shiftKey && (key === '\\' || event.code === 'Backslash')) {
      event.preventDefault()
      window.dispatchEvent(new CustomEvent('toggle-documentation-modal'))
      return
    }

    // Following shortcuts require an active note
    const isNote = state.notes.some((n) => n.id === state.activeId)
    if (!state.activeId || state.activeId === 'settings' || !isNote) return

    if (isMod && key === 's') {
      event.preventDefault()
      this.manualSave()
    } else if (isMod && key === '\\') {
      event.preventDefault()
      this.togglePreview()
    } else if (isMod && event.shiftKey && key === ',') {
      // Ctrl+Shift+, to toggle theme modal
      event.preventDefault()
      window.dispatchEvent(new CustomEvent('toggle-theme-modal'))
    } else if (key === 'escape' && this.isPreviewMode) {
      // Escape to close preview mode
      event.preventDefault()
      this.togglePreview()
    }
  }

  applySettings(settings: AppSettings): void {
    // Cache settings for when the editor is created
    this.cachedSettings = settings

    // Apply caret settings via CSS (can be done before editor is created)
    const caretWidth = Math.max(1, Math.min(10, settings.caretMaxWidth || 2))
    document.documentElement.style.setProperty('--app-caret-width', `${caretWidth}px`)
    if (!settings.caretEnabled) {
      this.editorHost?.classList.add('caret-disabled')
    } else {
      this.editorHost?.classList.remove('caret-disabled')
    }

    if (!this.editor) return

    // Save focus state and cursor position before applying theme
    const hadFocus = this.editorHost && this.editorHost.contains(document.activeElement)
    const position = this.editor.getPosition()
    const selection = this.editor.getSelection()
    const scrollTop = this.editor.getScrollTop()
    const scrollLeft = this.editor.getScrollLeft()

    const options: any = {}

    if (settings.fontSize) {
      options.fontSize = settings.fontSize
    }

    if (settings.lineNumbers !== undefined) {
      options.lineNumbers = settings.lineNumbers ? 'on' : 'off'
    }

    if (settings.wordWrap !== undefined) {
      options.wordWrap = settings.wordWrap ? 'on' : 'off'
    }

    if (settings.minimap !== undefined) {
      options.minimap = { enabled: settings.minimap }
    }

    // Apply Theme
    const editorThemeId = settings.editorTheme || settings.theme
    if (editorThemeId) {
      const theme = themes[editorThemeId]
      if (theme) {
        const isLight = editorThemeId === 'light'
        const base = isLight ? 'vs' : 'vs-dark'

        // Use a unique name for the theme to ensure Monaco registers it as a switch
        // If we reuse the name, Monaco might optimizations skip the update if it thinks current theme is the same
        const monacoThemeId = `app-theme-${editorThemeId}`

        this.monacoInstance?.editor.defineTheme(monacoThemeId, {
          base: base,
          inherit: true,
          rules: [],
          colors: {
            'editor.background': theme.colors['--bg'],
            'editor.foreground': theme.colors['--text'],
            'editor.lineHighlightBackground': 'rgba(0, 240, 255, 0.15)',
            'editor.selectionBackground': '#00f0ff40',
            'editor.selectionHighlightBackground': '#00f0ff40',
            'editor.inactiveSelectionBackground': '#00f0ff40',
            'editor.occurrenceHighlightBackground': 'rgba(0, 240, 255, 0.15)',
            'editorCursor.foreground': theme.colors['--primary'],
            'editorLineNumber.foreground': theme.colors['--muted'],
            'editorIndentGuide.background': theme.colors['--border-subtle'],
            'editorIndentGuide.activeBackground': theme.colors['--border'],
            'editorWidget.background': theme.colors['--panel-strong'],
            'editorWidget.border': theme.colors['--border']
          }
        })
        this.monacoInstance?.editor.setTheme(monacoThemeId)

        // Also apply variables to the container for CSS overrides in editor.css
        // This ensures the editor UI (empty state, host, etc) picks up the scoped theme
        Object.entries(theme.colors).forEach(([property, value]) => {
          this.container.style.setProperty(property, value as string)
        })
      } else {
        // Fallback to light/dark if custom theme not found or invalid
        switch (settings.theme) {
          case 'light':
          case 'github-light':
            this.monacoInstance?.editor.setTheme('vs')
            break
          default:
            this.monacoInstance?.editor.setTheme('vs-dark')
            break
        }
      }
    } else {
      // Default fallback
      this.monacoInstance?.editor.setTheme('vs-dark')
    }

    this.editor.updateOptions(options)

    // Apply caret styling (width and enabled/disabled)
    try {
      const caretWidth = Math.max(1, Math.min(10, settings.caretMaxWidth ?? 2))
      if (this.editorHost) {
        this.editorHost.style.setProperty('--app-caret-width', `${caretWidth}px`)
        if (settings.caretEnabled === false) {
          this.editorHost.classList.add('caret-disabled')
        } else {
          this.editorHost.classList.remove('caret-disabled')
        }
      }
    } catch (e) {
      console.warn('Failed to apply caret settings', e)
    }
    // Restore focus and cursor position after theme change
    if (hadFocus && position) {
      // Use multiple timeouts to ensure Monaco has fully rendered
      setTimeout(() => {
        if (this.editor && position) {
          try {
            // Restore scroll position first
            this.editor.setScrollTop(scrollTop)
            this.editor.setScrollLeft(scrollLeft)

            // Restore cursor position
            this.editor.setPosition(position)

            // Restore selection if it existed
            if (selection) {
              this.editor.setSelection(selection)
            }

            // Ensure cursor is visible
            this.editor.revealPosition(position, 0) // 0 = center
          } catch (e) {
            console.warn('Failed to restore editor state after theme change:', e)
          }
        }
      }, 10)

      // Restore focus in a separate timeout to ensure it happens after DOM updates
      setTimeout(() => {
        if (this.editor && hadFocus) {
          try {
            // Force focus back to editor
            if (this.editorHost) {
              // Focus the textarea inside Monaco's editor
              const textarea = this.editorHost.querySelector('textarea') as HTMLTextAreaElement
              if (textarea) {
                textarea.focus()
                textarea.setSelectionRange(textarea.selectionStart, textarea.selectionEnd)
              } else {
                this.editorHost.focus()
              }
            }
            this.editor.focus()
          } catch (e) {
            console.warn('Failed to restore editor focus after theme change:', e)
          }
        }
      }, 100) // Longer delay to ensure focus restoration
    }
  }

  private registerHashtagHighlighting(): void {
    if (!this.monacoInstance) return

    // Use a decoration-based approach for hashtag highlighting
    // This will be more reliable than trying to extend the tokenizer
    this.updateHashtagDecorations()
  }

  private updateHashtagDecorations(): void {
    if (!this.editor || !this.monacoInstance) return

    const model = this.editor.getModel()
    if (!model) return

    const content = model.getValue()
    const lines = content.split('\n')
    const decorations: any[] = []

    lines.forEach((line, lineIndex) => {
      // Highlight both #tags and @mentions
      // Highlight both #tags and @mentions (supporting letters, numbers, underscores, and dashes)
      const highlightRegex = /([#@])[a-zA-Z0-9_-]+/g
      let match
      while ((match = highlightRegex.exec(line)) !== null) {
        const startColumn = match.index + 1
        const endColumn = match.index + match[0].length + 1
        const type = match[1] === '#' ? 'hashtag' : 'mention'

        decorations.push({
          range: new this.monacoInstance!.Range(
            lineIndex + 1,
            startColumn,
            lineIndex + 1,
            endColumn
          ),
          options: {
            inlineClassName: `${type}-highlight`,
            stickiness:
              this.monacoInstance!.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
          }
        })
      }
    })

    // Apply decorations
    this.hashtagDecorations = this.editor.deltaDecorations(
      this.hashtagDecorations || [],
      decorations
    )
  }
}
