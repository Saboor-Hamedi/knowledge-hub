import { state } from '../core/state'
import type { TreeItem, NoteMeta, AppSettings, NotePayload } from '../core/types'
import { sortNotes } from '../utils/helpers'
import { sortTreeRecursive } from '../utils/tree-utils'
import { vaultService } from '../services/vaultService'
import { tabService } from '../services/tabService'
import { ragService } from '../services/rag/ragService'
import { aiStatusManager } from '../core/aiStatusManager'
import { notificationManager } from '../components/notification/notification'

export class VaultHandler {
  private refreshDebounceTimer: number | null = null
  private indexingPromise: Promise<void> | null = null

  constructor(
    public components: {
      sidebar: {
        renderTree: (filter?: string) => void
        updateSelection: (id: string) => void
        updateDirtyState: () => void
        scrollToActive: (focus: boolean) => void
        setVisible: (visible: boolean) => void
      }
      tabBar: { render: () => void }
      statusBar: {
        setStatus: (msg: string) => void
        setMeta: (msg: string) => void
        setMetrics: (
          metrics: {
            words: number
            chars: number
            lines: number
            wikiLinks: number
            tags: number
            mentions: number
          } | null
        ) => void
        setCursor: (pos: { ln: number; col: number } | null) => void
        updateVisibility: () => void
      }
      editor: {
        loadNote: (note: NotePayload) => Promise<void>
        showEmpty: () => void
        layout: () => void
        isPreviewMode: boolean
        toggleSplit?: () => void
        highlightTerm?: (q: string, mc?: boolean, ww?: boolean, ur?: boolean) => void
        focus?: () => void
      }
      breadcrumbs: { render: () => void; clear: () => void }
      activityBar: { setActiveView: (view: 'notes' | 'search' | 'settings') => void }
      welcomePage: { show: () => void; hide: () => void; isVisible: () => boolean }
    },
    private callbacks: {
      updateViewVisibility: () => void
      showWelcomePage: () => void
      openSettings?: () => Promise<void>
      openGraph?: () => Promise<void>
      onNoteOpened?: (id: string, path?: string) => void
    }
  ) {}

  public async init(): Promise<void> {
    this.components.statusBar.setStatus('Initializing...')
    // Initialize settings and vault
    await this.initVault()
    await this.refreshNotes()

    if (state.activeId) {
      const activeTab = state.openTabs.find((t) => t.id === state.activeId)
      if (activeTab) {
        await this.openNote(activeTab.id, activeTab.path)
      }
    } else if (state.openTabs.length > 0) {
      await this.openNote(state.openTabs[0].id, state.openTabs[0].path)
    } else {
      this.callbacks.showWelcomePage()
    }

    if (state.settings?.splitViewEnabled && this.components.editor.toggleSplit) {
      setTimeout(() => this.components.editor.toggleSplit?.(), 100)
    }

    this.callbacks.updateViewVisibility()

    // Initialize AI in background
    this.backgroundIndexVault().catch((err) => console.error('Background indexing failed:', err))

    state.isLoading = false
  }

  public async chooseVault(): Promise<void> {
    const vaultInfo = await window.api.chooseVault()
    if (vaultInfo && vaultInfo.path) {
      await this.handleVaultSelected(vaultInfo.path)
    }
  }

  public async handleVaultLocated(_originalPath: string, newPath: string): Promise<void> {
    await this.handleVaultSelected(newPath)
    this.components.statusBar.setStatus('Vault location updated')
  }

  public async initVault(): Promise<void> {
    try {
      const info = await window.api.getVault()
      state.vaultPath = info.path
      state.projectName = info.name
      this.components.statusBar.setMeta(`📁 ${info.path}`)
    } catch (error) {
      console.error('Failed to init vault', error)
    }
  }

  public async refreshNotes(): Promise<void> {
    // Debounce: Clear existing timer and set a new one
    if (this.refreshDebounceTimer !== null) {
      window.clearTimeout(this.refreshDebounceTimer)
    }

    return new Promise((resolve) => {
      this.refreshDebounceTimer = window.setTimeout(async () => {
        this.refreshDebounceTimer = null
        await this._refreshNotesImpl()
        resolve()
      }, 150) as unknown as number
    })
  }

