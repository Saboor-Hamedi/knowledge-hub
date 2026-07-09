import { state } from '../../core/state'
import type { AppSettings } from '../../core/types'
import { codicons } from '../../utils/codicons'
import { themes } from '../../core/themes'
import { renderShortcutItems } from '../../utils/shortcutUtils'
import './settings-panel.css'

export class SettingsPanel {
  private container: HTMLElement
  private isOpen = false
  private currentSettings: Partial<AppSettings> = {}
  private onSettingChange?: (settings: Partial<AppSettings>) => void

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.render()
  }

  setSettingChangeHandler(handler: (settings: Partial<AppSettings>) => void): void {
    this.onSettingChange = handler
  }

  open(): void {
    if (this.isOpen) return
    if (!state.settings) return

    this.isOpen = true
    this.currentSettings = { ...state.settings }
    this.updateUI()
    const provider = this.currentSettings.aiProvider || 'deepseek'
    this.updateAIProviderFields(provider)
    if (provider !== 'ollama') {
      void this.updateModelDropdownOptions(provider)
    }
    this.container.classList.add('settings-panel--open')
    this.attachEventListeners()
  }

  close(): void {
    this.isOpen = false
    this.container.classList.remove('settings-panel--open')
    this.currentSettings = {}
  }

  // No need for a custom renderShortcuts here anymore
  private render(): void {
    this.container.innerHTML = `
      <div class="settings-panel__overlay"></div>
      <div class="settings-panel__content">
        <div class="settings-panel__header">
          <div class="settings-panel__header-top">
            <div class="settings-panel__brand">
              ${codicons.settingsGear}
              <h2 class="settings-panel__title">Settings</h2>
            </div>
            <button class="settings-panel__close" aria-label="Close settings">
              ${codicons.close}
            </button>
          </div>
          <div class="settings-panel__tabs">
            <button class="settings-panel__tab is-active" data-tab="editor">
              ${codicons.edit} <span>Editor</span>
            </button>
            <button class="settings-panel__tab" data-tab="appearance">
              ${codicons.paintbrush} <span>Appearance</span>
            </button>
            <button class="settings-panel__tab" data-tab="behavior">
              ${codicons.settingsGear} <span>Behavior</span>
            </button>
            <button class="settings-panel__tab" data-tab="ai">
              ${codicons.sparkles} <span>AI</span>
            </button>
            <button class="settings-panel__tab" data-tab="shortcuts">
              ${codicons.keyboard} <span>Shortcuts</span>
            </button>
          </div>
        </div>

        <div class="settings-panel__body">
          <!-- Editor Tab -->
          <div class="settings-panel__section is-active" data-section="editor">
            <h3 class="settings-panel__section-title">Editor Settings</h3>
            
            <div class="settings-field">
              <label class="settings-field__label">Font Size</label>
              <div class="settings-field__input-group">
                <input 
                  type="number" 
                  class="settings-field__input" 
                  data-setting="fontSize"
                  min="10"
                  max="24"
                  value="14"
                />
                <span class="settings-field__unit">px</span>
              </div>
              <p class="settings-field__hint">Range: 10-24px</p>
            </div>

            <div class="settings-field">
              <label class="settings-field__label">Line Numbers</label>
              <label class="settings-field__checkbox">
                <input 
                  type="checkbox" 
                  class="settings-field__checkbox-input" 
                  data-setting="lineNumbers"
                  checked
                />
                <span class="settings-field__checkbox-label">Show line numbers</span>
              </label>
            </div>

            <div class="settings-field">
              <label class="settings-field__label">Word Wrap</label>
              <label class="settings-field__checkbox">
                <input 
                  type="checkbox" 
                  class="settings-field__checkbox-input" 
                  data-setting="wordWrap"
                  checked
                />
                <span class="settings-field__checkbox-label">Wrap long lines</span>
              </label>
            </div>

            <div class="settings-field">
              <label class="settings-field__label">Minimap</label>
              <label class="settings-field__checkbox">
                <input 
                  type="checkbox" 
                  class="settings-field__checkbox-input" 
                  data-setting="minimap"
                />
                <span class="settings-field__checkbox-label">Show minimap</span>
              </label>
            </div>
            
          </div>

          <!-- Appearance Tab -->
          <div class="settings-panel__section" data-section="appearance">
            <h3 class="settings-panel__section-title">Appearance</h3>
            
            <div class="settings-field">
              <label class="settings-field__label">Theme</label>
              <select class="settings-field__input" data-setting="theme">
                ${Object.values(themes)
                  .map(
                    (theme) => `
                  <option value="${theme.id}">${theme.name}</option>
                `
                  )
                  .join('')}
              </select>
            </div>

            <div class="settings-field">
              <label class="settings-field__label">Caret</label>
              <label class="settings-field__checkbox">
                <input
                  type="checkbox"
                  class="settings-field__checkbox-input"
                  data-setting="caretEnabled"
                />
                <span class="settings-field__checkbox-label">Show caret</span>
              </label>

              <div style="margin-top:8px;">
                <label class="settings-field__label">Max Caret Width</label>
                <div class="settings-field__input-group">
                  <input
                    type="number"
                    class="settings-field__input"
                    data-setting="caretMaxWidth"
                    min="1"
                    max="10"
                    value="2"
                  />
                  <span class="settings-field__unit">px</span>
                </div>
                <p class="settings-field__hint">Range: 1-10px</p>
              </div>
            </div>

            <div class="settings-info">
              <p>Select a theme to customize the look and feel.</p>
            </div>
          </div>

          <!-- Behavior Tab -->
          <div class="settings-panel__section" data-section="behavior">
            <h3 class="settings-panel__section-title">Behavior Settings</h3>
            
            <div class="settings-field">
              <label class="settings-field__label">Auto-save</label>
              <label class="settings-field__checkbox">
                <input 
                  type="checkbox" 
                  class="settings-field__checkbox-input" 
                  data-setting="autoSave"
                  checked
                />
                <span class="settings-field__checkbox-label">Save files automatically</span>
              </label>
            </div>

            <div class="settings-field">
              <label class="settings-field__label">Auto-save Delay</label>
              <div class="settings-field__input-group">
                <input 
                  type="number" 
                  class="settings-field__input" 
                  data-setting="autoSaveDelay"
                  min="300"
                  max="5000"
                  step="100"
                  value="800"
                />
                <span class="settings-field__unit">ms</span>
              </div>
              <p class="settings-field__hint">Range: 300-5000ms. Delay after typing before auto-saving</p>
            </div>

            <h3 class="settings-panel__section-title" style="margin-top: 24px;">Reading Aloud (TTS)</h3>
            
            <div class="settings-field">
              <label class="settings-field__label">Preferred Voice</label>
              <select class="settings-field__input" data-setting="ttsVoice" id="tts-voice-select">
                <option value="">Default System Voice</option>
              </select>
              <p class="settings-field__hint">Choose your favorite narrator.</p>
            </div>

            <div class="settings-field">
              <label class="settings-field__label">Reading Speed</label>
              <div class="settings-field__input-group">
                <input 
                  type="range" 
                  class="settings-field__input" 
                  data-setting="ttsSpeed"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value="1.0"
                  style="flex: 1"
                  oninput="this.nextElementSibling.textContent = this.value + 'x'"
                />
                <span class="settings-field__unit" style="min-width: 40px; text-align: right;">1.0x</span>
              </div>
            </div>
          </div>

          <!-- AI Tab -->
          <div class="settings-panel__section" data-section="ai">
            <h3 class="settings-panel__section-title">AI Brain Settings</h3>

            <div class="settings-field">
              <label class="settings-field__label">AI Provider</label>
              <select class="settings-field__input" data-setting="aiProvider">
                <option value="deepseek">DeepSeek (OpenAI Compatible)</option>
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="claude">Anthropic Claude</option>
                <option value="grok">xAI Grok</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>

            <!-- DeepSeek Section -->
            <div class="settings-field" data-provider-section="deepseek" style="display: none">
              <label class="settings-field__label">DeepSeek API Key</label>
              <input 
                type="password" 
                class="settings-field__input" 
                data-setting="deepseekApiKey"
                placeholder="sk-..."
              />
              <p class="settings-field__hint">Get your key from <a href="https://platform.deepseek.com/" target="_blank">platform.deepseek.com</a></p>
            </div>

            <!-- OpenAI Section -->
            <div class="settings-field" data-provider-section="openai" style="display: none">
              <label class="settings-field__label">OpenAI API Key</label>
              <input 
                type="password" 
                class="settings-field__input" 
                data-setting="openaiApiKey"
                placeholder="sk-..."
              />
              <p class="settings-field__hint">Get your key from <a href="https://platform.openai.com/" target="_blank">platform.openai.com</a></p>
            </div>

            <!-- Claude Section -->
            <div class="settings-field" data-provider-section="claude" style="display: none">
              <label class="settings-field__label">Claude API Key</label>
              <input 
                type="password" 
                class="settings-field__input" 
                data-setting="claudeApiKey"
                placeholder="sk-ant-..."
              />
              <p class="settings-field__hint">Get your key from <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a></p>
            </div>

            <!-- Grok Section -->
            <div class="settings-field" data-provider-section="grok" style="display: none">
              <label class="settings-field__label">Grok API Key</label>
              <input 
                type="password" 
                class="settings-field__input" 
                data-setting="grokApiKey"
                placeholder="xai-..."
                  data-setting="grokApiKey"
                  placeholder="xai-..."
              />
              <p class="settings-field__hint">Get your key from <a href="https://console.x.ai/" target="_blank">console.x.ai</a></p>
            </div>

            <!-- Ollama Section -->
            <div data-provider-section="ollama" style="display: none">
              <div class="settings-field">
                <label class="settings-field__label">Ollama Base URL</label>
                <input 
                  type="text" 
                  class="settings-field__input" 
                  data-setting="ollamaBaseUrl"
                  placeholder="http://localhost:11434"
                />
                <p class="settings-field__hint">Ensure Ollama is running locally.</p>
              </div>
              
              <div class="settings-field">
                <label class="settings-field__label">Ollama Model</label>
                <div class="settings-field__input-with-action">
                  <select class="settings-field__input" id="ollama-model-select" data-setting="aiModel">
                    <option value="">Select a model...</option>
                    ${this.currentSettings.aiModel ? `<option value="${this.currentSettings.aiModel}" selected>${this.currentSettings.aiModel}</option>` : ''}
                  </select>
                  <button class="settings-icon-button" id="refresh-ollama-models" title="Refresh available models">
                    ${codicons.refresh}
                  </button>
                </div>
              </div>
            </div>

            <!-- General Model Configuration (Cloud Providers) -->
            <div id="general-model-section" data-section-not-ollama="true" style="display: ${this.currentSettings.aiProvider !== 'ollama' ? 'block' : 'none'}">
              <div class="settings-field">
                <label class="settings-field__label">Model Version</label>
                <select class="settings-field__input" id="general-model-select" data-setting="aiModel">
                  <option value="">Default (Provider Recommended)</option>
                </select>
                <p class="settings-field__hint">Select your preferred engine version.</p>
              </div>
            </div>
          </div>

          <!-- Shortcuts Tab -->
          <div class="settings-panel__section" data-section="shortcuts">
            <h3 class="settings-panel__section-title">Keyboard Shortcuts</h3>
            <div class="settings-shortcuts">
              ${renderShortcutItems()}
            </div>
          </div>
        </div>

        <div class="settings-panel__footer">
          <button class="settings-button settings-button--secondary" data-action="reset">
            Reset to Defaults
          </button>
          <div class="settings-panel__footer-actions">
            <button class="settings-button settings-button--ghost" data-action="cancel">
              Cancel
            </button>
            <button class="settings-button settings-button--primary" data-action="save">
              Save
            </button>
          </div>
        </div>
      </div>
    `
  }

  private updateUI(): void {
    if (!state.settings) return

    // Update all input fields
    const inputs = this.container.querySelectorAll('[data-setting]')
    inputs.forEach((input: Element) => {
      const setting = (input as HTMLInputElement).dataset.setting
      if (!setting) return

      const value = state.settings?.[setting as keyof AppSettings]

      if ((input as HTMLInputElement).type === 'checkbox') {
        ;(input as HTMLInputElement).checked = Boolean(value)
      } else if ((input as HTMLInputElement).type === 'number') {
        ;(input as HTMLInputElement).value = String(value || 0)
      } else {
        ;(input as HTMLInputElement).value = String(value || '')

        // Handle select specifically to ensure the correct option is visible
        if (input.tagName === 'SELECT' && value) {
          const select = input as HTMLSelectElement
          const options = Array.from(select.options)
          const hasOption = options.some((opt) => opt.value === value)
          if (!hasOption) {
            // Add current model as an option if it's missing from the dropdown
            const opt = document.createElement('option')
            opt.value = String(value)
            opt.textContent = String(value)
            opt.selected = true
            select.appendChild(opt)
          } else {
            select.value = String(value)
          }
        }
      }
    })

    // Update TTS specific UI
    this.updateTTSVoiceList()
    this.updateTTSSpeedUI()
  }

  private updateTTSVoiceList(): void {
    const select = this.container.querySelector('#tts-voice-select') as HTMLSelectElement
    if (!select) return

    const voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) {
      window.speechSynthesis.onvoiceschanged = () => this.updateTTSVoiceList()
      return
    }

    const currentVoice = state.settings?.ttsVoice
    select.innerHTML = '' // Remove all placeholders

    // 1. Cloud Voices
    if (state.settings?.openaiApiKey) {
      const g = document.createElement('optgroup')
      g.label = 'Premium Cloud Voices'
      const v = ['alloy', 'nova', 'shimmer', 'onyx', 'fable', 'echo']
      v.forEach((name) => {
        const opt = document.createElement('option')
        opt.value = `openai:${name}`
        opt.textContent = `ChatGPT ${name.charAt(0).toUpperCase() + name.slice(1)}`
        if (currentVoice === opt.value) opt.selected = true
        g.appendChild(opt)
      })
      select.appendChild(g)
    }

    // 2. System Voices (Restored with clean names)
    if (voices.length > 0) {
      const systemG = document.createElement('optgroup')
      systemG.label = 'System Voices'
      voices.forEach((voice) => {
        const option = document.createElement('option')
        option.value = voice.voiceURI
        const cleanName = voice.name
          .replace(/Microsoft |Desktop |Natural | - /g, ' ')
          .replace(/\(.*?\)/g, '')
          .trim()
        option.textContent = `${cleanName} (${voice.lang.split('-')[0].toUpperCase()})`
        if (voice.voiceURI === currentVoice) option.selected = true
        systemG.appendChild(option)
      })
      select.appendChild(systemG)
    }

    // 3. Fallback
    if (select.options.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'Setup OpenAI for Voice...'
      select.appendChild(opt)
    }
  }

  private updateTTSSpeedUI(): void {
    const slider = this.container.querySelector('[data-setting="ttsSpeed"]') as HTMLInputElement
    if (!slider) return
    const speed = state.settings?.ttsSpeed || 1.0
    slider.value = String(speed)
    const unit = slider.nextElementSibling as HTMLElement
    if (unit) unit.textContent = `${speed.toFixed(1)}x`
  }

  private attachEventListeners(): void {
    // Tab switching
    this.container.querySelectorAll('.settings-panel__tab').forEach((tab) => {
      tab.addEventListener('click', (e) => this.switchTab(e.target as HTMLElement))
    })

    // Input changes
    this.container.querySelectorAll('[data-setting]').forEach((input) => {
      input.addEventListener('change', (e) =>
        this.handleSettingChange(e.target as HTMLInputElement)
      )
      input.addEventListener('input', (e) => this.handleSettingChange(e.target as HTMLInputElement))
    })

    // Action buttons
    this.container
      .querySelector('[data-action="close"]')
      ?.addEventListener('click', () => this.close())
    this.container
      .querySelector('[data-action="cancel"]')
      ?.addEventListener('click', () => this.close())
    this.container
      .querySelector('[data-action="save"]')
      ?.addEventListener('click', () => this.save())
    this.container
      .querySelector('[data-action="reset"]')
      ?.addEventListener('click', () => this.reset())

    // Close button in header
    this.container
      .querySelector('.settings-panel__close')
      ?.addEventListener('click', () => this.close())

    // Close on overlay click
    this.container
      .querySelector('.settings-panel__overlay')
      ?.addEventListener('click', () => this.close())

    // Prevent close on content click
    this.container.querySelector('.settings-panel__content')?.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    // Ollama Refresh Button
    this.container.querySelector('#refresh-ollama-models')?.addEventListener('click', async (e) => {
      e.preventDefault()
      const btn = e.currentTarget as HTMLButtonElement
      const select = this.container.querySelector('#ollama-model-select') as HTMLSelectElement
      if (!select || !btn) return

      const originalText = btn.textContent
      btn.textContent = '...'
      btn.disabled = true

      try {
        const { aiProviderManager } = await import('../../services/ai/provider-manager')
        const baseUrl = (
          this.container.querySelector('[data-setting="ollamaBaseUrl"]') as HTMLInputElement
        )?.value
        const models = await aiProviderManager.listModels({ baseUrl })

        select.innerHTML = '<option value="">Select a model...</option>'
        models.forEach((model) => {
          const option = document.createElement('option')
          option.value = model
          option.textContent = model
          if (model === this.currentSettings.aiModel) {
            option.selected = true
          }
          select.appendChild(option)
        })

        // Auto-select first installed model if the current one is invalid/empty
        if (models.length > 0 && (!this.currentSettings.aiModel || !models.includes(this.currentSettings.aiModel))) {
          this.currentSettings.aiModel = models[0]
          select.value = models[0]
          // Manually trigger change to sync if the current selection changed
          this.handleSettingChange(select as unknown as HTMLInputElement)
        }
      } catch (err) {
        console.error('Failed to fetch Ollama models:', err)
      } finally {
        btn.textContent = originalText
        btn.disabled = false
      }
    })

    // ESC key to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close()
        document.removeEventListener('keydown', escHandler)
      }
    }
    document.addEventListener('keydown', escHandler)
  }

  private switchTab(tabElement: HTMLElement): void {
    const tabName = tabElement.dataset.tab
    if (!tabName) return

    // Update active tab
    this.container.querySelectorAll('.settings-panel__tab').forEach((t) => {
      t.classList.remove('is-active')
    })
    tabElement.classList.add('is-active')

    // Update active section
    this.container.querySelectorAll('.settings-panel__section').forEach((s) => {
      s.classList.remove('is-active')
    })
    const section = this.container.querySelector(`[data-section="${tabName}"]`)
    if (section) section.classList.add('is-active')
  }

  private handleSettingChange(input: HTMLInputElement): void {
    const setting = input.dataset.setting as keyof AppSettings
    if (!setting) return

    let value: any
    if (input.type === 'checkbox') {
      value = input.checked
    } else if (input.type === 'number') {
      value = parseInt(input.value) || 0
      // Clamp caret width to allowed range
      if (setting === 'caretMaxWidth') {
        if (value < 1) value = 1
        if (value > 10) value = 10
        input.value = String(value)
      }
    } else if (input.tagName === 'SELECT') {
      value = (input as unknown as HTMLSelectElement).value
    } else {
      value = input.value
    }

    this.currentSettings[setting] = value

    // Refresh UI if provider changes to show/hide correct fields
    if (setting === 'aiProvider') {
      // CLEAR model when provider changes to prevent "Model Not Found" errors
      this.currentSettings.aiModel = ''
      this.updateAIProviderFields(value)

      // Update the general dropdown if it's not ollama
      if (value !== 'ollama') {
        this.updateModelDropdownOptions(value)
      }
    }
  }

  private async updateModelDropdownOptions(providerType: string): Promise<void> {
    const select = this.container.querySelector('#general-model-select') as HTMLSelectElement
    if (!select) return

    try {
      const { AIProviderFactory } = await import('../../services/ai/factory')
      const provider = AIProviderFactory.getProvider(providerType as any)
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
      console.error('Failed to update model dropdown:', err)
    }
  }

  private updateAIProviderFields(provider: string): void {
    const sections = this.container.querySelectorAll('[data-provider-section]')
    sections.forEach((section: Element) => {
      const s = section as HTMLElement
      if (s.dataset.providerSection === provider) {
        s.style.display = 'block'
      } else {
        s.style.display = 'none'
      }
    })

    // Toggle the general model input
    const generalModelInput = this.container.querySelector(
      '[data-section-not-ollama="true"]'
    ) as HTMLElement
    if (generalModelInput) {
      generalModelInput.style.display = provider === 'ollama' ? 'none' : 'block'
    }
  }

  private async save(): Promise<void> {
    try {
      const updated = await window.api.updateSettings(this.currentSettings)
      state.settings = updated
      this.onSettingChange?.(this.currentSettings)
      this.close()
    } catch (error) {
      console.error('Failed to save settings:', error)
      alert(`Failed to save settings: ${(error as Error).message}`)
    }
  }

  private async reset(): Promise<void> {
    if (!confirm('Reset all settings to defaults?')) return

    try {
      const defaults = await window.api.resetSettings()
      state.settings = defaults
      this.currentSettings = { ...defaults }
      this.updateUI()
      this.onSettingChange?.(defaults)
    } catch (error) {
      console.error('Failed to reset settings:', error)
      alert(`Failed to reset settings: ${(error as Error).message}`)
    }
  }
}
