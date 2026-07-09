import { state } from './core/state'
import { tabService } from './services/tabService'
import type { AppSettings } from './core/types'
import { keyboardManager } from './core/keyboardManager'
import { modalManager } from './components/modal/modal'
import { ActivityBar } from './components/activitybar/activitybar'
import { SidebarTree } from './components/sidebar/sidebar-tree'
import { TabBar } from './components/tabbar/tabbar'
import { Breadcrumbs } from './components/breadcrumbs/breadcrumbs'
import { EditorComponent } from './components/editor/editor'
import { StatusBar } from './components/statusbar/statusbar'
import { RightBar } from './components/rightbar/rightbar'
import { SettingsView } from './components/settings/settings-view'
import { contextMenu } from './components/contextmenu/contextmenu'
import {
  Trash2,
  Info,
  Terminal,
  Zap,
  Lock,
  Unlock,
  RefreshCw,
  Search,
  BookOpen,
  PieChart
} from 'lucide'

import { ThemeModal } from './components/theme-modal/theme-modal'
import { DocumentationModal } from './components/documentation/documentation'
import { AISettingsModal } from './components/settings/ai-settings-modal'
import { FuzzyFinder } from './components/fuzzy-finder/fuzzy-finder'
import { ConsoleComponent } from './components/console/console'
import { RealTerminalComponent } from './components/terminal/real-terminal'
import { GraphView } from './components/graph/graph'
import { TimelineComponent } from './components/timeline/timeline'
import { SearchModal } from './knm/components/SearchModal'
import { SearchModal } from "./knm/components/SearchModal";
import { themeManager } from './core/themeManager'
import { ErrorHandler } from './utils/error-handler'
import { notificationManager } from './components/notification/notification'
import { aiService } from './services/aiService'
import { agentExecutor } from './services/agent/executor'
import { TabHandlersImpl } from './handlers/tabHandlers'
import { WikiLinkService } from './components/wikilink/wikilinkService'
import { PreviewHandlers } from './handlers/previewHandlers'
import { vaultService } from './services/vaultService'
import { VaultPicker } from './components/vault-picker/vault-picker'
import { WelcomePage } from './components/welcome-page/welcome-page'
import { ragService } from './knm/rag/ragService'
import { securityService } from './services/security/securityService'
import { updateApp } from './components/updateApp/updateRender'
import { VaultHandler } from './handlers/VaultHandler'
import { FileOperationHandler } from './handlers/FileOperationHandler'
import { ViewOrchestrator } from './handlers/ViewOrchestrator'
import { SyncHandler } from './services/sync/syncHandler'
import { applySearchInputStyles } from './utils/searchInputStyles'

declare global {
  interface Window {
    onSettingChange?: (settings: Partial<AppSettings>) => void
  }
}

class App {
  private activityBar: ActivityBar
  private sidebar: SidebarTree
  private tabBar: TabBar
  private breadcrumbs: Breadcrumbs
  private editor: EditorComponent
  private statusBar: StatusBar
  private settingsView: SettingsView
  private rightBar: RightBar
  private themeModal: ThemeModal
  private documentationModal: DocumentationModal
  private aiSettingsModal: AISettingsModal
  private fuzzyFinder: FuzzyFinder
  private graphView: GraphView
  private graphTabView: GraphView
  private tabHandlers!: TabHandlersImpl
  private wikiLinkService!: WikiLinkService
  private previewHandlers!: PreviewHandlers
  private vaultPicker!: VaultPicker
  private hubConsole: ConsoleComponent
  private realTerminal: RealTerminalComponent
  private pendingPersist: number | null = null
  private pendingSettingsUpdate: number | null = null
  private welcomePage: WelcomePage
  private timeline: TimelineComponent
  private searchModal: SearchModal

  private vaultHandler: VaultHandler
  private fileOps: FileOperationHandler
  private viewOrchestrator: ViewOrchestrator
  private syncHandler: SyncHandler
  private previewCache = new Map<string, string>()

