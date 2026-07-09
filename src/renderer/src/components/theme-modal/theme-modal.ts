import { state } from '../../core/state'
import { themes } from '../../core/themes'
import { themeManager } from '../../core/themeManager'
import { codicons } from '../../utils/codicons'
import type { AppSettings } from '../../core/types'
import './theme-modal.css'

export class ThemeModal {
  private container: HTMLElement
  private modal: HTMLElement | null = null
  private isOpen = false
  private backdrop: HTMLElement | null = null
  private onThemeChange?: (updates: Partial<AppSettings>) => void

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.render()
    this.attachInternalListeners()
  }

  private attachInternalListeners(): void {
    window.addEventListener('toggle-theme-modal', () => this.toggle())
    window.addEventListener('close-theme-modal', () => this.close())
  }

  setThemeChangeHandler(handler: (updates: Partial<AppSettings>) => void): void {
    this.onThemeChange = handler
  }

  toggle(): void {
    if (this.isOpen) {
      this.close()
    } else {
      this.open()
    }
  }

  open(): void {
    if (this.isOpen || !this.modal) return
    this.isOpen = true
    this.modal.classList.add('is-open')
    this.renderList()

    // Create invisible backdrop to close on click outside
    this.backdrop = document.createElement('div')
    this.backdrop.className = 'theme-modal-backdrop'
    this.container.appendChild(this.backdrop)

    this.backdrop.addEventListener('click', () => this.close())
    document.addEventListener('keydown', this.handleKeyDown)
  }

  close(): void {
    if (!this.isOpen || !this.modal) return
    this.isOpen = false
    this.modal.classList.remove('is-open')
    if (this.backdrop) {
      this.backdrop.remove()
      this.backdrop = null
    }
    document.removeEventListener('keydown', this.handleKeyDown)
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.close()
    }
  }

  private render(): void {
    this.modal = document.createElement('div')
    this.modal.className = 'theme-modal'
    this.modal.innerHTML = `
      <div class="theme-modal__header">
        <div class="theme-modal__title-group">
          <h3 class="theme-modal__title">Themes</h3>
        </div>
        <div class="theme-modal__actions">
          <button class="theme-modal__close wh-btn">${codicons.close}</button>
        </div>
      </div>
      <div class="theme-modal__search-container">
        <input type="text" class="theme-modal__search" placeholder="Search themes..." />
      </div>
      <div class="theme-modal__list"></div>
    `
    this.container.appendChild(this.modal)

    // Events
    this.modal.querySelector('.theme-modal__close')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.close()
    })

    // Search event
    this.modal.querySelector('.theme-modal__search')?.addEventListener('input', () => {
      this.renderList()
    })
  }

  private renderList(): void {
    const list = this.modal?.querySelector('.theme-modal__list')
    const searchInput = this.modal?.querySelector('.theme-modal__search') as HTMLInputElement
    if (!list) return

    const currentId = themeManager.getCurrentThemeId()
    const query = (searchInput?.value || '').toLowerCase()

    const filteredThemes = Object.values(themes).filter(theme => 
      theme.name.toLowerCase().includes(query)
    )

    list.innerHTML = filteredThemes
      .map((theme) => {
        const isActive = theme.id === currentId ? 'is-active' : ''
        const bg = theme.colors['--bg']
        const primary = theme.colors['--primary']

        return `
        <div class="theme-item ${isActive}" data-id="${theme.id}">
          <div class="theme-preview">
            <div class="theme-preview__c1" style="background: ${bg}"></div>
            <div class="theme-preview__c2" style="background: ${primary}"></div>
          </div>
          <div class="theme-info">
            <div class="theme-name">${theme.name}</div>
            ${isActive ? `<div class="theme-check">${codicons.check || '✓'}</div>` : ''}
          </div>
        </div>
      `
      })
      .join('')

    // Attach click handlers
    list.querySelectorAll('.theme-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const id = (item as HTMLElement).dataset.id
        if (id) {
          this.applyTheme(id)
        }
      })
    })
  }

  private async applyTheme(id: string): Promise<void> {
    // 1. Prepare clean slate updates (explicitly clear overrides)
    const updates: any = {
      theme: id,
      sidebar: {
        backgroundColor: undefined,
        borderColor: undefined,
        textColor: undefined,
        activeItemColor: undefined,
        activeTextColor: undefined,
        fontSize: state.settings?.sidebar?.fontSize
      },
      tab: {
        backgroundColor: undefined,
        borderColor: undefined,
        activeTabColor: undefined,
        inactiveTabColor: undefined,
        activeTextColor: undefined,
        inactiveTextColor: undefined,
        borderPosition: state.settings?.tab?.borderPosition,
        compactMode: state.settings?.tab?.compactMode
      },
      activityBar: {
        backgroundColor: undefined,
        borderColor: undefined,
        activeItemColor: undefined,
        activeIconColor: undefined,
        inactiveIconColor: undefined
      },
      searchInput: {
        backgroundColor: undefined,
        borderColor: undefined,
        focusBorderColor: undefined,
        textColor: undefined,
        placeholderColor: undefined,
        buttonColor: undefined,
        buttonHoverColor: undefined,
        buttonActiveColor: undefined
      },
      terminalBackground: undefined,
      terminalForeground: undefined,
      terminalCursor: undefined,
      terminalFrameColor: undefined,
      editorTheme: undefined,
      graphTheme: 'default'
    }

    // 2. Apply theme and update state
    themeManager.setTheme(id)
    if (state.settings) {
      // Local updates for immediate consistency
      Object.assign(state.settings.sidebar || {}, updates.sidebar)
      Object.assign(state.settings.tab || {}, updates.tab)
      Object.assign(state.settings.activityBar || {}, updates.activityBar)
      Object.assign(state.settings.searchInput || {}, updates.searchInput)
      state.settings.theme = id
      state.settings.terminalBackground = undefined
      state.settings.terminalForeground = undefined
      state.settings.terminalCursor = undefined
      state.settings.terminalFrameColor = undefined
      state.settings.editorTheme = undefined
      state.settings.graphTheme = 'default'
    }

    // 3. Notify app to re-apply styles and persist
    this.onThemeChange?.(updates)
    this.renderList()

    try {
      await (window.api.updateSettings as any)(updates)
      // Custom event to notify all components to re-run applyStyles
      window.dispatchEvent(
        new CustomEvent('knowledge-hub:theme-changed', { detail: { themeId: id } })
      )
    } catch (e) {
      console.error('Failed to save theme and reset overrides', e)
    }
  }
}
