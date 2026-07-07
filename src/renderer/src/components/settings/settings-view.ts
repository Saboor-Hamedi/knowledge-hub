import { state } from '../../core/state'
import { modalManager } from '../modal/modal'
import type { AppSettings } from '../../core/types'
import { vaultService } from '../../services/vaultService'
import type { VaultInfo } from '../../services/vaultService'
import { notificationManager } from '../notification/notification'
import { AlertCircle, CheckCircle2, Trash2, X, Search } from 'lucide'
import { aiProviderManager } from '../../services/ai/provider-manager'
import { SecuritySection } from '../security/security-section'
import { VaultSettingsCallbacks } from './settings-types'
import { createLucideIcon, escapeHtml } from './settings-utils'
import {
  renderSidebar,
  renderEditorSection,
  renderEditorOptionsSection,
  renderAppearanceSection,
  renderBehaviorSection,
  renderAISection,
  renderVaultSection,
  renderSyncSection,
  renderShortcutsSection,
  renderTerminalSection,
  renderSearchSection,
  renderTabSection,
  renderSidebarSection,
  renderActivityBarSection,
  renderDatabaseSection
} from './settings-sections-renderer'
import './settings-view.css'

export class SettingsView {
  private container: HTMLElement
  private onSettingChange?: (settings: Partial<AppSettings>) => void
  private vaultCallbacks?: VaultSettingsCallbacks
  private activeSection: string = 'editor'
  private recentVaults: VaultInfo[] = []
  private searchQuery: string = ''
  private searchTimeout?: number
  private securitySection: SecuritySection

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.securitySection = new SecuritySection()

