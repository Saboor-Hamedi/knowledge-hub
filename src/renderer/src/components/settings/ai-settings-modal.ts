import { state } from '../../core/state'
import { AppSettings } from '../../core/types'
import { codicons } from '../../utils/codicons'
import './ai-settings-modal.css'

export class AISettingsModal {
  private container: HTMLElement
  private modal: HTMLElement
  private isOpen = false
  private backdrop: HTMLElement | null = null
  private currentSettings: Partial<AppSettings> = {}

  constructor(containerId: string = 'app') {
    this.container = document.getElementById(containerId) || document.body

    this.modal = document.createElement('div')
    this.modal.className = 'ai-settings-modal'
    this.renderBase()
    this.container.appendChild(this.modal)
  }

  private renderBase(): void {
    this.modal.innerHTML = `
      <div class="ai-settings-modal__content">
        <div class="window-header" style="flex-shrink: 0;">
          <div class="window-header__brand">
            <span class="window-header__title">AI Configuration</span>
          </div>
          <div class="window-header__controls">
            <button class="wh-btn wh-close ai-settings-modal__close" title="Close (Esc)" aria-label="Close">${codicons.close}</button>
          </div>
        </div>
        
        <div class="ai-settings-modal__body">
          <div class="ai-settings-modal__scrollable">
            <div class="ai-settings-modal__section">
              <div class="ai-settings-modal__section-header">
                <span class="ai-settings-modal__section-icon">🧠</span>
                <div class="ai-settings-modal__section-info">
                  <h3 class="ai-settings-modal__section-title">AI Provider</h3>
                  <p class="ai-settings-modal__section-desc">Choose the engine that powers your assistant.</p>
                </div>
              </div>
              
              <div class="ai-settings-modal__provider-grid">
                <button class="ai-settings-modal__provider-card" data-provider="deepseek">
                  <span class="provider-icon">🐳</span>
                  <span class="provider-name">DeepSeek</span>
                </button>
                <button class="ai-settings-modal__provider-card" data-provider="openai">
                  <span class="provider-icon">⚪</span>
                  <span class="provider-name">OpenAI</span>
                </button>
                <button class="ai-settings-modal__provider-card" data-provider="claude">
                  <span class="provider-icon">🅰️</span>
                  <span class="provider-name">Claude</span>
                </button>
                <button class="ai-settings-modal__provider-card" data-provider="ollama">
                  <span class="provider-icon">🦙</span>
                  <span class="provider-name">Ollama</span>
                </button>
                <button class="ai-settings-modal__provider-card" data-provider="grok">
                  <span class="provider-icon">✖️</span>
                  <span class="provider-name">Grok</span>
                </button>
              </div>
            </div>

            <div class="ai-settings-modal__section" id="provider-details-section">
              <!-- Dynamically populated based on provider -->
              <div class="ai-settings-modal__loading">Select a provider to configure</div>
            </div>
          </div>
        </div>

        <div class="ai-settings-modal__footer">
          <div class="ai-settings-modal__status" id="ai-settings-status"></div>
          <div class="footer-actions">
            <button class="ai-settings-btn ai-settings-btn--ghost" id="ai-settings-cancel">Cancel</button>
            <button class="ai-settings-btn ai-settings-btn--primary" id="ai-settings-save">Save Changes</button>
          </div>
        </div>
      </div>
    `

    this.modal
      .querySelector('.ai-settings-modal__close')
      ?.addEventListener('click', () => this.close())
    this.modal.querySelector('#ai-settings-cancel')?.addEventListener('click', () => this.close())
    this.modal.querySelector('#ai-settings-save')?.addEventListener('click', () => this.save())

    this.modal.querySelectorAll('.ai-settings-modal__provider-card').forEach((card) => {
      card.addEventListener('click', () => {
        const provider = (card as HTMLElement).dataset.provider
        if (provider) this.switchProvider(provider)
      })
    })
  }

  public open(): void {
    if (this.isOpen) return
    if (!state.settings) return

    this.isOpen = true
    this.currentSettings = { ...state.settings }
    this.modal.classList.add('is-open')

    this.backdrop = document.createElement('div')
    this.backdrop.className = 'ai-settings-modal-backdrop'
    this.container.appendChild(this.backdrop)
    this.backdrop.addEventListener('click', () => this.close())

    document.addEventListener('keydown', this.handleKeyDown)
    void this.switchProvider(this.currentSettings.aiProvider || 'deepseek', false)
  }

