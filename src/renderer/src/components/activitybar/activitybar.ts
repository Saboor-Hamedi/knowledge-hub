import { state } from '../../core/state'
import { codicons } from '../../utils/codicons'
import { updateApp } from '../updateApp/updateRender'
import { createElement, File, Search, Settings, Palette, Library, Lock, History } from 'lucide'
import { securityService } from '../../services/security/securityService'
import './activitybar.css'

export class ActivityBar {
  private container: HTMLElement
  private onViewChange?: (
    view:
      | 'notes'
      | 'search'
      | 'settings'
      | 'theme'
      | 'graph'
      | 'documentation'
      | 'lock'
      | 'history'
      | null
  ) => void
  private updateState: 'idle' | 'checking' | 'progress' | 'restart' = 'idle'
  private updateProgress: number = 0

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.render()
    this.attachEvents()
    updateApp.onStateChange((state, progress) => {
      this.updateState = state
      this.updateProgress = progress
      this.render()
    })
  }

  setViewChangeHandler(
    handler: (
      view:
        | 'notes'
        | 'search'
        | 'settings'
        | 'theme'
        | 'graph'
        | 'documentation'
        | 'lock'
        | 'history'
        | null
    ) => void
  ): void {
    this.onViewChange = handler
  }

  setActiveView(
    view: 'notes' | 'search' | 'settings' | 'graph' | 'history' | 'theme',
    triggerHandler: boolean = true
  ): void {
    // Update UI
    this.container.querySelectorAll('.activitybar__item').forEach((item) => {
      item.classList.remove('is-active')
    })
    const button = this.container.querySelector(`[data-view="${view}"]`) as HTMLElement
    if (button) {
      button.classList.add('is-active')
    }

    // Update state
    state.activeView = view

    // Save to settings
    if (state.settings) {
      state.settings.activeView = view
      void (window.api.updateSettings as any)({ activeView: view })
    }

    // Trigger handler to update UI
    if (triggerHandler) {
      this.onViewChange?.(view)
    }
  }

  public render(): void {
    let updateIcon = ''
    if (this.updateState === 'idle') {
      // Use a circular refresh icon for update (outline version)
      updateIcon = codicons.refresh
    } else if (this.updateState === 'checking') {
      // Use a circular target/spinner icon for checking
      updateIcon = `<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#0078d4" stroke-width="2" fill="none" opacity="0.2"/><circle cx="10" cy="10" r="8" stroke="#0078d4" stroke-width="2" fill="none" stroke-dasharray="50.24" stroke-dashoffset="10" style="transform-origin:center;animation:activitybar-spin 1s linear infinite;"/><circle cx="10" cy="10" r="4" stroke="#0078d4" stroke-width="1.5" fill="none"/></svg>`
      // Add spinner animation for activitybar (top-level, once)
      ;(function injectActivitybarSpinnerStyle() {
        const styleId = 'activitybar-spinner-style'
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style')
          style.id = styleId
          style.innerHTML = `@keyframes activitybar-spin { 100% { transform: rotate(360deg); } }`
          document.head.appendChild(style)
        }
      })()
    } else if (this.updateState === 'progress') {
      // Progress: circular progress bar
      const percent = Math.round(this.updateProgress)
      updateIcon = `<svg width="24" height="24" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" stroke="#888" stroke-width="2" fill="none"/>
        <circle cx="10" cy="10" r="8" stroke="#0078d4" stroke-width="2" fill="none"
          stroke-dasharray="${Math.PI * 2 * 8}"
          stroke-dashoffset="${Math.PI * 2 * 8 * (1 - percent / 100)}"
          style="transition: stroke-dashoffset 0.2s"/>
        <text x="10" y="14" text-anchor="middle" font-size="8" fill="#0078d4">${percent}%</text>
      </svg>`
    } else if (this.updateState === 'restart') {
      // Restart icon
      updateIcon = `<svg width="24" height="24" viewBox="0 0 20 20" fill="none">
        <path d="M10 2v4M10 14v4M4.93 4.93l-2.83-2.83M17.9 17.9l-2.83-2.83M2 10h4M14 10h4M4.93 15.07l-2.83 2.83M17.9 2.1l-2.83 2.83" stroke="#0078d4" stroke-width="1.5"/>
        <circle cx="10" cy="10" r="8" stroke="#0078d4" stroke-width="1.5" fill="none"/>
      </svg>`
    }
    // Create Lucide icon elements
    const fileIcon = this.createLucideIcon(File)
    const searchIcon = this.createLucideIcon(Search)
    const settingsIcon = this.createLucideIcon(Settings)
    const paletteIcon = this.createLucideIcon(Palette)
    const libraryIcon = this.createLucideIcon(Library)
    const lockIcon = this.createLucideIcon(Lock)
    const historyIcon = this.createLucideIcon(History)

    const sidebarVisible = state.settings?.sidebarVisible !== false

    this.container.innerHTML = `
      <div class="activitybar__top">
        <button class="activitybar__item${sidebarVisible && state.activeView === 'notes' ? ' is-active' : ''}" data-view="notes" data-tooltip="Explorer (Ctrl+B)">
          <span class="activitybar__icon">${fileIcon}</span>
        </button>
        <button class="activitybar__item${sidebarVisible && state.activeView === 'search' ? ' is-active' : ''}" data-view="search" data-tooltip="Search (Ctrl+Shift+F)">
          <span class="activitybar__icon">${searchIcon}</span>
        </button>
        <button class="activitybar__item${sidebarVisible && state.activeView === 'graph' ? ' is-active' : ''}" data-view="graph" data-tooltip="Graph View (Alt+G)">
          <span class="activitybar__icon">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="2" stroke-width="1.5" fill="none"/>
              <circle cx="12" cy="12" r="2" stroke-width="1.5" fill="none"/>
              <circle cx="12" cy="4" r="2" stroke-width="1.5" fill="none"/>
              <path d="M4 4l8 8m0-8l-8 8" stroke-width="1.5" fill="none"/>
            </svg>
          </span>
        </button>
        <button class="activitybar__item${sidebarVisible && state.activeView === 'history' ? ' is-active' : ''}" data-view="history" data-tooltip="Timeline">
          <span class="activitybar__icon">${historyIcon}</span>
        </button>
        <button class="activitybar__item${this.updateState !== 'idle' ? ' has-notification' : ''}" data-view="update" data-tooltip="Update">
          <span class="activitybar__icon">${updateIcon}</span>
        </button>
        <button class="activitybar__item" data-view="documentation" data-tooltip="Documentation (Ctrl+Shift+\\)">
          <span class="activitybar__icon">${libraryIcon}</span>
        </button>
      </div>
      <div class="activitybar__bottom">
        <button class="activitybar__item" data-view="lock" data-tooltip="Lock App (Ctrl+L)">
          <span class="activitybar__icon">${lockIcon}</span>
        </button>
        <button class="activitybar__item${state.activeView === 'theme' ? ' is-active' : ''}" data-view="theme" data-tooltip="Theme (Ctrl+Shift+<)">
          <span class="activitybar__icon">${paletteIcon}</span>
        </button>
        <button class="activitybar__item${state.activeView === 'settings' ? ' is-active' : ''}" data-view="settings" data-tooltip="Settings (Ctrl+,)">
          <span class="activitybar__icon">${settingsIcon}</span>
        </button>
      </div>
    `

    this.applyStyles()
  }

  public applyStyles(): void {
    const styles = state.settings?.activityBar
    if (styles) {
      if (styles.backgroundColor)
        this.container.style.setProperty('--activity-bg', styles.backgroundColor, 'important')
      else this.container.style.removeProperty('--activity-bg')

      if (styles.borderColor)
        this.container.style.setProperty('--activity-border', styles.borderColor, 'important')
      else this.container.style.removeProperty('--activity-border')

      if (styles.activeItemColor)
        this.container.style.setProperty(
          '--activity-active-bg',
          styles.activeItemColor,
          'important'
        )
      else this.container.style.removeProperty('--activity-active-bg')

      if (styles.activeIconColor)
        this.container.style.setProperty(
          '--activity-active-icon',
          styles.activeIconColor,
          'important'
        )
      else this.container.style.removeProperty('--activity-active-icon')

      if (styles.inactiveIconColor)
        this.container.style.setProperty(
          '--activity-inactive-icon',
          styles.inactiveIconColor,
          'important'
        )
      else this.container.style.removeProperty('--activity-inactive-icon')
    } else {
      this.container.style.removeProperty('--activity-bg')
      this.container.style.removeProperty('--activity-border')
      this.container.style.removeProperty('--activity-active-bg')
      this.container.style.removeProperty('--activity-active-icon')
      this.container.style.removeProperty('--activity-inactive-icon')
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createLucideIcon(IconComponent: any): string {
    // Use Lucide's createElement to create SVG element
    const svgElement = createElement(IconComponent, {
      size: 24,
      'stroke-width': 2,
      stroke: 'currentColor',
      fill: 'currentColor',
      'fill-opacity': 0.1,
      color: 'currentColor'
    })
    // Convert SVGElement to string
    if (svgElement && svgElement.outerHTML) {
      return svgElement.outerHTML
    }
    // Fallback if icon doesn't render properly
    return ''
  }

  private attachEvents(): void {
    this.container.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const button = target.closest('.activitybar__item') as HTMLButtonElement
      if (!button) return

      const view = button.dataset.view as
        | 'notes'
        | 'search'
        | 'settings'
        | 'theme'
        | 'graph'
        | 'history'
        | 'update'
        | 'documentation'
        | 'lock'
      if (!view) return

      if (view === 'update') {
        if (this.updateState === 'restart') {
          updateApp.checkForUpdate() // restart handled by updater
        } else if (this.updateState === 'progress') {
          // Do nothing, update is downloading
        } else {
          updateApp.checkForUpdate()
        }
        return
      }

      // Toggle for modals as well
      if (view === 'theme' || view === 'documentation' || view === 'lock') {
        if (view === 'lock') {
          void securityService.promptAndLock()
          return
        }

        if (state.activeView === view) {
          state.activeView = 'notes' // default back
          this.onViewChange?.(null)
        } else {
          // Temporarily set activeView for modals so they highlight
          if (view === 'theme') {
            state.activeView = view
          }
          this.onViewChange?.(view)
        }
        this.render()
        return
      }

      // Toggle behavior: if already active, deactivate and close sidebar
      if (button.classList.contains('is-active')) {
        button.classList.remove('is-active')
        if (state.settings) {
          state.settings.sidebarVisible = false
          void window.api.updateSettings({ sidebarVisible: false })
        }
        this.onViewChange?.(null)
        return
      }

      // Update active state
      this.container.querySelectorAll('.activitybar__item').forEach((item) => {
        item.classList.remove('is-active')
      })
      button.classList.add('is-active')

      state.activeView = view as typeof state.activeView

      // Save active view to settings
      if (
        state.settings &&
        (view === 'notes' ||
          view === 'search' ||
          view === 'settings' ||
          view === 'graph' ||
          view === 'history')
      ) {
        state.settings.activeView = view as 'notes' | 'search' | 'settings' | 'graph' | 'history'
        void window.api.updateSettings({ activeView: view })
      }

      this.onViewChange?.(view)
    })
  }
}