  private async _refreshNotesImpl(): Promise<void> {
    const rawNotes = await window.api.listNotes()

    // Build tree
    state.tree = this.buildTree(rawNotes)
    state.notes = rawNotes.filter((n) => n.type !== 'folder')
    sortNotes(state.notes)

    // Clean up expandedFolders
    const allFolderIds = new Set<string>()
    const collectFolderIds = (items: TreeItem[]): void => {
      items.forEach((item) => {
        if (item.type === 'folder') {
          allFolderIds.add(item.id)
          if (item.children) collectFolderIds(item.children)
        }
      })
    }
    collectFolderIds(state.tree)

    let expandedChanged = false
    state.expandedFolders.forEach((id) => {
      if (!allFolderIds.has(id)) {
        state.expandedFolders.delete(id)
        expandedChanged = true
      }
    })

    if (expandedChanged) {
      void this.saveExpandedFolders()
    }

    tabService.syncTabs()
    this.components.sidebar.renderTree()
    this.components.tabBar.render()

    // Trigger background indexing to keep RAG up to date with filesystem changes
    void this.backgroundIndexVault()

    // Handle case where active note was deleted
    if (!state.activeId) {
      const nextTab = tabService.findNextTabToOpen()
      if (nextTab) {
        void this.openNote(nextTab.id, nextTab.path)
      } else {
        this.components.editor.showEmpty()
        this.components.breadcrumbs.clear()
        this.callbacks.updateViewVisibility()
      }
    } else {
      this.components.breadcrumbs.render()
    }
  }

  private buildTree(items: NoteMeta[]): TreeItem[] {
    const root: TreeItem[] = []
    const folderMap = new Map<string, TreeItem>()

    items.forEach((item) => {
      if (item.type === 'folder') {
        folderMap.set(item.id, { ...item, children: [] })
      }
    })

    items.forEach((item) => {
      const type = item.type || 'note'
      const treeItem = type === 'folder' ? folderMap.get(item.id)! : { ...item, type, children: [] }
      const parentPath = (item.path || '').replace(/\\/g, '/')

      if (parentPath === '') {
        root.push(treeItem)
      } else if (folderMap.has(parentPath)) {
        folderMap.get(parentPath)!.children?.push(treeItem)
      } else {
        root.push(treeItem)
      }
    })

    sortTreeRecursive(root)
    return root
  }

  public async openNote(
    id: string,
    path?: string,
    focusTarget: 'editor' | 'sidebar' | 'none' = 'editor',
    highlightOptions?: {
      query: string
      matchCase?: boolean
      wholeWord?: boolean
      useRegex?: boolean
    }
  ): Promise<void> {
    if (id === 'settings') {
      return this.callbacks.openSettings?.()
    }
    if (id === 'graph') {
      return this.callbacks.openGraph?.()
    }

    this.callbacks.updateViewVisibility()
    if (this.components.welcomePage.isVisible()) {
      this.components.welcomePage.hide()
    }

    const shell = document.querySelector('.vscode-shell')
    const isSidebarVisible = shell && !shell.classList.contains('sidebar-hidden')

    // Check if search or history is currently active in the activity bar
    const isSearchActive =
      state.activeView === 'search' ||
      document
        .querySelector('.activitybar__item[data-view="search"]')
        ?.classList.contains('is-active')

    const isHistoryActive = state.activeView === 'history'

    // Only switch to 'notes' if we aren't in search or history mode.
    // This allows opening search results or viewing history without losing the context.
    if (isSidebarVisible && !isSearchActive && !isHistoryActive) {
      this.components.activityBar.setActiveView('notes')
    }

    const note = await window.api.loadNote(id, path)
    if (!note) {
      await this.refreshNotes()
      const refreshed = state.notes.find((n) => n.id === id || n.path === path)
      if (refreshed) {
        return this.openNote(refreshed.id, refreshed.path, focusTarget)
      }

      notificationManager.show(`Note "${id}" could not be found.`, 'warning', {
        title: 'Note Not Found'
      })
      this.components.statusBar.setStatus('Note missing on disk')
      if (state.activeId === id || !state.activeId) {
        this.components.editor.showEmpty()
      }
      return
    }

    state.activeId = id
    state.lastSavedAt = note.updatedAt

    if (focusTarget !== 'none') {
      tabService.ensureTab(note)
    }

    if (this.components.editor.isPreviewMode) {
      this.components.editor.isPreviewMode = false
      const editorHost = this.components.editor['editorHost'] as HTMLElement
      const previewHost = this.components.editor['previewHost'] as HTMLElement
      if (editorHost) editorHost.style.display = 'block'
      if (previewHost) previewHost.style.display = 'none'
    }

    await this.components.editor.loadNote(note)

    if (highlightOptions && highlightOptions.query) {
      if (this.components.editor.highlightTerm) {
        this.components.editor.highlightTerm(
          highlightOptions.query,
          highlightOptions.matchCase,
          highlightOptions.wholeWord,
          highlightOptions.useRegex
        )
      }
    }

    this.callbacks.updateViewVisibility()
    this.components.statusBar.setStatus('Ready')
    this.components.statusBar.setMeta(`📁 ${state.vaultPath || ''}`)

    if (note.path) {
      this.revealPathInSidebar(note.path)
    }

    this.components.sidebar.updateSelection(id)
    this.components.sidebar.updateDirtyState()

    if (focusTarget === 'sidebar') {
      this.components.sidebar.scrollToActive(true)
    } else {
      this.components.sidebar.scrollToActive(false)
      if (focusTarget === 'editor') {
        const isFuzzyOpen = document.querySelector('.fuzzy-modal.is-open')
        const isModalOpen = document.querySelector('.modal-overlay.is-open')

        if (!isFuzzyOpen && !isModalOpen) {
          this.components.editor.focus?.()
        }
      }
    }

    this.components.tabBar.render()
    void this.persistWorkspace()

    this.callbacks.onNoteOpened?.(id, path)
    // viewOrchestrator is not directly accessible here, but callbacks.onNoteOpened is called.
  }