  private async switchProvider(provider: string, isManualSwitch = true): Promise<void> {
    const providerKey = provider as AppSettings['aiProvider']

    // Reset model if provider changed manually to ensure consistency
    if (isManualSwitch && this.currentSettings.aiProvider !== providerKey) {
      this.currentSettings.aiModel = ''
    }

    this.currentSettings.aiProvider = providerKey

    // Update UI active state
    this.modal.querySelectorAll('.ai-settings-modal__provider-card').forEach((card) => {
      card.classList.toggle('is-active', (card as HTMLElement).dataset.provider === provider)
    })

    await this.renderProviderDetails(provider)
  }

  private async renderProviderDetails(provider: string): Promise<void> {
    const detailsContainer = this.modal.querySelector('#provider-details-section')
    if (!detailsContainer) return

    let html = ''

    if (provider === 'ollama') {
      // Don't show the current model if it's from a different provider
      const showCurrentModel =
        this.currentSettings.aiModel &&
        !this.currentSettings.aiModel.includes('deepseek') &&
        !this.currentSettings.aiModel.includes('gpt') &&
        !this.currentSettings.aiModel.includes('claude')

      html = `
        <div class="ai-settings-form">
          <div class="ai-settings-field">
            <label class="ai-settings-label">Server URL</label>
            <input type="text" class="ai-settings-input" data-setting="ollamaBaseUrl" value="${this.currentSettings.ollamaBaseUrl || 'http://localhost:11434'}">
            <p class="ai-settings-hint">Ensure Ollama is running on your machine.</p>
          </div>
          <div class="ai-settings-field">
            <label class="ai-settings-label">Model Selection</label>
            <div class="ai-settings-input-group">
              <select class="ai-settings-select" id="ai-modal-ollama-model" data-setting="aiModel">
                <option value="">Loading models...</option>
                ${showCurrentModel ? `<option value="${this.currentSettings.aiModel}" selected>${this.currentSettings.aiModel}</option>` : ''}
              </select>
              <button class="ai-settings-refresh" id="ai-modal-refresh-ollama">${codicons.refresh}</button>
            </div>
          </div>
        </div>
      `
    } else {
      const keyMap: Record<string, { label: string; setting: string; url: string }> = {
        deepseek: {
          label: 'DeepSeek API Key',
          setting: 'deepseekApiKey',
          url: 'https://platform.deepseek.com'
        },
        openai: {
          label: 'OpenAI API Key',
          setting: 'openaiApiKey',
          url: 'https://platform.openai.com'
        },
        claude: {
          label: 'Anthropic Key',
          setting: 'claudeApiKey',
          url: 'https://console.anthropic.com'
        },
        grok: { label: 'xAI Grok Key', setting: 'grokApiKey', url: 'https://console.x.ai' }
      }

      const config = keyMap[provider] || keyMap.deepseek

      html = `
        <div class="ai-settings-form">
          <div class="ai-settings-field">
            <label class="ai-settings-label">${config.label}</label>
            <input type="password" class="ai-settings-input" data-setting="${config.setting}" value="${String(this.currentSettings[config.setting as keyof AppSettings] || '')}" placeholder="sk-...">
            <p class="ai-settings-hint">Get your key from <a href="${config.url}" target="_blank">${new URL(config.url).hostname}</a></p>
          </div>
          <div class="ai-settings-field">
            <label class="ai-settings-label">Model Version</label>
            <select class="ai-settings-select" id="ai-modal-general-model" data-setting="aiModel">
              <option value="">Loading models...</option>
            </select>
          </div>
        </div>
      `
    }

    detailsContainer.innerHTML = html

    // Attach detail-specific events
    this.attachDetailEvents(provider)

    // PERFORMANCE: Defer model loading to avoid blocking modal open
    // Load models asynchronously in the background
    requestAnimationFrame(() => {
      if (provider === 'ollama') {
        void this.refreshOllamaModels()
      } else {
        void this.updateCloudModels(provider as AppSettings['aiProvider'])
      }
    })
  }

