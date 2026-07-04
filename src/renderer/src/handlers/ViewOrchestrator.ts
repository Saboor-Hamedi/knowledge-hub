import { state } from '../core/state'
import { tabService } from '../services/tabService'
import { timeAgo, getNoteMetrics } from '../utils/helpers'
import { detailsModal } from '../components/details-modal/details-modal'
import type { AppSettings } from '../core/types'
import { tooltipManager } from '../components/tooltip/tooltip'

export class ViewOrchestrator {
  constructor(
    private components: {
      editor: {
        getValue: () => string
        getSelectionContent: () => string | null
        layout: () => void
        showEmpty: () => void
      }
      settingsView: { update: () => void }
      welcomePage: { isVisible: () => boolean; show: () => void; hide: () => void }
      tabBar: { render: () => void }
      statusBar: {
        setStatus: (msg: string) => void
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
      activityBar: {
        setActiveView: (view: 'notes' | 'search' | 'settings' | 'graph' | 'history') => void
      }
      breadcrumbs: { render: () => void }
      graphTabView: { open: () => Promise<void>; close: () => void }
      timeline: {
        setVisible: (visible: boolean) => void
        update: (id: string, path: string) => Promise<void>
      }
      rightBar?: { focusInput: () => void }
    }
  ) {}

  public updateViewVisibility(): void {
    const editorCont = document.getElementById('editorContainer')
    const settingsHost = document.getElementById('settingsHost')
    const graphHost = document.getElementById('graphHost')
    const welcomeHost = document.getElementById('welcomeHost')
    const tabBar = document.getElementById('tabBar')
    const breadcrumbs = document.getElementById('breadcrumbs')
    const timelineHost = document.getElementById('timelineHost')
    const sidebar = document.getElementById('sidebar')

    const isWelcomeVisible = this.components.welcomePage.isVisible()

    // Always clear tooltips when view significantly changes
    tooltipManager.hide()

    if (state.activeId === 'settings') {
      if (editorCont) editorCont.style.display = 'none'
      if (settingsHost) settingsHost.style.display = 'flex'
      if (graphHost) graphHost.style.display = 'none'
      if (welcomeHost) welcomeHost.style.display = 'none'
      if (tabBar) tabBar.style.display = 'flex'
      if (breadcrumbs) breadcrumbs.style.display = 'none'
    } else if (state.activeId === 'graph') {
      if (editorCont) editorCont.style.display = 'none'
      if (settingsHost) settingsHost.style.display = 'none'
      if (graphHost) graphHost.style.display = 'flex'
      if (welcomeHost) welcomeHost.style.display = 'none'
      if (tabBar) tabBar.style.display = 'flex'
      if (breadcrumbs) breadcrumbs.style.display = 'none'
    } else if (isWelcomeVisible) {
      if (editorCont) editorCont.style.display = 'none'
      if (settingsHost) settingsHost.style.display = 'none'
      if (graphHost) graphHost.style.display = 'none'
      if (welcomeHost) welcomeHost.style.display = 'flex'
      if (tabBar) tabBar.style.display = 'none'
      if (breadcrumbs) breadcrumbs.style.display = 'none'
    } else {
      if (editorCont && editorCont.style.display !== 'flex') editorCont.style.display = 'flex'
      if (settingsHost && settingsHost.style.display !== 'none') settingsHost.style.display = 'none'
      if (graphHost && graphHost.style.display !== 'none') graphHost.style.display = 'none'
      if (welcomeHost && welcomeHost.style.display !== 'none') welcomeHost.style.display = 'none'
      if (tabBar && tabBar.style.display !== 'flex') tabBar.style.display = 'flex'
      if (breadcrumbs && breadcrumbs.style.display !== 'flex') breadcrumbs.style.display = 'flex'
      this.components.editor.layout()
    }

    // Update sidebar views
    const view = state.activeView || 'notes'
    if (view === 'history') {
      if (sidebar) {
        sidebar.style.display = 'none'
      }
      if (timelineHost) {
        timelineHost.style.display = 'grid'
      }
      this.components.timeline.setVisible(true)

      // Update with current note if available
      if (state.activeId && state.activeId !== 'settings' && state.activeId !== 'graph') {
        const note = state.notes.find((n) => n.id === state.activeId)
        if (note) {
          this.components.timeline.update(note.id, note.id)
        }
      }
    } else {
      if (sidebar) {
        sidebar.style.display = 'grid'
      }
      if (timelineHost) {
        timelineHost.style.display = 'none'
      }
      this.components.timeline.setVisible(false)
    }

    // Refresh breadcrumbs whenever visibility state changes
    this.components.breadcrumbs.render()
  }

  public async setSidebarVisible(visible: boolean): Promise<void> {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (!shell) return

    if (visible) {
      shell.classList.remove('sidebar-hidden')
    } else {
      shell.classList.add('sidebar-hidden')
    }

    if (state.settings) {
      state.settings.sidebarVisible = visible
    }
    void window.api.updateSettings({ sidebarVisible: visible })
  }

  public toggleSidebar(): Promise<void> {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    const isVisible = !shell?.classList.contains('sidebar-hidden')
    return this.setSidebarVisible(!isVisible)
  }

  public async setRightSidebarVisible(visible: boolean): Promise<void> {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    const rightPanel = document.getElementById('rightPanel') as HTMLElement
    if (!rightPanel || !shell) return

    // Use getComputedStyle for accurate initial state detection
    const isActuallyVisible = window.getComputedStyle(rightPanel).display !== 'none'
    if (isActuallyVisible === visible) return

    if (!visible) {
      const currentWidth = parseInt(
        getComputedStyle(shell).getPropertyValue('--right-panel-width') || '270',
        10
      )
      if (currentWidth > 0) {
        void window.api.updateSettings({ rightPanelWidth: currentWidth, rightPanelVisible: false })
      } else {
        void window.api.updateSettings({ rightPanelVisible: false })
      }
      rightPanel.style.display = 'none'
      shell.style.setProperty('--right-panel-width', '0px')
    } else {
      const s = await window.api.getSettings()
      const w = (s as { rightPanelWidth?: number }).rightPanelWidth ?? 270
      rightPanel.style.display = 'block'
      shell.style.setProperty('--right-panel-width', `${Math.max(200, Math.min(800, w))}px`)
      void window.api.updateSettings({ rightPanelVisible: true })

      // Auto-focus chat input after panel is visible
      requestAnimationFrame(() => {
        this.components.rightBar?.focusInput()
      })
    }
  }

  public toggleRightSidebar(): Promise<void> {
    const rightPanel = document.getElementById('rightPanel')
    if (!rightPanel) return Promise.resolve()
    const isVisible = window.getComputedStyle(rightPanel).display !== 'none'
    return this.setRightSidebarVisible(!isVisible)
  }

  public showDetailsModal(): void {
    const content = this.components.editor.getValue()
    const metrics = getNoteMetrics(content)
    const currentNoteId = state.activeId

    if (currentNoteId && currentNoteId !== 'settings') {
      const note = state.notes.find((n) => n.id === currentNoteId)
      if (note) {
        const created = note.createdAt && note.createdAt > 0 ? timeAgo(note.createdAt) : '-'
        const modified = timeAgo(note.updatedAt)
        detailsModal.show({
          ...metrics,
          chars: metrics.chars,
          readTime: `${metrics.readTime} min`,
          created,
          modified
        })
      }
    } else {
      detailsModal.show({
        words: 0,
        chars: 0,
        lines: 0,
        readTime: '-',
        wikiLinks: 0,
        tags: 0,
        created: '-',
        modified: '-'
      })
    }
  }

  public updateEditorMetrics(): void {
    if (state.activeId && state.activeId !== 'settings' && state.activeId !== 'graph') {
      const selection = this.components.editor.getSelectionContent()
      const content = selection || this.components.editor.getValue()
      const metrics = getNoteMetrics(content)

      // If there is a selection, we might want to signal it, or just show the metrics for the selection
      // For now, let's just show the metrics of whatever we have (selection or full content)
      this.components.statusBar.setMetrics({
        words: metrics.words,
        chars: metrics.chars,
        lines: metrics.lines,
        wikiLinks: metrics.wikiLinks,
        tags: metrics.tags,
        mentions: metrics.mentions
      })

      const pos = state.cursorPositions.get(state.activeId)
      if (pos) {
        this.components.statusBar.setCursor({ ln: pos.lineNumber, col: pos.column })
      } else {
        this.components.statusBar.setCursor(null)
      }
    } else {
      this.components.statusBar.setMetrics(null)
      this.components.statusBar.setCursor(null)
    }
  }

  public async openSettings(): Promise<void> {
    this.components.welcomePage.hide()
    state.activeId = 'settings'

    tabService.ensureTab({
      id: 'settings',
      title: 'Settings',
      updatedAt: 0,
      path: undefined,
      type: undefined
    })

    this.components.tabBar.render()
    this.updateViewVisibility()
    this.components.settingsView.update()
    this.components.statusBar.setStatus('Settings Editor')
    this.updateEditorMetrics()
  }

  public async closeSettings(): Promise<void> {
    tabService.closeTab('settings')
    if (state.activeId === 'settings' || !state.activeId) {
      const remaining = state.openTabs
      if (remaining.length > 0) {
        state.activeId = remaining[remaining.length - 1].id
      } else {
        state.activeId = ''
        this.showWelcomePage()
      }
    }
    this.components.tabBar.render()
    this.updateViewVisibility()
  }

  public async openGraph(): Promise<void> {
    this.components.welcomePage.hide()
    state.activeId = 'graph'

    tabService.ensureTab({
      id: 'graph',
      title: 'Knowledge Graph',
      updatedAt: 0,
      path: undefined,
      type: undefined
    })

    this.components.tabBar.render()
    this.updateViewVisibility()
    await this.components.graphTabView.open()
    this.components.statusBar.setStatus('Knowledge Graph')
    this.updateEditorMetrics()
  }

  public async closeGraph(): Promise<void> {
    tabService.closeTab('graph')
    this.components.graphTabView.close()
    if (state.activeId === 'graph' || !state.activeId) {
      const remaining = state.openTabs
      if (remaining.length > 0) {
        state.activeId = remaining[remaining.length - 1].id
      } else {
        state.activeId = ''
        this.showWelcomePage()
      }
    }
    this.components.tabBar.render()
    this.updateViewVisibility()
  }

  public showWelcomePage(): void {
    state.activeId = ''
    this.components.welcomePage.show()
    this.components.editor.showEmpty()
    this.updateViewVisibility()
    this.updateEditorMetrics()
  }

  public hideWelcomePage(): void {
    this.components.welcomePage.hide()
    this.updateViewVisibility()
  }

  public restoreLayout(settings: AppSettings): void {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    const rightPanel = document.getElementById('rightPanel') as HTMLElement
    if (!shell || !rightPanel) return

    if (settings.sidebarVisible === false) {
      shell.classList.add('sidebar-hidden')
    } else {
      shell.classList.remove('sidebar-hidden')
    }

    if (settings.rightPanelVisible) {
      rightPanel.style.display = 'block'
      const width = settings.rightPanelWidth ?? 270
      shell.style.setProperty('--right-panel-width', `${width}px`)
    } else {
      rightPanel.style.display = 'none'
      shell.style.setProperty('--right-panel-width', '0px')
    }
  }
}