  public revealPathInSidebar(path?: string, isFolder = false): boolean {
    if (!path) return false
    const parts = path.split(/[\\/]/)
    let currentPath = ''
    let changed = false

    parts.forEach((part, index) => {
      if (!part) return
      currentPath = currentPath ? `${currentPath}/${part}` : part
      if (index < parts.length - 1 || isFolder) {
        if (!state.expandedFolders.has(currentPath)) {
          state.expandedFolders.add(currentPath)
          changed = true
        }
      }
    })

    if (changed) {
      void this.saveExpandedFolders()
      this.components.sidebar.renderTree()
      return true
    }
    return false
  }

  public async saveExpandedFolders(): Promise<void> {
    try {
      await window.api.updateSettings({
        expandedFolders: Array.from(state.expandedFolders)
      })
    } catch (error) {
      console.error('Failed to save expanded folders', error)
    }
  }

  public async persistWorkspace(): Promise<void> {
    try {
      if (state.isLoading) return
      if (state.openTabs.length === 0 && !state.vaultPath) return

      const tabsToSave = state.openTabs
        .filter((t) => !t.id.startsWith('preview-') && !t.id.startsWith('commit-'))
        .map((t) => ({ id: t.id, path: t.path, title: t.title }))

      await window.api.updateSettings({
        openTabs: tabsToSave,
        activeId: state.activeId,
        pinnedTabs: Array.from(state.pinnedTabs),
        cursorPositions: Object.fromEntries(state.cursorPositions),
        splitViewRatio: state.settings?.splitViewRatio,
        splitViewEnabled: state.settings?.splitViewEnabled
      } as Partial<AppSettings>)
    } catch (e) {
      console.error('Failed to persist workspace', e)
    }
  }

  public async backgroundIndexVault(): Promise<void> {
    if (this.indexingPromise) {
      return this.indexingPromise
    }
    this.indexingPromise = this.doBackgroundIndexVault().finally(() => {
      this.indexingPromise = null
    })
    return this.indexingPromise
  }