  private updateSetting(setting: keyof AppSettings, value: string): void {
    if (setting === 'aiProvider') {
      this.currentSettings[setting] = value as AppSettings['aiProvider']
    } else if (setting === 'aiModel' || setting === 'ollamaBaseUrl' || setting.endsWith('ApiKey')) {
      ;(this.currentSettings as any)[setting] = value
    }
  }

  private attachDetailEvents(provider: string): void {
    const detailsContainer = this.modal.querySelector('#provider-details-section')
    if (!detailsContainer) return

    detailsContainer.querySelectorAll('[data-setting]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const el = e.target as HTMLInputElement | HTMLSelectElement
        const setting = el.dataset.setting as keyof AppSettings
        if (setting) {
          this.updateSetting(setting, el.value)
        }
      })
    })

    if (provider === 'ollama') {
      this.modal
        .querySelector('#ai-modal-refresh-ollama')
        ?.addEventListener('click', () => this.refreshOllamaModels())
    }
  }

  private async updateCloudModels(providerType: AppSettings['aiProvider']): Promise<void> {
    const select = this.modal.querySelector('#ai-modal-general-model') as HTMLSelectElement
    if (!select || !providerType) return

    try {
      const { AIProviderFactory } = await import('../../services/ai/factory')
      const provider = AIProviderFactory.getProvider(providerType)
      const models = provider.supportedModels

      select.innerHTML = '<option value="">Default (Provider Recommended)</option>'
      models.forEach((model) => {
        const option = document.createElement('option')
        option.value = model
        option.textContent = model
        if (model === this.currentSettings.aiModel) option.selected = true
        select.appendChild(option)
      })
    } catch (err) {
      console.error('[AIModal] Failed to update models:', err)
    }
  }

  private async refreshOllamaModels(): Promise<void> {
    const select = this.modal.querySelector('#ai-modal-ollama-model') as HTMLSelectElement
    const btn = this.modal.querySelector('#ai-modal-refresh-ollama') as HTMLElement
    if (!select) return

    if (btn) btn.classList.add('is-spinning')

    try {
      const { aiProviderManager } = await import('../../services/ai/provider-manager')
      const baseUrl =
        (this.modal.querySelector('[data-setting="ollamaBaseUrl"]') as HTMLInputElement)?.value ||
        'http://localhost:11434'
      const models = await aiProviderManager.listModels({ baseUrl })

      select.innerHTML = '<option value="">Select a model...</option>'
      models.forEach((model) => {
        const option = document.createElement('option')
        option.value = model
        option.textContent = model
        if (model === this.currentSettings.aiModel) option.selected = true
        select.appendChild(option)
      })
      
      // Auto-select first installed model if the current one is invalid/empty
      if (models.length > 0 && (!this.currentSettings.aiModel || !models.includes(this.currentSettings.aiModel))) {
        this.currentSettings.aiModel = models[0]
        select.value = models[0]
        this.updateSetting('aiModel', models[0])
      }
    } catch (err) {
      select.innerHTML = '<option value="">Error fetching models</option>'
    } finally {
      if (btn) btn.classList.remove('is-spinning')
    }
  }

  private async save(): Promise<void> {
    const status = this.modal.querySelector('#ai-settings-status') as HTMLElement
    if (status) {
      status.textContent = 'Syncing engine...'
      status.style.color = 'var(--text-soft)'
    }

    // Explicitly scrape all data-setting values from the DOM to ensure we have the latest state
    // This fixes issues where the 'change' event might not have fired yet or was missed
    this.modal.querySelectorAll('[data-setting]').forEach((el) => {
      const input = el as HTMLInputElement | HTMLSelectElement
      const setting = input.dataset.setting as keyof AppSettings
      if (setting) {
        this.updateSetting(setting, input.value)
      }
    })

    try {
      const updated = await window.api.updateSettings(this.currentSettings)
      state.settings = updated

      // Notify other components
      window.dispatchEvent(new CustomEvent('knowledge-hub:settings-updated'))

      if (status) {
        status.textContent = 'Configuration secured!'
        status.style.color = 'var(--accent)'
      }

      setTimeout(() => this.close(), 1000)
    } catch (err) {
      if (status) {
        status.textContent = 'Failed to save settings'
        status.style.color = 'var(--error)'
      }
    }
  }

  public close(): void {
    if (!this.isOpen) return
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
}