  constructor() {
    this.activityBar = new ActivityBar('activityBar')
    this.sidebar = new SidebarTree('sidebar')
    this.tabBar = new TabBar('tabBar')
    this.breadcrumbs = new Breadcrumbs('breadcrumbs')
    this.editor = new EditorComponent('editorContainer')
    this.statusBar = new StatusBar('statusBar')
    this.welcomePage = new WelcomePage('welcomeHost')
    this.hubConsole = new ConsoleComponent('consoleHost')
    this.realTerminal = new RealTerminalComponent('terminalHost', this.hubConsole)
    this.settingsView = new SettingsView('settingsHost')
    this.themeModal = new ThemeModal('app')
    this.documentationModal = new DocumentationModal('app')
    this.aiSettingsModal = new AISettingsModal('app')
    this.rightBar = new RightBar('rightPanel', this.aiSettingsModal)
    this.fuzzyFinder = new FuzzyFinder()
    this.graphView = new GraphView(document.body, true) // Modal instance

    const graphHost = document.getElementById('graphHost')
    this.graphTabView = new GraphView(graphHost || document.body, false) // Tab instance
    this.timeline = new TimelineComponent('timelineHost')

    this.searchModal = new SearchModal()

    this.viewOrchestrator = new ViewOrchestrator({
      editor: this.editor,
      settingsView: this.settingsView,
      welcomePage: this.welcomePage,
      tabBar: this.tabBar,
      statusBar: this.statusBar,
      activityBar: this.activityBar,
      breadcrumbs: this.breadcrumbs,
      graphTabView: this.graphTabView,
      timeline: this.timeline,
      rightBar: this.rightBar
    })

    this.vaultHandler = new VaultHandler(
      {
        sidebar: this.sidebar,
        tabBar: this.tabBar,
        statusBar: this.statusBar,
        editor: this.editor,
        breadcrumbs: this.breadcrumbs,
        activityBar: this.activityBar,
        welcomePage: this.welcomePage
      },
      {
        updateViewVisibility: () => this.viewOrchestrator.updateViewVisibility(),
        showWelcomePage: () => this.viewOrchestrator.showWelcomePage(),
        openSettings: () => this.viewOrchestrator.openSettings(),
        openGraph: () => this.viewOrchestrator.openGraph(),
        onNoteOpened: (id: string, path?: string) => {
          this.viewOrchestrator.updateEditorMetrics()
          // Update timeline if in history view
          if (state.activeView === 'history') {
            this.timeline.update(id, path || id)
          }
        }
      }
    )

    this.fileOps = new FileOperationHandler(
      {
        sidebar: this.sidebar,
        tabBar: this.tabBar,
        statusBar: this.statusBar,
        editor: this.editor,
        breadcrumbs: this.breadcrumbs
      },
      {
        refreshNotes: () => this.vaultHandler.refreshNotes(),
        openNote: (id, path, focus) => this.vaultHandler.openNote(id, path, focus),
        saveExpandedFolders: () => this.vaultHandler.saveExpandedFolders(),
        persistWorkspace: () => this.vaultHandler.persistWorkspace(),
        updateViewVisibility: () => this.viewOrchestrator.updateViewVisibility()
      }
    )

    this.tabHandlers = new TabHandlersImpl(
      this.tabBar,
      this.statusBar,
      this.editor,
      () => this.vaultHandler.persistWorkspace(),
      () => this.viewOrchestrator.updateViewVisibility()
    )

    this.wikiLinkService = new WikiLinkService({
      openNote: (id, path) => this.vaultHandler.openNote(id, path),
      createNote: (title, path) => this.fileOps.createNote(title, undefined, path),
      getEditorValue: () => this.editor.getValue(),
      setStatus: (message) => this.statusBar.setStatus(message)
    })

    this.previewHandlers = new PreviewHandlers({
      showPreview: (content) => this.editor.showPreview(content),
      updateViewVisibility: () => this.viewOrchestrator.updateViewVisibility(),
      setStatus: (message) => this.statusBar.setStatus(message),
      setMeta: (message) => this.statusBar.setMeta(message),
      updateSidebarSelection: (noteId) => this.sidebar.updateSelection(noteId),
      renderTabBar: () => this.tabBar.render(),
      persistWorkspace: () => this.vaultHandler.persistWorkspace()
    })

    this.vaultPicker = new VaultPicker('app')
    this.syncHandler = new SyncHandler(this.vaultHandler)

    this.vaultPicker.setCallbacks({
      onVaultSelected: (path) => this.vaultHandler.handleVaultSelected(path),
      onVaultLocated: (orig, newP) => this.vaultHandler.handleVaultLocated(orig, newP),
      onChooseNew: () => this.vaultHandler.chooseVault()
    })

    this.welcomePage.setOpenFolderHandler(() => this.vaultHandler.chooseVault())
    this.welcomePage.setCreateNewHandler(() => this.vaultHandler.chooseVault())
    this.welcomePage.setProjectSelectHandler((path) => this.vaultHandler.handleVaultSelected(path))
    this.welcomePage.setOpenDocsHandler(() => this.documentationModal.open())

    this.breadcrumbs.setNoteOpenHandler((id) => this.vaultHandler.openNote(id))
    this.breadcrumbs.setDeleteItemHandler((item) => {
      void this.fileOps.deleteItems([item])
    })

    this.wireComponents()
    this.registerGlobalShortcuts()
    this.wireUpdateEvents()
    this.attachSyncEvents()
    this.registerGlobalCommands()

    window.addEventListener('resize', () => this.editor.layout())
    window.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          if (
            e.target instanceof Node &&
            document.querySelector('.monaco-editor')?.contains(e.target)
          ) {
            return
          }
          e.preventDefault()
        }
      },
      { passive: false }
    )
    window.addEventListener('delete-active-note', () => {
      if (state.activeId) {
        const note = state.notes.find((n) => n.id === state.activeId)
        void this.fileOps.deleteItems([{ id: state.activeId, type: 'note', path: note?.path }])
      }
    })
    window.addEventListener('vault-changed', () => {
      void this.vaultHandler.refreshNotes()
      void this.vaultHandler.saveExpandedFolders()
    })
    window.api.onVaultChanged(() => {
      window.dispatchEvent(new CustomEvent('vault-changed'))
    })
    window.addEventListener('status', ((e: CustomEvent<{ message: string }>) => {
      if (e.detail?.message) this.statusBar.setStatus(e.detail.message)
    }) as EventListener)
    window.addEventListener(
      'toggle-right-sidebar',
      () => void this.viewOrchestrator.toggleRightSidebar()
    )
    window.addEventListener(
      'toggle-rightbar',
      () => void this.viewOrchestrator.toggleRightSidebar()
    )
    window.addEventListener('toggle-hub-console', () => this.realTerminal.showConsole())
    window.addEventListener('knowledge-hub:rename-item', ((
      e: CustomEvent<{ id: string; type: 'note' | 'folder'; title: string }>
    ) => {
      const { id, type, title } = e.detail
      void this.promptRenameItem(id, type, title)
    }) as EventListener)
    window.addEventListener('knowledge-hub:open-note', ((
      e: CustomEvent<{ id: string; path: string }>
    ) => {
      const { id, path } = e.detail
      void this.vaultHandler.openNote(id, path)
    }) as EventListener)
    window.addEventListener('toggle-documentation-modal', () => this.documentationModal.toggle())
    window.addEventListener('open-ingestion-modal', () => this.searchModal.showUpload())
    window.addEventListener('open-search-modal', () => this.searchModal.show())
    window.addEventListener('knowledge-hub:insert-at-cursor', ((
      e: CustomEvent<{ content: string }>
    ) => {
      if (e.detail?.content) {
        this.editor.insertAtCursor(e.detail.content)
      }
    }) as EventListener)

    window.addEventListener('knowledge-hub:delete-item', ((
      e: CustomEvent<{ items: { id: string; type: 'note' | 'folder'; path?: string }[] }>
    ) => {
      const { items } = e.detail
      void this.fileOps.deleteItems(items)
    }) as EventListener)

    window.addEventListener('knowledge-hub:focus-folder', ((e: CustomEvent<{ path: string }>) => {
      const path = e.detail?.path
      if (path) {
        this.sidebar.show()
        this.vaultHandler.revealPathInSidebar(path, true)
        this.sidebar.scrollToActive(false)
      }
    }) as EventListener)

    window.addEventListener('knowledge-hub:duplicate-item', ((
      e: CustomEvent<{ id: string; type: 'note' | 'folder' }>
    ) => {
      const { id, type } = e.detail
      void this.fileOps.duplicateItem(id, type)
    }) as EventListener)

    // Handle Timeline Compare
    // Handle Timeline Compare
    window.addEventListener('timeline:compare', ((
      e: CustomEvent<{ commit: { hash: string; timestamp: number }; path: string; content: string }>
    ) => {
      console.log('[App] Compare requested', e.detail)
      const { commit, path, content } = e.detail

      const id = `commit-${commit.hash.substring(0, 7)}-${path}`
      const title = `${path.split(/[/\\]/).pop()} (@${commit.hash.substring(0, 7)})`

      this.previewCache.set(id, content)

      // Ensure tab exists
      tabService.ensureTab({
        id,
        title,
        updatedAt: commit.timestamp,
        path: undefined,
        type: 'note'
      })

      // Manually set active and show immediately
      state.activeId = id

      // Force UI updates
      this.welcomePage.hide()
      const editorHost = document.getElementById('editorContainer')
      if (editorHost) editorHost.style.display = 'block' // or flex, depending on layout

      this.tabBar.render()

      // Show content
      this.editor.showPreview(content)
      this.statusBar.setStatus(`Viewing ${title}`)

      // Ensure layout is correct
      this.viewOrchestrator.updateViewVisibility()
    }) as EventListener)

    // Terminal toggle via custom event (triggered by Monaco command or global shortcut)
    window.addEventListener('toggle-terminal', () => {
      console.log('[App] toggle-terminal event received')
      const isOpen = this.realTerminal.toggle()
      if (!isOpen) {
        // Restore focus to editor when terminal is closed
        this.editor.focus()
      }
    })

    this.realTerminal.setNoteSelectHandler((id: string, path?: string) => {
      void this.vaultHandler.openNote(id, path)
    })

    window.addEventListener('beforeunload', () => void this.vaultHandler.persistWorkspace())
  }

  async init(): Promise<void> {
    ErrorHandler.init()
    await this.initSettings()
    this.hubConsole.setHandlers(this.fileOps)
    this.registerConsoleCommands()

    // 1. Prepare data and security
    await Promise.all([this.vaultHandler.init(), securityService.requestUnlock()])

    // 2. Lock layout with no transitions, then reveal
    document.body.classList.add('no-transitions')

    // Give the browser two frames to settle the layout
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    // 3. Reveal the finished stage
    document.body.classList.remove('is-loading')

    // 4. Release transition lock after a small grace period (100ms)
    // This ensures any JS-triggered layout changes are finished before animations are enabled.
    setTimeout(() => {
      document.body.classList.remove('no-transitions')
    }, 100)

    this.wireUpdateEvents()
  }

  private async initSettings(): Promise<void> {
    state.settings = await window.api.getSettings()

    const isNewInstance = window.location.search.includes('newInstance=true')

    if (!isNewInstance) {
      if (state.settings.expandedFolders)
        state.expandedFolders = new Set(state.settings.expandedFolders)
      if (state.settings.pinnedTabs) state.pinnedTabs = new Set(state.settings.pinnedTabs)
      if (state.settings.cursorPositions)
        state.cursorPositions = new Map(Object.entries(state.settings.cursorPositions))
      if (state.settings.openTabs) {
        // Map basic tab info to NoteMeta format expected by state.openTabs
        state.openTabs = state.settings.openTabs.map(
          (t: { id: string; path?: string; title?: string }) => ({
            id: t.id,
            path: t.path || '',
            title: t.title || t.id, // Use saved title if available
            updatedAt: 0
          })
        )
        console.log(`[App] Restored ${state.openTabs.length} tabs from settings`)
      }
      if (state.settings.activeId) state.activeId = state.settings.activeId
      // Restore active view (explorer, search, history, etc.)
      if (state.settings.activeView) {
        state.activeView = state.settings.activeView
        this.activityBar.setActiveView(state.settings.activeView, false)
      }
    }

    if (state.settings.theme) themeManager.setTheme(state.settings.theme)

    if (state.settings.recentVaults) {
      state.recentProjects = state.settings.recentVaults.map((path) => ({
        name: vaultService.getVaultName(path),
        path
      }))
    }

    if (state.settings) {
      this.editor.applySettings(state.settings)
      await this.realTerminal.applySettings(state.settings)
      // Always restore layout from saved settings.json values
      this.viewOrchestrator.restoreLayout({
        ...state.settings,
        rightPanelVisible: isNewInstance ? false : state.settings.rightPanelVisible,
        sidebarVisible: isNewInstance ? false : (state.settings.sidebarVisible ?? true)
      })
      // Ensure UI components reflect loaded settings immediately
      this.sidebar.applyStyles()
      this.activityBar.applyStyles()
      this.statusBar.updateVisibility()
      applySearchInputStyles(state.settings!)

      // Notify components that settings are loaded
      window.dispatchEvent(new CustomEvent('knowledge-hub:settings-updated'))
    }
  }

  private schedulePersist(): void {
    if (this.pendingPersist) window.clearTimeout(this.pendingPersist)
    this.pendingPersist = window.setTimeout(
      () => void this.vaultHandler.persistWorkspace(),
      300
    ) as unknown as number
  }

  private wireComponents(): void {
    this.activityBar.setViewChangeHandler((view) => {
      if (view === 'settings') return void this.viewOrchestrator.openSettings()
      if (view === 'theme') return this.themeModal.open()
      if (view === 'graph') return void this.viewOrchestrator.openGraph()
      if (view === 'documentation') return this.documentationModal.toggle()
      if (view === 'history') {
        this.sidebar.show()
        this.viewOrchestrator.updateViewVisibility()
        return
      }
      if (view === 'lock') return void securityService.lock()

      const isSidebarView = view === 'notes' || view === 'search'
      this.sidebar.setVisible(isSidebarView)
      this.sidebar.setMode(view === 'search' ? 'search' : 'explorer')
      this.viewOrchestrator.updateViewVisibility()
      this.editor.layout()
    })

    this.sidebar.setVisibilityChangeHandler((visible) => {
      if (state.settings) {
        state.settings.sidebarVisible = visible
      }
      window.api.updateSettings({ sidebarVisible: visible }).catch(() => {})
      this.activityBar.render()
    })

    this.sidebar.setNoteSelectHandler((id, path, highlight) => {
      void this.vaultHandler.openNote(id, path, 'editor', highlight)
    })
    this.sidebar.setNoteCreateHandler(
      (path) => void this.fileOps.createNote(undefined, undefined, path)
    )
    this.sidebar.setNoteDeleteHandler(
      (id, path) => void this.fileOps.deleteItems([{ id, type: 'note', path }])
    )
    this.sidebar.setItemsDeleteHandler((items) => void this.fileOps.deleteItems(items))
    this.sidebar.setNoteMoveHandler((id, from, to) => this.fileOps.handleNoteMove(id, from, to))
    this.sidebar.setFolderMoveHandler((src, tgt) => this.fileOps.handleFolderMove(src, tgt))
    this.sidebar.setFolderCreateHandler(
      (path) => void this.fileOps.createFolder('New Folder', path)
    )
    this.sidebar.setRefreshHandler(() => void this.vaultHandler.refreshNotes())
    this.sidebar.setGraphClickHandler(() => void this.viewOrchestrator.openGraph())
    this.sidebar.setSearchHandler((query, options) => {
      this.editor.highlightTerm(query, options.matchCase, options.wholeWord, options.useRegex)
    })

    window.addEventListener('knowledge-hub:propose-note', async (e: Event) => {
      const { id, content, isBatched } = (
        e as CustomEvent<{ id: string; content: string; isBatched?: boolean }>
      ).detail
      // 1. Ensure the note is open
      await this.vaultHandler.openNote(id, undefined, 'editor')
      // 2. Propose changes in the editor
      this.editor.proposeChanges(content, { skipScroll: !!isBatched })
    })

    this.fuzzyFinder.setSelectHandler(async (id, path, type, isFinal) => {
      if (type === 'folder') {
        this.vaultHandler.revealPathInSidebar(path, true)
      } else {
        await this.vaultHandler.openNote(id, path, isFinal ? 'editor' : 'none')
      }
    })

    this.tabBar.setTabSelectHandler(async (id) => {
      this.previewHandlers.closePreviewTabs(id)
      if (id === 'settings') return void this.viewOrchestrator.openSettings()

      // Check if it's a cached preview (e.g. commit comparison)
      if (this.previewCache.has(id)) {
        state.activeId = id
        this.tabBar.render()
        const content = this.previewCache.get(id)!
        this.editor.showPreview(content)
        this.statusBar.setStatus('Read-only Preview')
        return
      }

      const tab = state.openTabs.find((t) => t.id === id)
      if (tab) await this.vaultHandler.openNote(tab.id, tab.path)
    })

    this.tabBar.setTabCloseHandler((id) => {
      if (this.previewCache.has(id)) {
        this.previewCache.delete(id)
      }
      void this.closeTab(id)
    })

    this.tabBar.setTabContextMenuHandler((id, e) => {
      this.tabHandlers.handleTabContextMenu(
        id,
        e,
        (id, f) => this.closeTab(id, f),
        (id) => this.tabHandlers.closeOtherTabs(id, (id, f) => this.closeTab(id, f)),
        () => this.tabHandlers.closeAllTabs((id, f) => this.closeTab(id, f))
      )
    })

    this.tabBar.setTabReorderHandler(() => {
      void this.vaultHandler.persistWorkspace()
    })

    this.settingsView.setVaultCallbacks({
      onVaultChange: () => this.vaultHandler.chooseVault(),
      onVaultReveal: () => window.api.revealVault(),
      onVaultSelected: (p) => this.vaultHandler.handleVaultSelected(p),
      onVaultLocated: (o, n) => this.vaultHandler.handleVaultLocated(o, n)
    })

    this.settingsView.setSettingChangeHandler((newSettings) =>
      this.handleSettingChange(newSettings)
    )
    window.onSettingChange = (s) => this.handleSettingChange(s)

    this.editor.setContentChangeHandler(() => {
      this.statusBar.setStatus('Unsaved changes')
      this.tabBar.render()
      this.breadcrumbs.render()
      this.sidebar.updateDirtyState()
      this.viewOrchestrator.updateEditorMetrics()
    })
    this.editor.setCursorPositionChangeHandler(() => {
      this.viewOrchestrator.updateEditorMetrics()
      this.schedulePersist()
    })
    this.editor.setSaveHandler((payload) => void this.fileOps.saveNote(payload))
    this.editor.setDropHandler((p, f) => this.handleDrop(p, f))
    this.editor.setLinkClickHandler((t) => void this.wikiLinkService.openWikiLink(t))
    this.editor.setHoverContentHandler(async (t) => {
      const note = this.wikiLinkService.resolveNote(t)
      if (!note) return null
      try {
        const loaded = await window.api.loadNote(note.id, note.path)
        return loaded?.content || null
      } catch {
        return null
      }
    })
    this.editor.setContextMenuHandler((e) => this.handleEditorContextMenu(e))
    this.editor.setCursorPositionChangeHandler(() => this.viewOrchestrator.updateEditorMetrics())
    this.editor.attachKeyboardShortcuts()

    this.themeModal.setThemeChangeHandler((updates) => {
      void this.handleSettingChange(updates)
    })

    this.rightBar.setEditorContext(
      () => this.editor.getValue(),
      () => {
        if (state.activeId && state.activeId !== 'settings') {
          const note = state.notes.find((n) => n.id === state.activeId)
          return note ? { title: note.title, id: note.id } : null
        }
        return null
      },
      () => this.editor.getCursorPosition()
    )

    this.rightBar.setApplyCodeHandler((code) => {
      this.editor.insertAtCursor(code)
      this.statusBar.setStatus('Code applied to editor')
    })
  }

  private async handleSettingChange(newSettings: Partial<AppSettings>): Promise<void> {
    if (state.settings) {
      // Create a copy of current settings
      const updatedSettings = { ...state.settings }

      // Iterate through updates and deep merge known objects
      for (const key in newSettings) {
        const k = key as keyof AppSettings
        const val = newSettings[k]

        const updatedSettingsRec = updatedSettings as Record<string, unknown>
        const valRec = val as Record<string, unknown>

        if (val && typeof val === 'object' && !Array.isArray(val) && updatedSettings[k]) {
          // Deep merge for fireWall, windowBounds, etc.
          updatedSettingsRec[k] = {
            ...(updatedSettings[k] as Record<string, unknown>),
            ...valRec
          }
        } else {
          // Direct assignment for primitives and arrays
          updatedSettingsRec[k] = val
        }
      }

      state.settings = updatedSettings
      this.editor.applySettings(state.settings)
      void this.realTerminal.applySettings(state.settings)
      // Boost performance for live updates by syncing with frame rate
      requestAnimationFrame(() => {
        this.tabBar.render()
        this.sidebar.applyStyles()
        this.activityBar.applyStyles()
        applySearchInputStyles(state.settings!)
      })

      // Debounce the actual disk/IPC update to prevent lag during rapid sliding
      if (this.pendingSettingsUpdate) window.clearTimeout(this.pendingSettingsUpdate)
      this.pendingSettingsUpdate = window.setTimeout(() => {
        void window.api.updateSettings(newSettings)
        this.statusBar.setStatus('Settings auto-saved')

        // If settings view is active, trigger a re-render to reflect potentially cleared overrides
        if (state.activeId === 'settings' || state.activeView === 'settings') {
          this.settingsView.render()
        }
      }, 500) as unknown as number

      if (newSettings.deepseekApiKey !== undefined) {
        await aiService.loadApiKey()
        await this.rightBar.refreshApiKey()
      }

      if (newSettings.theme !== undefined) {
        themeManager.setTheme(newSettings.theme)
      }
    }
  }

  private async closeTab(id: string, force = false): Promise<void> {
    if (id === 'settings') {
      return this.viewOrchestrator.closeSettings()
    }
    if (id === 'graph') {
      return this.viewOrchestrator.closeGraph()
    }
    await this.tabHandlers.closeTab(
      id,
      force,
      async (id, path) => {
        await window.api.deleteNote(id, path)
      },
      () => this.vaultHandler.refreshNotes(),
      (id, path) => {
        if (this.previewCache.has(id)) {
          state.activeId = id
          this.tabBar.render()
          this.viewOrchestrator.updateViewVisibility()
          const content = this.previewCache.get(id)!
          this.editor.showPreview(content)
          this.statusBar.setStatus('Read-only Preview')
          return Promise.resolve()
        }
        return this.vaultHandler.openNote(id, path)
      },
      () => this.viewOrchestrator.showWelcomePage()
    )
  }

  private async promptRenameItem(
    id: string,
    type: 'note' | 'folder',
    currentTitle: string
  ): Promise<void> {
    modalManager.open({
      title: `Rename ${type === 'note' ? 'Note' : 'Folder'}`,
      inputs: [
        {
          name: 'title',
          label: 'New Title',
          value: currentTitle,
          required: true,
          placeholder: `Enter ${type} name...`
        }
      ],
      buttons: [
        {
          label: 'Rename',
          onClick: async (m) => {
            const { title: newTitle } = m.getValues()
            if (newTitle && newTitle !== currentTitle) {
              try {
                if (type === 'note') await this.fileOps.renameNote(id, newTitle, () => m.close())
                else await this.fileOps.renameFolder(id, newTitle, () => m.close())
              } catch (err: unknown) {
                notificationManager.show((err as Error).message || 'Rename failed', 'error')
              }
            } else {
              m.close()
            }
          }
        },
        { label: 'Cancel', variant: 'ghost', onClick: (m) => m.close() }
      ]
    })
  }

  private async promptRenameActiveNote(): Promise<void> {
    const note = state.notes.find((n) => n.id === state.activeId)
    if (note) await this.promptRenameItem(note.id, 'note', note.title)
  }

  private async handleDrop(filePath: string, isInternal: boolean): Promise<void> {
    if (isInternal && filePath.toLowerCase().endsWith('.md')) {
      const name = filePath.split(/[/\\]/).pop() || ''
      const id = name.replace(/\.[^.]+$/, '')
      let note = state.notes.find((n) => n.id === id)
      if (!note) {
        await this.vaultHandler.refreshNotes()
        note = state.notes.find((n) => n.id === id)
      }
      if (note) return void this.vaultHandler.openNote(note.id, note.path)
    }

    try {
      this.statusBar.setStatus('Importing file...')
      const imported = await window.api.importNote(filePath)
      this.statusBar.setStatus(`✓ Imported "${imported.title}"`)
      await this.vaultHandler.refreshNotes()
      await this.vaultHandler.openNote(imported.id, imported.path)
      const notePayload = await window.api.loadNote(imported.id, imported.path)
      if (notePayload?.content) {
        await ragService.indexNote(imported.id, notePayload.content, {
          title: imported.title,
          path: imported.path
        })
      }
    } catch {
      this.statusBar.setStatus('⚠️ Import failed')
    }
  }

  private handleEditorContextMenu(e: MouseEvent): void {
    e.preventDefault()
    contextMenu.show(e.clientX, e.clientY, [
      {
        label: 'Cut',
        keybinding: 'Ctrl+X',
        onClick: () => {
          this.editor.focus()
          this.editor.triggerAction('editor.action.clipboardCutAction')
        }
      },
      {
        label: 'Copy',
        keybinding: 'Ctrl+C',
        onClick: () => {
          this.editor.focus()
          this.editor.triggerAction('editor.action.clipboardCopyAction')
        }
      },
      {
        label: 'Paste',
        keybinding: 'Ctrl+V',
        onClick: () => {
          this.editor.focus()
          this.editor.triggerAction('editor.action.clipboardPasteAction')
        }
      },
      { separator: true },
      {
        label: 'Insert Date',
        onClick: () => this.editor.insertAtCursor(new Date().toLocaleString())
      },
      { separator: true },
      {
        label: 'Delete Line',
        onClick: () => {
          this.editor.focus()
          this.editor.triggerAction('editor.action.deleteLines')
        }
      },
      {
        label: 'Select All',
        keybinding: 'Ctrl+A',
        onClick: () => {
          this.editor.focus()
          this.editor.triggerAction('editor.action.selectAll')
        }
      },
      { separator: true },
      {
        label: 'Open Preview',
        keybinding: 'Ctrl+\\',
        onClick: () => void this.previewHandlers.openPreviewTab()
      },
      {
        label: 'Details',
        keybinding: 'Ctrl+I',
        onClick: () => this.viewOrchestrator.showDetailsModal()
      },
      { separator: true },
      { label: 'Knowledge Graph', keybinding: 'Alt+G', onClick: () => this.graphView.open() }
    ])
  }

  private wireUpdateEvents(): void {
    const list = ['available', 'not-available', 'progress', 'downloaded', 'error']
    list.forEach((ev) => {
      window.electron?.ipcRenderer?.on?.(`update:${ev}`, (_e, data) => {
        if (ev === 'available') this.statusBar.setStatus('Update available...')
        if (ev === 'progress')
          this.statusBar.setStatus(`Downloading... ${data?.percent?.toFixed(1)}%`)
        if (ev === 'downloaded') this.statusBar.setStatus('Update ready.')
        if (ev === 'error') this.statusBar.setStatus(`Update error: ${data}`)
      })
    })
  }

  private attachSyncEvents(): void {
    window.addEventListener('restore-vault', ((e: CustomEvent<{ backupData: string }>) => {
      if (e.detail?.backupData) {
        void this.syncHandler.restoreVaultFromBackup(e.detail.backupData)
      }
    }) as unknown as EventListener)

    const statusBarEl = document.getElementById('statusBar')
    statusBarEl?.addEventListener('sync-action', ((
      e: CustomEvent<{ action: 'backup' | 'restore' }>
    ) => {
      const { action } = e.detail
      if (action === 'backup') {
        void this.syncHandler.backupVault()
      } else if (action === 'restore') {
        void this.syncHandler.restoreVault()
      }
    }) as unknown as EventListener)
  }

  private registerGlobalShortcuts(): void {
    const reg = (
      key: string,
      desc: string,
      handler: () => boolean | void | Promise<void>
    ): void => {
      keyboardManager.register({ key, scope: 'global', description: desc, handler })
    }

    reg('Alt+g', 'Open Graph Modal', () => {
      this.graphView.open()
    })
    reg('Control+Shift+g', 'Open Graph Tab', () => {
      void this.viewOrchestrator.openGraph()
    })
    reg('Alt+l', 'Lock Application', () => void securityService.promptAndLock())
    reg('Control+f', 'Find', () => {
      if (this.realTerminal.hasFocus()) {
        this.realTerminal.toggleSearch(true)
      } else {
        this.editor.focus()
        this.editor.triggerAction('actions.find')
      }
      return true
    })
    reg('Control+p', 'Quick Open', () => this.fuzzyFinder.toggle('notes'))
    reg('Control+Shift+f', 'Global search', () => {
      const selection = this.editor.getSelection()
      const isSearchActive = state.activeView === 'search'
      const shell = document.querySelector('.vscode-shell')
      const isSidebarVisible = shell && !shell.classList.contains('sidebar-hidden')

      if (isSearchActive && isSidebarVisible && !selection) {
        // Only toggle off if we're already in search, sidebar is shown, and we don't have new text to search
        this.sidebar.hide()
      } else {
        // Open search
        this.activityBar.setActiveView('search')
        this.sidebar.show()
        if (selection) {
          this.sidebar.setSearchQuery(selection)
        }
      }
    })
    reg('Control+k', 'Global Search', () => this.searchModal.show())
    reg('Control+Shift+u', 'Import Data', () => this.searchModal.showUpload())
    reg('Control+Shift+p', 'Command Palette', () => this.fuzzyFinder.toggle('commands'))
    reg('Control+i', 'Toggle Right Sidebar', () => void this.viewOrchestrator.toggleRightSidebar())
    reg('Control+Alt+s', 'Open AI Configuration', () => this.aiSettingsModal.open())

    window.addEventListener('open-ingestion-modal', () => {
      this.searchModal.showUpload()
    })

    reg('Control+F5', 'Reload Window', () => window.location.reload())
    reg('Control+Shift+r', 'Reload vault', () => void this.reloadVault())
    reg('Control+Shift+v', 'Choose vault', () => void this.vaultHandler.chooseVault())
    reg('Control+n', 'New note', () => void this.fileOps.createNote())
    reg('Control+s', 'Save note', () => {
      if (state.activeId && state.activeId !== 'settings' && state.activeId !== 'graph') {
        this.editor.manualSave()
        const note = state.notes.find((n) => n.id === state.activeId)
        if (note && /^Untitled( \d+)?$/i.test(note.title)) void this.promptRenameActiveNote()
      }
    })
    reg('Control+r', 'Rename active item', async () => {
      const sidebarEl = document.querySelector('.sidebar__body') as HTMLElement
      const isSidebarFocused = sidebarEl?.contains(document.activeElement)

      if (isSidebarFocused && state.selectedIds.size === 1) {
        const id = Array.from(state.selectedIds)[0]
        const item = document.querySelector(`.tree-item[data-id="${id}"]`) as HTMLElement
        const type = item?.dataset.type as 'note' | 'folder'
        const label = item?.querySelector('.tree-item__label') as HTMLElement
        if (id && type && label) {
          await this.promptRenameItem(id, type, label.textContent?.trim() || '')
        }
      } else {
        await this.promptRenameActiveNote()
      }
    })
    reg('Control+b', 'Toggle sidebar', () => this.sidebar.toggle())
    reg('Control+d', 'Delete item', () => {
      if (state.activeId === 'settings' || state.activeId === 'graph') {
        return
      }
      if (state.selectedIds.size > 0) {
        const items = Array.from(state.selectedIds).map((id) => {
          const n = state.notes.find((x) => x.id === id)
          return { id, type: n ? ('note' as const) : ('folder' as const), path: n?.path }
        })
        void this.fileOps.deleteItems(items)
      } else if (state.activeId) {
        const n = state.notes.find((x) => x.id === state.activeId)
        void this.fileOps.deleteItems([{ id: state.activeId, type: 'note', path: n?.path }])
      }
    })
    reg('Control+,', 'Open settings', () => void this.viewOrchestrator.openSettings())
    reg('Control+Shift+<', 'Select theme', () => this.themeModal.toggle())
    reg('Control+Shift+\\', 'Docs', () => {
      this.documentationModal.toggle()
      return true
    })

    reg('Control+j', 'Toggle Terminal', () => {
      window.dispatchEvent(new CustomEvent('toggle-terminal'))
    })
    reg('Control+`', 'Toggle Terminal', () => {
      window.dispatchEvent(new CustomEvent('toggle-terminal'))
    })
    reg('Control+l', 'Lock Application', () => void securityService.promptAndLock())
    reg('Alt+l', 'Lock Application', () => void securityService.promptAndLock())
    reg('Control+w', 'Close active tab', () => {
      if (state.activeId && !state.pinnedTabs.has(state.activeId)) {
        if (state.activeId === 'settings') {
          void this.viewOrchestrator.closeSettings()
        } else {
          void this.closeTab(state.activeId)
        }
      }
      return true // Always prevent default to stop window closure
    })
    reg('Escape', 'Close UI', () => {
      if (this.fuzzyFinder.isVisible) {
        this.fuzzyFinder.close()
        return true
      }
      if (state.activeId?.startsWith('preview-')) {
        void this.closeTab(state.activeId)
        return true
      }
      if (modalManager.getCurrent()) {
        modalManager.close()
        return true
      }
      return false
    })
  }

  private registerConsoleCommands(): void {
    this.hubConsole.registerCommand({
      name: 'help',
      description: 'List available commands',
      icon: Info,
      action: () => {
        this.hubConsole.log('Available Commands:', 'system')
        this.hubConsole.log('  index-vault     - Re-index for AI search')
        this.hubConsole.log('  lock            - Lock the application')
        this.hubConsole.log('  mkdir <name>    - Create folder')
        this.hubConsole.log('  touch <file>    - Create note')
        this.hubConsole.log('  write <t> <c>   - Write to note')
        this.hubConsole.log('  append <t> <c>  - Append to note')
        this.hubConsole.log('  move <s> <d>    - Move item')
        this.hubConsole.log('  rename <o> <n>  - Rename item')
        this.hubConsole.log('  rm <path>       - Delete item')
        this.hubConsole.log('  clear           - Clear console')
      }
    })
    this.hubConsole.registerCommand({
      name: 'ping',
      description: 'Test console latency',
      icon: Zap,
      action: () => {
        this.hubConsole.log('pong! 🏓', 'system')
      }
    })
    this.hubConsole.registerCommand({
      name: 'stats',
      description: 'Show vault statistics',
      icon: PieChart,
      action: () => {
        this.hubConsole.log(`Notes: ${state.notes.length}`)
        this.hubConsole.log(`Tabs:  ${state.openTabs.length}`)
        this.hubConsole.log(`Path:  ${state.vaultPath || 'No vault open'}`)
      }
    })
    this.hubConsole.registerCommand({
      name: 'open',
      description: 'Open a note by title',
      icon: BookOpen,
      action: (args) => {
        if (!args.length) {
          this.hubConsole.log('Usage: open <note title>', 'error')
          return
        }
        const query = args.join(' ').toLowerCase()
        const note = state.notes.find((n) => n.title.toLowerCase().includes(query))
        if (note) {
          void this.vaultHandler.openNote(note.id, note.path)
          this.hubConsole.log(`Opening note: ${note.title}`)
        } else {
          this.hubConsole.log(`Note not found: ${query}`, 'error')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'find',
      description: 'Search in notes',
      icon: Search,
      action: (args) => {
        const query = args.join(' ')
        this.activityBar.setActiveView('search')

        // Use a small delay to ensure the search view is rendered
        setTimeout(() => {
          const searchInput = document.querySelector('#global-search-input') as HTMLInputElement
          if (searchInput) {
            searchInput.value = query
            searchInput.dispatchEvent(new Event('input'))
            searchInput.focus()
          }
        }, 100)

        this.hubConsole.log(`Search for: ${query}`)
      }
    })
    this.hubConsole.registerCommand({
      name: 'clear',
      description: 'Clear console output',
      icon: Trash2,
      action: () => {
        this.hubConsole.clear()
      }
    })
    this.hubConsole.registerCommand({
      name: 'close',
      description: 'Close console',
      icon: Terminal,
      action: () => this.hubConsole.setVisible(false)
    })
    this.hubConsole.registerCommand({
      name: 'index-vault',
      description: 'Re-index vault for AI',
      icon: RefreshCw,
      action: async () => {
        this.hubConsole.log('Starting background indexing...', 'system')
        await this.vaultHandler.backgroundIndexVault()
        this.hubConsole.log('Indexing finished', 'system')
      }
    })
    this.hubConsole.registerCommand({
      name: 'lock',
      description: 'Lock the application',
      icon: Lock,
      action: () => {
        if (!securityService.hasPassword()) {
          this.hubConsole.log('No password set. Launching security setup...', 'system')
          // Add a small delay to prevent Enter key leakage into the modal
          setTimeout(() => {
            securityService.promptSetPassword(() => {
              this.hubConsole.log('Password set. Locking application...', 'system')
              void securityService.promptAndLock()
            })
          }, 100)
          return
        }
        this.hubConsole.log('Locking application...', 'system')
        void securityService.promptAndLock()
      }
    })
    this.hubConsole.registerCommand({
      name: 'unlock',
      description: 'Unlock session or remove protection',
      icon: Unlock,
      action: async () => {
        if (securityService.isAppUnlocked()) {
          if (!securityService.hasPassword()) {
            this.hubConsole.log('Application is already unprotected.', 'system')
            return
          }
          this.hubConsole.log('Already unlocked. Verifying to remove protection...', 'system')
          const verified = await securityService.verifyAction()
          if (verified) {
            await securityService.removePassword()
            this.hubConsole.log('Vault protection disabled.', 'system')
          }
          return
        }

        this.hubConsole.log('Opening unlock prompt...', 'system')
        const success = await securityService.requestUnlock()
        if (success) {
          this.hubConsole.log('Unlocked successfully.', 'system')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'de-protect',
      description: 'Shortcut to remove password',
      action: async () => {
        const cmd = this.hubConsole.commands.get('unlock')
        if (cmd) await cmd.action([])
      }
    })
    this.hubConsole.registerCommand({
      name: 'mkdir',
      description: 'Create a new folder',
      action: async (args) => {
        if (!args.length) {
          this.hubConsole.log('Usage: mkdir <folder name>', 'error')
          return
        }
        const name = args.join(' ')
        const parent = this.sidebar.getSelectedFolderPath() || undefined
        await this.fileOps.createFolder(name, parent)
        this.hubConsole.log(`Created folder: "${name}"`, 'system')
        window.dispatchEvent(new CustomEvent('vault-changed'))
      }
    })
    this.hubConsole.registerCommand({
      name: 'read',
      description: 'Read a note content',
      action: async (args) => {
        if (!args.length) {
          this.hubConsole.log('Usage: read <title or id>', 'error')
          return
        }
        try {
          const result = await agentExecutor.readNote(args[0])
          this.hubConsole.log(`--- ${result.title} ---`, 'system')
          this.hubConsole.log(result.content, 'system')
        } catch (err) {
          this.hubConsole.log(`Read failed: ${(err as Error).message}`, 'error')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'touch',
      description: 'Create a new note',
      action: async (args) => {
        if (!args.length) {
          this.hubConsole.log('Usage: touch <note title>', 'error')
          return
        }
        const title = args.join(' ')
        const parent = this.sidebar.getSelectedFolderPath() || undefined
        await this.fileOps.createNote(title, '', parent, true)
        this.hubConsole.log(`Created note: "${title}" ${parent ? `in ${parent}` : ''}`, 'system')
      }
    })
    this.hubConsole.registerCommand({
      name: 'write',
      description: 'Create or update a note (Use quotes for title)',
      action: async (args) => {
        if (args.length < 2) {
          this.hubConsole.log('Usage: write <title> <content>', 'error')
          return
        }
        const titleInput = args[0]
        const content = args.slice(1).join(' ')
        const parent = this.sidebar.getSelectedFolderPath() || undefined

        const result = await agentExecutor.writeNote(titleInput, content, parent)
        if (typeof result !== 'string') {
          this.hubConsole.log(`Updated note: "${result.title}"`, 'system')
          await this.fileOps['callbacks'].openNote(result.id, result.path, 'editor')
        } else {
          this.hubConsole.log(result, 'system')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'append',
      description: 'Append content to a note (Use quotes for title)',
      action: async (args) => {
        if (args.length < 2) {
          this.hubConsole.log('Usage: append <title> <content>', 'error')
          return
        }
        const titleInput = args[0]
        const content = args.slice(1).join(' ')

        const result = await agentExecutor.appendNote(titleInput, content)
        if (typeof result !== 'string') {
          this.hubConsole.log(`Appended to note: "${result.title}"`, 'system')
          await this.fileOps['callbacks'].openNote(result.id, result.path, 'editor')
        } else {
          this.hubConsole.log(result, 'system')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'move',
      description: 'Move a note or folder',
      action: async (args) => {
        if (args.length < 2) {
          this.hubConsole.log('Usage: move <source> <destination_folder>', 'error')
          return
        }
        try {
          await agentExecutor.move(args[0], args[1])
          this.hubConsole.log(`Moved: ${args[0]} to ${args[1]}`, 'system')
        } catch (err) {
          this.hubConsole.log(`Move failed: ${(err as Error).message}`, 'error')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'rename',
      description: 'Rename a note or folder',
      action: async (args) => {
        if (args.length < 2) {
          this.hubConsole.log('Usage: rename <old_id_or_path> <new_name>', 'error')
          return
        }
        try {
          await agentExecutor.rename(args[0], args[1])
          this.hubConsole.log(`Renamed: ${args[0]} to ${args[1]}`, 'system')
        } catch (err) {
          this.hubConsole.log(`Rename failed: ${(err as Error).message}`, 'error')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'rm',
      description: 'Delete a note or folder',
      action: async (args) => {
        if (!args.length) {
          this.hubConsole.log('Usage: rm <path or title>', 'error')
          return
        }
        const query = args.join(' ')
        try {
          await agentExecutor.delete(query)
          this.hubConsole.log(`Deleted: ${query}`, 'system')
          window.dispatchEvent(new CustomEvent('vault-changed'))
        } catch (err) {
          this.hubConsole.log(`Delete failed: ${(err as Error).message}`, 'error')
        }
      }
    })
    this.hubConsole.registerCommand({
      name: 'delete',
      description: 'Alias for rm',
      action: async (args) => {
        const cmd = this.hubConsole.commands.get('rm')
        if (cmd) await cmd.action(args)
      }
    })
    this.hubConsole.registerCommand({
      name: 'disable-protection',
      description: 'Remove vault password',
      action: async () => {
        if (!securityService.hasPassword()) {
          this.hubConsole.log('No password set.', 'system')
          return
        }
        this.hubConsole.log('Verifying credentials to disable protection...', 'system')
        const verified = await securityService.verifyAction()
        if (verified) {
          await securityService.removePassword()
          this.hubConsole.log('Vault protection disabled. (Master password removed)', 'system')
        }
      }
    })
  }

  private registerGlobalCommands(): void {
    // Sync commands to FuzzyFinder (Command Palette)
    const sharedCommands = [
      {
        id: 'help',
        label: 'Help: List Commands (Ctrl+J)',
        description: 'Show available console commands',
        handler: () => this.realTerminal.showConsole()
      },
      {
        id: 'stats',
        label: 'Vault: Show Statistics',
        description: 'Display notes, tabs, and vault path',
        handler: () => {
          this.hubConsole.setVisible(true)
          void this.hubConsole.execute('stats', false)
        }
      },
      {
        id: 'reload-vault',
        label: 'Vault: Reload (Ctrl+Shift+R)',
        description: 'Refresh the vault contents from disk',
        handler: () => void this.reloadVault()
      },
      {
        id: 'switch-vault',
        label: 'Vault: Switch (Ctrl+Shift+V)',
        description: 'Open a different vault folder',
        handler: () => void this.vaultHandler.chooseVault()
      },
      {
        id: 'clear',
        label: 'Console: Clear',
        description: 'Clear the application console',
        handler: () => {
          this.hubConsole.clear()
        }
      },
      {
        id: 'security-lock',
        label: 'Security: Lock screen (Ctrl+L)',
        description: 'Immediately secure the application',
        handler: () => void securityService.promptAndLock()
      },
      {
        id: 'security-enable',
        label: 'Security: Enable Lock',
        description: 'Turn on vault protection (Setup password)',
        handler: async () => {
          if (securityService.hasPassword()) {
            return notificationManager.show('Protection is already enabled', 'info')
          }
          await securityService.promptAndLock()
          this.settingsView.update()
        }
      },
      {
        id: 'security-disable',
        label: 'Security: Disable Lock',
        description: 'Turn off vault protection (Remove password)',
        handler: async () => {
          if (!securityService.hasPassword()) {
            return notificationManager.show('No password is set', 'info')
          }
          const verified = await securityService.verifyAction()
          if (verified) {
            await securityService.removePassword()
            notificationManager.show('Vault protection disabled', 'success')
            this.settingsView.update()
          }
        }
      },
      {
        id: 'security-change',
        label: 'Security: Change Password',
        description: 'Update your master vault password',
        handler: async () => {
          await securityService.promptChangePassword()
          this.settingsView.update()
        }
      },
      {
        id: 'index-vault',
        label: 'AI: Re-index Vault',
        description: 'Update AI search index',
        handler: () => this.vaultHandler.backgroundIndexVault()
      },
      {
        id: 'knm-ingestion',
        label: 'KNM: Import Data',
        description: 'Open the Data Ingestion Modal',
        handler: () => this.searchModal.showUpload()
      },
      {
        id: 'knm-search',
        label: 'KNM: Global Hybrid Search',
        description: 'Open the Hybrid Search Modal',
        handler: () => this.searchModal.show()
      },
      {
        id: 'toggle-sidebar',
        label: 'View: Toggle Sidebar (Ctrl+B)',
        description: 'Show or hide the primary left sidebar',
        handler: () => void this.viewOrchestrator.toggleSidebar()
      },
      {
        id: 'toggle-right-sidebar',
        label: 'View: Toggle Right Sidebar (Ctrl+I)',
        description: 'Show or hide the AI assistant (Right Panel)',
        handler: () => void this.viewOrchestrator.toggleRightSidebar()
      },
      {
        id: 'settings',
        label: 'Settings: Open (Ctrl+,)',
        description: 'Open application settings',
        handler: () => this.viewOrchestrator.openSettings()
      },
      {
        id: 'theme',
        label: 'Theme: Select (Ctrl+Shift+<)',
        description: 'Choose a different UI theme',
        handler: () => this.themeModal.open()
      },
      {
        id: 'documentation',
        label: 'Help: Open Documentation (Ctrl+Shift+\\)',
        description: 'Learn how to use Knowledge Hub',
        handler: () => this.documentationModal.open()
      },
      {
        id: 'check-updates',
        label: 'System: Check for Updates',
        description: 'Check if a newer version is available',
        handler: () => {
          updateApp.checkForUpdate()
        }
      },
      {
        id: 'sync-backup',
        label: 'Sync: Backup Vault',
        description: 'Upload vault contents to GitHub Gist',
        handler: () => this.syncHandler.backupVault()
      },
      {
        id: 'sync-restore',
        label: 'Sync: Restore Vault',
        description: 'Pull latest backup from GitHub',
        handler: () => this.syncHandler.restoreVault()
      },
      {
        id: 'reload-window',
        label: 'System: Reload Window (Ctrl+F5)',
        description: 'Refresh the application window',
        handler: () => window.location.reload()
      },
      {
        id: 'reset-settings',
        label: 'System: Reset Settings',
        description: 'Restore factory defaults (Warning: Reloads App)',
        handler: async () => {
          if (confirm('Reset all settings to defaults? This will reload the application.')) {
            // Clear UI state from localStorage to ensure windows/panels reset
            const keysToRemove: string[] = []
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)
              if (
                key &&
                (key.startsWith('terminal_') ||
                  key.startsWith('hub-') ||
                  key.includes('_visible_') ||
                  key.includes('_active_tab_'))
              ) {
                keysToRemove.push(key)
              }
            }
            keysToRemove.forEach((key) => localStorage.removeItem(key))

            await window.api.resetSettings()
            window.location.reload()
          }
        }
      }
    ]

    this.fuzzyFinder.registerCommands(sharedCommands)
  }

  private async reloadVault(): Promise<void> {
    try {
      this.statusBar.setStatus('Reloading vault...')
      await this.vaultHandler.refreshNotes()
      this.statusBar.setStatus('Vault reloaded')
    } catch {
      notificationManager.show('Reload failed', 'error')
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new App()
  void app.init()
})