  private async doBackgroundIndexVault(): Promise<void> {
    const notesToIndex = state.notes
    let indexedCount = 0
    let processedCount = 0
    let isInitialized = false

    aiStatusManager.show('AI Brain: Checking...')

    // Helper to compute content hash in renderer
    const computeHash = async (content: string): Promise<string> => {
      const msgUint8 = new TextEncoder().encode(content)
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    let existingMetadata: Record<string, { updatedAt: number; contentHash?: string }> = {}
    try {
      existingMetadata = (await ragService.getAllMetadata()) as any
    } catch (e) {
      console.warn('[RAG] Failed to fetch existing metadata:', e)
    }

    const noteIdsInVault = new Set(notesToIndex.map((n) => n.id))
    const staleIds = Object.keys(existingMetadata).filter((id) => !noteIdsInVault.has(id))

    if (staleIds.length > 0) {
      console.log(`[VaultHandler] Cleaning up ${staleIds.length} stale notes from RAG...`)
      for (const id of staleIds) {
        await ragService.deleteNote(id)
      }
    }

    // Filter notes that actually need re-indexing
    const potentiallyChanged = notesToIndex.filter((note) => {
      const meta = existingMetadata[note.id]
      if (!meta) return true
      if (note.updatedAt === meta.updatedAt) return false
      return true
    })

    if (potentiallyChanged.length === 0) {
      aiStatusManager.setReady('AI Brain: Up to date')
      return
    }

    for (const note of potentiallyChanged) {
      try {
        processedCount++
        const content = (await window.api.loadNote(note.id, note.path)) as NotePayload | null
        if (!content || !content.content.trim() || content.content.length > 1024 * 1024) {
          aiStatusManager.updateProgress(processedCount, potentiallyChanged.length)
          continue
        }

        const currentHash = await computeHash(content.content)
        const meta = existingMetadata[note.id]
        if (meta && meta.contentHash && currentHash === meta.contentHash) {
          await ragService.updateMetadata(note.id, note.updatedAt, currentHash)
          aiStatusManager.updateProgress(processedCount, potentiallyChanged.length)
          continue
        }

        if (!isInitialized) {
          aiStatusManager.show('AI Brain: Loading models...')
          await ragService.init()
          isInitialized = true
        }

        await ragService.indexNote(
          note.id,
          content.content,
          {
            title: note.title,
            path: note.path,
            updatedAt: note.updatedAt
          },
          currentHash
        )
        indexedCount++
        aiStatusManager.updateProgress(processedCount, potentiallyChanged.length)
      } catch (e) {
        console.warn(`[RAG] Failed to index note ${note.title}:`, e)
      }
    }

    if (indexedCount > 0) {
      aiStatusManager.setReady(`AI Ready (${indexedCount} notes indexed)`)
    } else {
      aiStatusManager.setReady('AI Brain: Up to date')
    }
  }

  public async handleVaultSelected(path: string): Promise<void> {
    // Create transition overlay
    const overlay = document.createElement('div')
    overlay.className = 'vault-transition-overlay'
    overlay.innerHTML = `
      <div class="vault-transition-spinner"></div>
      <div class="vault-transition-text">Switching Vault...</div>
    `
    document.body.appendChild(overlay)

    // Trigger visibility
    requestAnimationFrame(() => overlay.classList.add('is-active'))

    const result = await vaultService.openVault(path)
    if (!result.success) {
      overlay.classList.remove('is-active')
      setTimeout(() => overlay.remove(), 300)
      this.components.statusBar.setStatus(`⚠️ ${result.error || 'Failed to open vault'}`)
      return
    }

    state.vaultPath = path
    state.projectName = vaultService.getVaultName(path) || 'Vault'

    const name = state.projectName
    const filtered = (state.recentProjects || []).filter((p) => p.path !== path)
    state.recentProjects = [{ name, path }, ...filtered].slice(0, 10)

    state.openTabs = []
    state.activeId = ''
    state.pinnedTabs.clear()
    state.newlyCreatedIds.clear()
    this.components.tabBar.render()

    this.components.statusBar.setStatus('Loading vault...')
    await this.refreshNotes()

    if (state.openTabs.length > 0) {
      const activeTab = state.openTabs.find((t) => t.id === state.activeId) || state.openTabs[0]
      await this.openNote(activeTab.id, activeTab.path)
    } else if (state.notes.length > 0) {
      this.callbacks.showWelcomePage()
    } else {
      state.activeId = ''
      this.callbacks.showWelcomePage()
      this.components.statusBar.setStatus('Empty vault')
    }

    this.callbacks.updateViewVisibility()
    this.components.statusBar.setMeta(`📁 ${path}`)

    // End transition early so user sees the content immediately
    const activeOverlay = document.querySelector('.vault-transition-overlay')
    if (activeOverlay) {
      activeOverlay.classList.remove('is-active')
      setTimeout(() => activeOverlay.remove(), 300)
    }

    // Dispatch global event so Terminal, Git, and other services can update
    window.dispatchEvent(new CustomEvent('vault-changed'))

    // RAG Initialization & Indexing (Handled via Header status)
    this.backgroundIndexVault().catch((err) => console.error('Background indexing failed:', err))
  }
}