    this.render()
  }

  setSettingChangeHandler(handler: (settings: Partial<AppSettings>) => void): void {
    this.onSettingChange = handler
  }

  setVaultCallbacks(callbacks: VaultSettingsCallbacks): void {
    this.vaultCallbacks = callbacks
  }

  update(): void {
    this.render()
  }

  public render(): void {
    // Restore active section from settings if available
    if (state.settings?.activeSettingsSection) {
      this.activeSection = state.settings.activeSettingsSection
    }

    this.container.innerHTML = `
      <div class="settings-view">
        ${renderSidebar(this.activeSection, this.searchQuery)}

        <div class="settings-view__content">
          ${renderEditorSection(this.activeSection)}
          ${renderEditorOptionsSection(this.activeSection)}
          ${renderAppearanceSection(this.activeSection)}
          ${renderBehaviorSection(this.activeSection)}
          ${renderAISection(this.activeSection)}
          ${renderDatabaseSection(this.activeSection)}
          ${renderVaultSection(this.activeSection)}
          ${renderSyncSection(this.activeSection)}
          ${renderShortcutsSection(this.activeSection)}
          ${renderTerminalSection(this.activeSection)}
          ${renderTabSection(this.activeSection)}
          
          <div class="settings-view__section ${this.activeSection === 'security' ? 'is-active' : ''}" data-section="security">
            ${this.securitySection.render()}
          </div>

          ${renderSidebarSection(this.activeSection)}
          ${renderActivityBarSection(this.activeSection)}
          ${renderSearchSection(this.activeSection)}
        </div>
      </div>
    `

    this.attachEventListeners()
    this.securitySection.attachEvents(this.container, () => this.render())

    // Load recent vaults and render the list
    void this.loadRecentVaults()

    // Trigger initial filter if searching
    if (this.searchQuery) {
      this.filterSettings(this.searchQuery)
    }
  }

  private async loadRecentVaults(): Promise<void> {
    try {
      this.recentVaults = await vaultService.getRecentVaults()
      const vaultListContainer = this.container.querySelector('#settings-vault-list') as HTMLElement
      if (vaultListContainer) {
        this.renderVaultList(vaultListContainer)
      }
    } catch (error) {
      console.error('[SettingsView] Failed to load recent vaults:', error)
    }
  }

  private renderVaultList(container: HTMLElement): void {
    if (this.recentVaults.length === 0) {
      container.innerHTML =
        '<div class="settings-vault-list__empty">No recent vaults encountered.</div>'
      return
    }

    container.innerHTML = this.recentVaults
      .map((vault) => {
        const isCurrent = vault.path === state.vaultPath
        const statusIcon = createLucideIcon(vault.exists ? CheckCircle2 : AlertCircle, 14)
        const statusColor = vault.exists ? '#10b981' : '#ef4444'

        return `
        <div class="vault-row ${isCurrent ? 'is-active' : ''} ${!vault.exists ? 'is-missing' : ''}">
          <div class="vault-row__status" style="color: ${statusColor}">${statusIcon}</div>
          <div class="vault-row__info">
            <div class="vault-row__name">
              ${escapeHtml(vault.name)}
              ${isCurrent ? '<span class="vault-row__badge">Active</span>' : ''}
            </div>
            <div class="vault-row__path" title="${escapeHtml(vault.path)}">${escapeHtml(vault.path)}</div>
          </div>
          <div class="vault-row__actions">
            ${
              vault.exists
                ? isCurrent
                  ? `<span class="vault-row__current-label">${createLucideIcon(CheckCircle2, 14)} Using</span>`
                  : `
                <button class="vault-row__btn vault-row__btn--open" data-action="select" data-path="${escapeHtml(vault.path)}">
                  Switch Vault
                </button>
              `
                : `
                <button class="vault-row__btn vault-row__btn--locate" data-action="locate" data-path="${escapeHtml(vault.path)}">
                  Locate
                </button>
              `
            }
            ${
              !isCurrent
                ? `
              <button class="vault-row__btn vault-row__btn--delete" data-action="delete" data-path="${escapeHtml(vault.path)}" title="Remove record">
                  ${createLucideIcon(Trash2, 14)}
              </button>
            `
                : ''
            }
          </div>
        </div>
      `
      })
      .join('')

    // Attach click handlers
    container.querySelectorAll('[data-action="select"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const path = (e.currentTarget as HTMLElement).dataset.path
        if (path && this.vaultCallbacks) {
          void this.vaultCallbacks.onVaultSelected(path)
        }
      })
    })

    // Attach locate handlers for missing vaults
    container.querySelectorAll('[data-action="locate"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const path = (e.currentTarget as HTMLElement).dataset.path
        if (!path || !this.vaultCallbacks) return

        const foundPath = await vaultService.locateMovedVault(path)
        if (foundPath && this.vaultCallbacks.onVaultLocated) {
          await this.vaultCallbacks.onVaultLocated(path, foundPath)
          await this.loadRecentVaults()
        } else {
          if (this.vaultCallbacks.onVaultChange) {
            await this.vaultCallbacks.onVaultChange()
          }
        }
      })
    })

    // Attach delete handlers
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const path = (e.currentTarget as HTMLElement).dataset.path
        if (!path) return

        modalManager.open({
          title: 'Remove Vault',
          content: `Are you sure you want to remove this vault from your recent list?<br/><br/><code style="font-size: 11px; opacity: 0.7;">${escapeHtml(path)}</code>`,
          size: 'md',
          buttons: [
            {
              label: 'Remove',
              variant: 'danger',
              onClick: async (m) => {
                m.setLoading(true)
                try {
                  await vaultService.removeRecentVault(path)
                  await this.loadRecentVaults()
                  m.close()
                } catch (error) {
                  m.setLoading(false)
                  console.error('[SettingsView] Failed to remove recent vault:', error)
                }
              }
            },
            { label: 'Cancel', variant: 'ghost', onClick: (m) => m.close() }
          ]
        })
      })
    })
  }

  private filterSettings(query: string): void {
    const isSearching = query.length > 0
    const rows = this.container.querySelectorAll('.settings-row')
    const sections = this.container.querySelectorAll('.settings-view__section')
    const sidebarItems = this.container.querySelectorAll('.settings-view__sidebar-item')

    // Reset matching states
    sidebarItems.forEach((item) => item.classList.remove('has-search-match'))

    // Set to store which section IDs have matches
    const matchingSections = new Set<string>()

    // Filter rows and track sections
    rows.forEach((rowEl) => {
      const row = rowEl as HTMLElement
      const labelElement = row.querySelector('.settings-row__label')
      const label = (labelElement?.textContent || '').toLowerCase()
      const searchData = (row.getAttribute('data-search') || '').toLowerCase()
      const searchText = `${label} ${searchData}`.trim()

      const isMatch = !isSearching || searchText.includes(query.toLowerCase())
      row.style.display = isMatch ? '' : 'none'

      if (isMatch && isSearching) {
        const section = row.closest('.settings-view__section')
        if (section) {
          const sectionId = section.getAttribute('data-section')
          if (sectionId) matchingSections.add(sectionId)
        }
      }
    })

    // Update sidebar items and section visibility
    if (isSearching) {
      this.container.classList.add('is-searching')

      sidebarItems.forEach((itemEl) => {
        const item = itemEl as HTMLElement
        const sectionId = item.getAttribute('data-section-tab')
        const itemLabel = (item.textContent || '').toLowerCase()
        const itemSearchData = (item.getAttribute('data-search') || '').toLowerCase()

        const itemMatches =
          itemLabel.includes(query.toLowerCase()) || itemSearchData.includes(query.toLowerCase())

        if (sectionId && (matchingSections.has(sectionId) || itemMatches)) {
          item.classList.add('has-search-match')
          matchingSections.add(sectionId) // Ensure section is shown if tab matches
        } else {
          item.classList.remove('has-search-match')
        }
      })

      // If we found matches, show only those sections
      sections.forEach((sectionEl) => {
        const section = sectionEl as HTMLElement
        const sectionId = section.getAttribute('data-section')
        if (sectionId && matchingSections.has(sectionId)) {
          section.style.display = 'block'
          section.classList.add('is-active')
        } else {
          section.style.display = 'none'
          section.classList.remove('is-active')
        }
      })
      // Handle "No results" case
      const contentEl = this.container.querySelector('.settings-view__content')
      if (contentEl) {
        let noResultsEl = contentEl.querySelector('.settings-no-results')
        if (matchingSections.size === 0 && isSearching) {
          if (!noResultsEl) {
            noResultsEl = document.createElement('div')
            noResultsEl.className = 'settings-no-results'
            noResultsEl.innerHTML = `
              ${createLucideIcon(Search, 48)}
              <h3>No matching settings</h3>
              <p>Try searching for a different keyword or check for typos.</p>
            `
            contentEl.appendChild(noResultsEl)
          }
        } else if (noResultsEl) {
          noResultsEl.remove()
        }
      }
    } else {
      this.container.classList.remove('is-searching')
      sidebarItems.forEach((item) => item.classList.remove('has-search-match'))

      // Remove "No results" if it exists
      this.container.querySelector('.settings-no-results')?.remove()

      // Reset to show active section normally
      sections.forEach((sectionEl) => {
        const section = sectionEl as HTMLElement
        const sectionId = section.getAttribute('data-section')
        section.style.display = sectionId === this.activeSection ? 'block' : 'none'
        if (sectionId === this.activeSection) {
          section.classList.add('is-active')
        } else {
          section.classList.remove('is-active')
        }
      })
    }
  }

  private attachEventListeners(): void {
    // Tab switching
    this.container.querySelectorAll('.settings-view__sidebar-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = (btn as HTMLElement).dataset.sectionTab
        if (section) {
          this.switchSection(section)
        }
      })
    })

    // Search input
    const searchInput = this.container.querySelector('.settings-search__input') as HTMLInputElement
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value
        this.searchQuery = query

        if (this.searchTimeout) {
          window.clearTimeout(this.searchTimeout)
        }

        this.searchTimeout = window.setTimeout(() => {
          this.filterSettings(query)

          // Show/Hide clear button manually for better performance than full render
          const searchContainer = this.container.querySelector('.settings-sidebar-search')
          let clearBtn = this.container.querySelector('#settings-search-clear') as HTMLElement

          if (query && !clearBtn && searchContainer) {
            const btn = document.createElement('button')
            btn.className = 'settings-sidebar-search__clear'
            btn.id = 'settings-search-clear'
            btn.title = 'Clear search'
            btn.innerHTML = createLucideIcon(X, 14)
            searchContainer.appendChild(btn)
          } else if (!query && clearBtn) {
            clearBtn.remove()
          } else if (query && clearBtn) {
            clearBtn.style.display = 'flex'
          }
        }, 150)
      })
    }

    // Clear search
    this.container.addEventListener('click', (e) => {
      const clearBtn = (e.target as HTMLElement).closest('#settings-search-clear')
      if (clearBtn) {
        this.searchQuery = ''
        const searchInput = this.container.querySelector(
          '.settings-search__input'
        ) as HTMLInputElement
        if (searchInput) {
          searchInput.value = ''
          searchInput.focus()
        }
        this.filterSettings('')
        // Just hide the button instead of full re-render
        ;(clearBtn as HTMLElement).style.display = 'none'
      }
    })

    // Setting inputs
    this.container.querySelectorAll('[data-setting]').forEach((input) => {
      const handleInput = (e: Event): void => {
        const target = e.target as HTMLInputElement | HTMLSelectElement
        const settingKey = target.dataset.setting
        if (!settingKey) return

        let value: any
        if (target instanceof HTMLInputElement && target.type === 'checkbox') {
          value = target.checked
        } else if (target instanceof HTMLInputElement && target.type === 'number') {
          value = Number(target.value)
        } else {
          value = target.value
        }

        // Handle nested settings (e.g., sidebar.backgroundColor)
        const settings: Partial<AppSettings> = {}
        if (settingKey.includes('.')) {
          const [parent, child] = settingKey.split('.')
          settings[parent] = {
            ...(state.settings?.[parent] || {}),
            [child]: value
          }
        } else {
          settings[settingKey] = value
        }

        // Update swatch if color input
        if (target.classList.contains('settings-color-text')) {
          const swatch = target
            .closest('.settings-color-group')
            ?.querySelector('.settings-color-swatch') as HTMLElement
          if (swatch) {
            swatch.style.backgroundColor = value
          }
        }

        if (this.onSettingChange) {
          this.onSettingChange(settings)
        }

        // Special handling for AI provider
        if (settingKey === 'aiProvider') {
          this.updateAIProviderSections(value)
        }
      }

      input.addEventListener('change', handleInput)
      if (
        input instanceof HTMLInputElement &&
        (input.type === 'text' || input.type === 'password' || input.type === 'number')
      ) {
        input.addEventListener('blur', handleInput)
      }
    })

    // Custom Theme Dropdown
    this.container
      .querySelector('.settings-custom-dropdown__trigger')
      ?.addEventListener('click', (e) => {
        e.stopPropagation()
        const dropdown = (e.currentTarget as HTMLElement).closest('.settings-custom-dropdown')
        dropdown?.classList.toggle('is-open')
      })

    this.container.querySelectorAll('.settings-custom-dropdown__item').forEach((item) => {
      item.addEventListener('click', (e) => {
        const themeId = (e.currentTarget as HTMLElement).dataset.themeId
        if (themeId && this.onSettingChange) {
          this.onSettingChange({ editorTheme: themeId, theme: themeId })
          this.render()
        }
      })
    })

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      this.container.querySelectorAll('.settings-custom-dropdown.is-open').forEach((d) => {
        d.classList.remove('is-open')
      })
    })

    // Vault and Sync actions
    this.container.querySelector('#settings-vault-change')?.addEventListener('click', () => {
      if (this.vaultCallbacks) void this.vaultCallbacks.onVaultChange()
    })

    this.container.querySelector('#settings-vault-reveal')?.addEventListener('click', () => {
      if (this.vaultCallbacks) void this.vaultCallbacks.onVaultReveal()
    })

    this.container.querySelector('#settings-sync-test-token')?.addEventListener('click', () => {
      notificationManager.show('Testing GitHub token...', 'info', { duration: 2000 })
    })

    // AI Provider model logic
    this.container
      .querySelector('#view-refresh-ollama-models')
      ?.addEventListener('click', async () => {
        const btn = this.container.querySelector('#view-refresh-ollama-models') as HTMLButtonElement
        btn.disabled = true
        notificationManager.show('Fetching Ollama models...', 'info', { duration: 2000 })

        try {
          const models = await aiProviderManager.listModels()
          const select = this.container.querySelector(
            '#view-ollama-model-select'
          ) as HTMLSelectElement
          if (select) {
            select.innerHTML =
              '<option value="">Select a model...</option>' +
              models
                .map(
                  (m) =>
                    `<option value="${m}" ${state.settings?.aiModel === m ? 'selected' : ''}>${m}</option>`
                )
                .join('')
          }
          notificationManager.show('Models updated', 'success', { duration: 2000 })
        } catch (err) {
          notificationManager.show('Failed to fetch models', 'error', { duration: 3000 })
        } finally {
          btn.disabled = false
        }
      })

    this.container
      .querySelectorAll('#view-ollama-model-select, #view-general-model-select')
      .forEach((select) => {
        select.addEventListener('change', (e) => {
          const val = (e.target as HTMLSelectElement).value
          if (this.onSettingChange) this.onSettingChange({ aiModel: val })
        })
      })
  }

  private switchSection(sectionId: string): void {
    this.activeSection = sectionId
    if (this.onSettingChange) {
      this.onSettingChange({ activeSettingsSection: sectionId })
    }
    this.render()
  }

  private updateAIProviderSections(provider: string): void {
    const generalModelSection = this.container.querySelector(
      '#view-general-model-section'
    ) as HTMLElement
    if (generalModelSection) {
      generalModelSection.style.display = provider !== 'ollama' ? 'block' : 'none'
    }
    void this.refreshProviderModels(provider)
    this.render()
  }

  private async refreshProviderModels(provider: string): Promise<void> {
    try {
      const models = await aiProviderManager.listModels()
      const selectId =
        provider === 'ollama' ? '#view-ollama-model-select' : '#view-general-model-select'
      const select = this.container.querySelector(selectId) as HTMLSelectElement

      if (select) {
        const currentModel = state.settings?.aiModel
        select.innerHTML =
          (provider !== 'ollama'
            ? '<option value="">Default (Provider Recommended)</option>'
            : '<option value="">Select a model...</option>') +
          models
            .map(
              (m) => `<option value="${m}" ${currentModel === m ? 'selected' : ''}>${m}</option>`
            )
            .join('')
      }
    } catch (err) {
      console.warn('Failed to refresh models for provider:', provider)
    }
  }
}
