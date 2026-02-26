import { state } from '../../core/state'
import { codicons } from '../../utils/codicons'
import { themes } from '../../core/themes'
import {
  Type,
  Scan,
  Palette,
  Eye,
  ListOrdered,
  WrapText,
  Timer,
  Save,
  Sparkles,
  Zap,
  Key,
  FolderSync,
  PlusCircle,
  FolderOpen,
  CloudUpload,
  CloudDownload,
  Github,
  Layout,
  Frame,
  Pipette,
  PanelLeft,
  Activity,
  Search,
  X,
  Cpu
} from 'lucide'
import { createLucideIcon, shorten } from './settings-utils'
import { renderShortcutItems } from '../../utils/shortcutUtils'

// --- Helpers for cleaner rendering ---

interface RowParams {
  icon: any
  label: string
  hint: string
  actionHtml: string
  searchData?: string
}

function renderRow({ icon, label, hint, actionHtml, searchData }: RowParams): string {
  return `
    <div class="settings-row" ${searchData ? `data-search="${searchData}"` : ''}>
      <div class="settings-row__icon">${createLucideIcon(icon, 18)}</div>
      <div class="settings-row__info">
        <label class="settings-row__label">${label}</label>
        <p class="settings-row__hint">${hint}</p>
      </div>
      <div class="settings-row__action">
        ${actionHtml}
      </div>
    </div>
  `
}

function renderToggle(setting: string, checked: boolean): string {
  return `
    <label class="settings-toggle">
      <input type="checkbox" data-setting="${setting}" ${checked ? 'checked' : ''} />
      <span class="settings-toggle__slider"></span>
    </label>
  `
}

function renderNumberInput(setting: string, value: number, min = 0, max = 100): string {
  return `
    <div class="settings-color-group">
      <input type="number" data-setting="${setting}" min="${min}" max="${max}" value="${value}" 
        style="width: 80px; background: transparent; border: none; padding: 0 4px; font-family: inherit; font-size: 13px; color: var(--text-strong); outline: none;" />
    </div>
  `
}

function renderColorInput(setting: string, color: string): string {
  return `
    <div class="settings-color-group">
      <div class="settings-color-swatch" style="background-color: ${color}"></div>
      <input type="text" class="settings-input settings-color-text" data-setting="${setting}" value="${color}" spellcheck="false" />
    </div>
  `
}

function renderSectionHeader(title: string): string {
  return `
    <div class="settings-view__section-header">
      <h2 class="settings-view__section-title">${title}</h2>
    </div>
  `
}

export function renderEditorThemeSelector(): string {
  const currentThemeId = state.settings?.editorTheme || state.settings?.theme || 'dark'
  const currentTheme = themes[currentThemeId] || themes['dark']

  return `
    <div class="settings-custom-dropdown">
      <button class="settings-custom-dropdown__trigger">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="settings-custom-dropdown__preview-dot" style="background: ${currentTheme.colors['--primary']};"></div>
          ${shorten(currentTheme.name, currentTheme.id)}
        </div>
      </button>
      <div class="settings-custom-dropdown__menu">
        <div class="settings-custom-dropdown__list">
          ${Object.values(themes)
            .map((t) => {
              const isSelected = t.id === currentThemeId
              return `
              <div class="settings-custom-dropdown__item ${isSelected ? 'is-selected' : ''}" data-theme-id="${t.id}">
                <div class="settings-custom-dropdown__preview-dot" style="background: ${t.colors['--primary']};"></div>
                <span>${shorten(t.name, t.id)}</span>
                <div class="settings-custom-dropdown__selected-dot"></div>
              </div>
            `
            })
            .join('')}
        </div>
      </div>
    </div>
  `
}

export function renderEditorSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'editor' ? 'is-active' : ''}" data-section="editor">
      ${renderSectionHeader('Typography & Display')}
      <div class="settings-list">
        ${renderRow({
          icon: Type,
          label: 'Font Size',
          hint: 'Adjust the primary display size for your notes (px).',
          actionHtml: renderNumberInput('fontSize', s?.fontSize || 14, 10, 40),
          searchData: 'font size controls the editor font size px'
        })}
        ${renderRow({
          icon: Scan,
          label: 'Caret Thickness',
          hint: "Set the width of the editor's insertion point cursor.",
          actionHtml: renderNumberInput('caretMaxWidth', s?.caretMaxWidth ?? 2, 1, 10),
          searchData: 'caret width set the max width for the editor caret'
        })}
      </div>
      <div class="settings-divider" style="margin-top: 24px;"></div>
      <div class="settings-view__section-header" style="border: none; margin-top: 8px;">
          <h3 class="settings-view__section-title">Editor Aesthetic</h3>
          <p class="settings-row__hint" style="margin-top: 4px; padding-left: 0;">Choose your preferred styling for the writing workspace.</p>
      </div>
      <div class="settings-list">
        ${renderRow({
          icon: Palette,
          label: 'Workspace Theme',
          hint: 'A specialized skin for your notes.',
          actionHtml: renderEditorThemeSelector(),
          searchData: 'workspace theme note skin ui appearance aesthetic'
        })}
      </div>
    </div>
  `
}

export function renderEditorOptionsSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'editor-options' ? 'is-active' : ''}" data-section="editor-options">
      ${renderSectionHeader('Editor Experience')}
      <div class="settings-list">
        ${renderRow({
          icon: Eye,
          label: 'Caret Visibility',
          hint: 'Toggle the high-visibility focus cursor in the editor.',
          actionHtml: renderToggle('caretEnabled', s?.caretEnabled ?? true),
          searchData: 'caret show or hide the editor caret'
        })}
        ${renderRow({
          icon: ListOrdered,
          label: 'Line Numbers',
          hint: 'Display indices on the left gutter for better navigation.',
          actionHtml: renderToggle('lineNumbers', s?.lineNumbers ?? true),
          searchData: 'line numbers show or hide the line numbers in the gutter'
        })}
        ${renderRow({
          icon: WrapText,
          label: 'Word Wrap',
          hint: "Soft-wrap long lines to fit within the editor's horizontal bounds.",
          actionHtml: renderToggle('wordWrap', s?.wordWrap ?? true),
          searchData: 'word wrap wrap long lines to fit the editor width'
        })}
      </div>
    </div>
  `
}

export function renderAppearanceSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'appearance' ? 'is-active' : ''}" data-section="appearance">
      ${renderSectionHeader('Visual Shell')}
      <div class="settings-list">
        ${renderRow({
          icon: PanelLeft,
          label: 'Explorer Sidebar',
          hint: 'Show or hide the primary navigation pane.',
          actionHtml: renderToggle('sidebarVisible', s?.sidebarVisible ?? true),
          searchData: 'sidebar visibility show or hide explorer'
        })}
        ${renderRow({
          icon: Scan,
          label: 'Context Panel',
          hint: 'Toggle visibility for AI chat and metadata side-panel.',
          actionHtml: renderToggle('rightPanelVisible', s?.rightPanelVisible ?? true),
          searchData: 'right panel show or hide the chat panel'
        })}
      </div>
    </div>
  `
}

export function renderBehaviorSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'behavior' ? 'is-active' : ''}" data-section="behavior">
      ${renderSectionHeader('Application Behavior')}
      <div class="settings-list">
        ${renderRow({
          icon: Save,
          label: 'Auto-Save Changes',
          hint: 'Automatically persist edits after a period of inactivity.',
          actionHtml: renderToggle('autoSave', s?.autoSave ?? true),
          searchData: 'auto save automatically save changes'
        })}
        ${renderRow({
          icon: Timer,
          label: 'Save Latency (ms)',
          hint: 'Wait duration after typing stops before saving (100-5000ms).',
          actionHtml: renderNumberInput('autoSaveDelay', s?.autoSaveDelay || 800, 100, 5000),
          searchData: 'auto save delay wait time before saving ms'
        })}
      </div>
    </div>
  `
}

export function renderAISection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'ai' ? 'is-active' : ''}" data-section="ai">
      ${renderSectionHeader('Neural Engine (AI)')}
      <div class="settings-list">
        ${renderRow({
          icon: Zap,
          label: 'AI Provider',
          hint: 'Select the primary Intelligence service for chat and indexing.',
          actionHtml: `
            <select class="settings-select" data-setting="aiProvider">
              <option value="deepseek" ${s?.aiProvider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
              <option value="openai" ${s?.aiProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
              <option value="claude" ${s?.aiProvider === 'claude' ? 'selected' : ''}>Anthropic Claude</option>
              <option value="grok" ${s?.aiProvider === 'grok' ? 'selected' : ''}>xAI Grok</option>
              <option value="ollama" ${s?.aiProvider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
            </select>
          `,
          searchData: 'ai provider neural engine service intelligence chat'
        })}

        <div class="settings-ai-provider-group" style="display: ${s?.aiProvider === 'openai' ? 'block' : 'none'}">
          ${renderRow({
            icon: Key,
            label: 'OpenAI Token',
            hint: 'Secure access key from platform.openai.com',
            actionHtml: `<input type="password" class="settings-input" data-setting="openaiApiKey" placeholder="sk-..." value="${s?.openaiApiKey || ''}" />`,
            searchData: 'openai token api key credentials'
          })}
        </div>

        <div class="settings-ai-provider-group" style="display: ${s?.aiProvider === 'deepseek' || !s?.aiProvider ? 'block' : 'none'}">
          ${renderRow({
            icon: Key,
            label: 'DeepSeek Token',
            hint: 'Secure access key from platform.deepseek.com',
            actionHtml: `<input type="password" class="settings-input" data-setting="deepseekApiKey" placeholder="sk-..." value="${s?.deepseekApiKey || ''}" />`,
            searchData: 'deepseek token api key credentials'
          })}
        </div>

        <div class="settings-ai-provider-group" style="display: ${s?.aiProvider === 'claude' ? 'block' : 'none'}">
          ${renderRow({
            icon: Key,
            label: 'Anthropic Token',
            hint: 'Secure access key from console.anthropic.com',
            actionHtml: `<input type="password" class="settings-input" data-setting="claudeApiKey" placeholder="sk-ant-..." value="${s?.claudeApiKey || ''}" />`,
            searchData: 'anthropic claude token api key credentials'
          })}
        </div>

        <div class="settings-ai-provider-group" style="display: ${s?.aiProvider === 'grok' ? 'block' : 'none'}">
          ${renderRow({
            icon: Key,
            label: 'xAI Token',
            hint: 'Secure access key from console.x.ai',
            actionHtml: `<input type="password" class="settings-input" data-setting="grokApiKey" placeholder="xai-..." value="${s?.grokApiKey || ''}" />`,
            searchData: 'xai grok token api key credentials'
          })}
        </div>

        <div class="settings-ai-provider-group" style="display: ${s?.aiProvider === 'ollama' ? 'block' : 'none'}">
          ${renderRow({
            icon: Cpu,
            label: 'Local Server',
            hint: 'Base URL for your Ollama instance (e.g., http://localhost:11434).',
            actionHtml: `
              <div style="display: flex; gap: 8px; flex: 1; max-width: 250px;">
                <input type="text" class="settings-input" data-setting="ollamaBaseUrl" placeholder="http://localhost:11434" value="${s?.ollamaBaseUrl || ''}" />
                <button class="settings-button settings-button--sm settings-button--secondary" id="view-refresh-ollama-models" title="Fetch available models">
                  ${createLucideIcon(Sparkles, 14)}
                </button>
              </div>
            `,
            searchData: 'ollama local server base url endpoint neural'
          })}
          ${renderRow({
            icon: Sparkles,
            label: 'Ollama Model',
            hint: 'Select from models available on your local server.',
            actionHtml: `
              <select class="settings-select" id="view-ollama-model-select" data-setting="aiModel">
                <option value="">Select a model...</option>
                ${s?.aiModel ? `<option value="${s.aiModel}" selected>${s.aiModel}</option>` : ''}
              </select>
            `
          })}
        </div>

        <div id="view-general-model-section" style="display: ${s?.aiProvider !== 'ollama' ? 'block' : 'none'}">
          ${renderRow({
            icon: Sparkles,
            label: 'Model Version',
            hint: 'Select the specific neural model to use for generations.',
            actionHtml: `
              <select class="settings-select" id="view-general-model-select" data-setting="aiModel">
                <option value="">Default (Provider Recommended)</option>
              </select>
            `
          })}
        </div>
      </div>
    </div>
  `
}

export function renderVaultSection(activeSection: string): string {
  return `
    <div class="settings-view__section ${activeSection === 'vault' ? 'is-active' : ''}" data-section="vault">
      ${renderSectionHeader('Vault Configuration')}
      <div class="settings-list">
        ${renderRow({
          icon: FolderSync,
          label: 'Active Vault Path',
          hint: state.vaultPath || 'No vault selected',
          actionHtml: `
            <button class="settings-button settings-button--sm settings-button--secondary" id="settings-vault-reveal">
              ${createLucideIcon(FolderOpen, 14)} Reveal
            </button>
          `
        })}
        ${renderRow({
          icon: PlusCircle,
          label: 'Switch or Initialize',
          hint: 'Select a different folder or create a new vault location.',
          actionHtml: `
            <button class="settings-button settings-button--sm settings-button--primary" id="settings-vault-change">
              Change Folder
            </button>
          `
        })}

        <div class="settings-divider"></div>
        <div class="settings-view__section-header" style="border: none; margin-top: 8px;">
          <h3 class="settings-view__section-title">Recent Vaults</h3>
        </div>

        <div class="settings-recent-vaults" id="settings-vault-list">
          <div class="settings-vault-list__loading">Indexing recent locations...</div>
        </div>
      </div>
    </div>
  `
}

export function renderSyncSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'sync' ? 'is-active' : ''}" data-section="sync">
      ${renderSectionHeader('Cloud Sync (GitHub)')}
      <div class="settings-list">
        ${renderRow({
          icon: Github,
          label: 'Access Token',
          hint: "GitHub Personal Access Token with 'gist' scope.",
          actionHtml: `
            <div style="display: flex; gap: 8px; flex: 1; max-width: 400px;">
              <input type="password" class="settings-input" data-setting="gistToken" placeholder="ghp_..." value="${(s as any)?.gistToken || ''}">
              <button class="settings-button settings-button--sm settings-button--secondary" id="settings-sync-test-token">Test</button>
            </div>
          `,
          searchData: 'github token access gist sync backup restore'
        })}

        ${renderRow({
          icon: Key,
          label: 'Gist Identifier',
          hint: 'Auto-filled after your first successful backup.',
          actionHtml: `<input type="text" class="settings-input" data-setting="gistId" value="${(s as any)?.gistId || ''}" readonly style="max-width: 400px;">`,
          searchData: 'gist id identifier sync'
        })}

        <div class="settings-divider"></div>

        ${renderRow({
          icon: CloudUpload,
          label: 'Push Backup',
          hint: 'Upload current vault contents to your secure Gist.',
          actionHtml: `
            <button class="settings-button settings-button--sm settings-button--primary" id="settings-sync-backup">
              ${createLucideIcon(CloudUpload, 16)} Backup to Gist
            </button>
          `,
          searchData: 'backup upload push sync'
        })}

        ${renderRow({
          icon: CloudDownload,
          label: 'Pull Recovery',
          hint: 'Overwrite local data with the latest cloud backup.',
          actionHtml: `
            <button class="settings-button settings-button--sm settings-button--secondary" id="settings-sync-restore">
              Restore
            </button>
          `,
          searchData: 'restore download pull recovery sync'
        })}
      </div>
    </div>
  `
}

export function renderShortcutsSection(activeSection: string): string {
  return `
    <div class="settings-view__section ${activeSection === 'shortcuts' ? 'is-active' : ''}" data-section="shortcuts">
      ${renderSectionHeader('Keyboard Shortcuts')}
      <div class="settings-shortcuts">
        ${renderShortcutItems()}
      </div>
    </div>
  `
}

export function renderTerminalSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'terminal' ? 'is-active' : ''}" data-section="terminal">
      ${renderSectionHeader('Terminal Configuration')}
      <div class="settings-list">
        ${renderRow({
          icon: Type,
          label: 'Font Size',
          hint: 'Size of the terminal text (px).',
          actionHtml: renderNumberInput('terminalFontSize', s?.terminalFontSize || 14, 10, 36),
          searchData: 'terminal font size px'
        })}
        ${renderRow({
          icon: Type,
          label: 'Font Family',
          hint: 'Font family for the terminal.',
          actionHtml: `<input type="text" class="settings-input" data-setting="terminalFontFamily" value="${s?.terminalFontFamily || 'Consolas, monospace'}" placeholder='Consolas, "Courier New", monospace' />`,
          searchData: 'terminal font family typography'
        })}
        
        <div class="settings-divider"></div>
        <div class="settings-view__section-header" style="border: none; margin-top: 8px;">
          <h3 class="settings-view__section-title">Terminal Colors</h3>
        </div>

        ${renderRow({
          icon: Layout,
          label: 'Frame Color',
          hint: 'Color of the terminal window frame.',
          actionHtml: renderColorInput('terminalFrameColor', s?.terminalFrameColor || '#1e1e1e'),
          searchData: 'terminal frame color background'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Background Color',
          hint: 'Background color of the terminal.',
          actionHtml: renderColorInput('terminalBackground', s?.terminalBackground || '#1e1e1e'),
          searchData: 'terminal background color background'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Text Color',
          hint: 'Default text color.',
          actionHtml: renderColorInput('terminalForeground', s?.terminalForeground || '#cccccc'),
          searchData: 'terminal text color foreground'
        })}
        ${renderRow({
          icon: Scan,
          label: 'Cursor Color',
          hint: 'Color of the terminal cursor.',
          actionHtml: renderColorInput('terminalCursor', s?.terminalCursor || '#ffffff'),
          searchData: 'terminal cursor color'
        })}
      </div>
    </div>
  `
}

export function renderSearchSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'search' ? 'is-active' : ''}" data-section="search">
      ${renderSectionHeader('Search Input Styling')}
      <div class="settings-list">
        ${renderRow({
          icon: Pipette,
          label: 'Background Color',
          hint: 'Background color of the search input field.',
          actionHtml: renderColorInput(
            'searchInput.backgroundColor',
            s?.searchInput?.backgroundColor || '#3c3c3c'
          ),
          searchData: 'search input background color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Border Color',
          hint: 'Border color of the search input.',
          actionHtml: renderColorInput(
            'searchInput.borderColor',
            s?.searchInput?.borderColor || 'rgba(255, 255, 255, 0.1)'
          ),
          searchData: 'search input border color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Focus Border Color',
          hint: 'Border color when input is focused.',
          actionHtml: renderColorInput(
            'searchInput.focusBorderColor',
            s?.searchInput?.focusBorderColor || '#007acc'
          ),
          searchData: 'search input focus border color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Text Color',
          hint: 'Color of the search text.',
          actionHtml: renderColorInput(
            'searchInput.textColor',
            s?.searchInput?.textColor || '#ffffff'
          ),
          searchData: 'search input text color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Placeholder Color',
          hint: 'Color of the placeholder text.',
          actionHtml: renderColorInput(
            'searchInput.placeholderColor',
            s?.searchInput?.placeholderColor || '#858585'
          ),
          searchData: 'search input placeholder color'
        })}

        <div class="settings-divider"></div>
        <div class="settings-view__section-header" style="border: none; margin-top: 8px;">
          <h3 class="settings-view__section-title">Button Colors</h3>
        </div>

        ${renderRow({
          icon: Pipette,
          label: 'Button Color',
          hint: 'Color of search action buttons.',
          actionHtml: renderColorInput(
            'searchInput.buttonColor',
            s?.searchInput?.buttonColor || '#cccccc'
          ),
          searchData: 'search button color text'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Button Hover Color',
          hint: 'Color of buttons on hover.',
          actionHtml: renderColorInput(
            'searchInput.buttonHoverColor',
            s?.searchInput?.buttonHoverColor || '#ffffff'
          ),
          searchData: 'search button hover color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Button Active Color',
          hint: 'Color of active/selected buttons.',
          actionHtml: renderColorInput(
            'searchInput.buttonActiveColor',
            s?.searchInput?.buttonActiveColor || '#007acc'
          ),
          searchData: 'search button active color'
        })}
      </div>
    </div>
  `
}

export function renderTabSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'tab' ? 'is-active' : ''}" data-section="tab">
      ${renderSectionHeader('Tab Customization')}
      <div class="settings-list">
        ${renderRow({
          icon: Frame,
          label: 'Border Position',
          hint: 'Choose which side the active tab border appears on.',
          actionHtml: `
            <select class="settings-select" data-setting="tab.borderPosition" style="width: 120px;">
              <option value="top" ${s?.tab?.borderPosition === 'top' ? 'selected' : ''}>Top</option>
              <option value="bottom" ${s?.tab?.borderPosition === 'bottom' ? 'selected' : ''}>Bottom</option>
              <option value="left" ${s?.tab?.borderPosition === 'left' ? 'selected' : ''}>Left</option>
              <option value="right" ${s?.tab?.borderPosition === 'right' ? 'selected' : ''}>Right</option>
            </select>
          `,
          searchData: 'tab border position top bottom left right tab shell layout'
        })}
        ${renderRow({
          icon: Zap,
          label: 'Compact Tabs',
          hint: 'Reduce tab height and padding for more screen space.',
          actionHtml: renderToggle('tab.compactMode', s?.tab?.compactMode ?? false),
          searchData: 'tab compact mode smaller tabs'
        })}

        <div class="settings-divider"></div>
        <div class="settings-view__section-header" style="border: none; margin-top: 8px;">
          <h3 class="settings-view__section-title">Colors & Aesthetics</h3>
        </div>

        ${renderRow({
          icon: Pipette,
          label: 'Background Color',
          hint: 'Define the base background for the tab bar.',
          actionHtml: renderColorInput('tab.backgroundColor', s?.tab?.backgroundColor || '#1e1e1e'),
          searchData: 'tab background color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Border Color',
          hint: 'Define the color of the accent border.',
          actionHtml: renderColorInput('tab.borderColor', s?.tab?.borderColor || '#007acc'),
          searchData: 'tab border color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Active Tab Color',
          hint: 'Background color for the currently focused tab.',
          actionHtml: renderColorInput('tab.activeTabColor', s?.tab?.activeTabColor || '#2d2d2d'),
          searchData: 'active tab background color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Inactive Tab Color',
          hint: 'Background color for non-focused tabs.',
          actionHtml: renderColorInput(
            'tab.inactiveTabColor',
            s?.tab?.inactiveTabColor || '#1e1e1e'
          ),
          searchData: 'inactive tab background color'
        })}
        ${renderRow({
          icon: Type,
          label: 'Active Text Color',
          hint: 'Label color for the active tab.',
          actionHtml: renderColorInput('tab.activeTextColor', s?.tab?.activeTextColor || '#ffffff'),
          searchData: 'active tab text color label'
        })}
        ${renderRow({
          icon: Type,
          label: 'Inactive Text Color',
          hint: 'Label color for background tabs.',
          actionHtml: renderColorInput(
            'tab.inactiveTextColor',
            s?.tab?.inactiveTextColor || '#969696'
          ),
          searchData: 'inactive tab text color label'
        })}
      </div>
    </div>
  `
}

export function renderSidebarSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'sidebar' ? 'is-active' : ''}" data-section="sidebar">
      ${renderSectionHeader('Sidebar Customization')}
      
      <div class="settings-list">
        ${renderRow({
          icon: Pipette,
          label: 'Background Color',
          hint: 'Base background for the explorer panel.',
          actionHtml: renderColorInput(
            'sidebar.backgroundColor',
            s?.sidebar?.backgroundColor || '#252526'
          ),
          searchData: 'sidebar background color'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Border Color',
          hint: 'Color of the divider between sidebar and editor.',
          actionHtml: renderColorInput('sidebar.borderColor', s?.sidebar?.borderColor || '#333333'),
          searchData: 'sidebar border color'
        })}
        ${renderRow({
          icon: Type,
          label: 'Text Color',
          hint: 'Color for file and folder names.',
          actionHtml: renderColorInput('sidebar.textColor', s?.sidebar?.textColor || '#cccccc'),
          searchData: 'sidebar text color labels'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Active Item Background',
          hint: 'Background color for the currently active file.',
          actionHtml: renderColorInput(
            'sidebar.activeItemColor',
            s?.sidebar?.activeItemColor || '#37373d'
          ),
          searchData: 'sidebar active item background color'
        })}
        ${renderRow({
          icon: Type,
          label: 'Active Text Color',
          hint: 'Text color for the currently active file.',
          actionHtml: renderColorInput(
            'sidebar.activeTextColor',
            s?.sidebar?.activeTextColor || '#ffffff'
          ),
          searchData: 'sidebar active text color labels'
        })}
        ${renderRow({
          icon: Type,
          label: 'Font Size',
          hint: 'Size of text in the file explorer (px).',
          actionHtml: renderNumberInput('sidebar.fontSize', s?.sidebar?.fontSize || 13, 10, 24),
          searchData: 'sidebar font size px explorer'
        })}
      </div>
    </div>
  `
}

export function renderActivityBarSection(activeSection: string): string {
  const s = state.settings
  return `
    <div class="settings-view__section ${activeSection === 'activityBar' ? 'is-active' : ''}" data-section="activityBar">
       ${renderSectionHeader('Activity Bar')}
      <div class="settings-list">
        ${renderRow({
          icon: Pipette,
          label: 'Background Color',
          hint: 'Main background for the sidebar icon strip.',
          actionHtml: renderColorInput(
            'activityBar.backgroundColor',
            s?.activityBar?.backgroundColor || '#333333'
          ),
          searchData: 'activity bar background color strip'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Border Color',
          hint: 'Color of the divider between activity bar and sidebar.',
          actionHtml: renderColorInput(
            'activityBar.borderColor',
            s?.activityBar?.borderColor || '#252526'
          ),
          searchData: 'activity bar border color sidebar divider'
        })}
        ${renderRow({
          icon: Pipette,
          label: 'Active Item Background',
          hint: 'Highlight color for the selected icon.',
          actionHtml: renderColorInput(
            'activityBar.activeItemColor',
            s?.activityBar?.activeItemColor || 'rgba(255, 255, 255, 0.05)'
          ),
          searchData: 'activity bar active item background color highlight'
        })}
        ${renderRow({
          icon: Palette,
          label: 'Active Icon Color',
          hint: 'Color for the active view icon.',
          actionHtml: renderColorInput(
            'activityBar.activeIconColor',
            s?.activityBar?.activeIconColor || '#ffffff'
          ),
          searchData: 'activity bar active icon color palette'
        })}
        ${renderRow({
          icon: Palette,
          label: 'Inactive Icon Color',
          hint: 'Default color for background icons.',
          actionHtml: renderColorInput(
            'activityBar.inactiveIconColor',
            s?.activityBar?.inactiveIconColor || 'rgba(255, 255, 255, 0.4)'
          ),
          searchData: 'activity bar inactive icon color palette'
        })}
      </div>
    </div>
  `
}

export function renderSidebar(activeSection: string, searchQuery: string): string {
  return `
    <aside class="settings-view__sidebar">
      <div class="settings-view__sidebar-title">Settings</div>
      <div class="settings-sidebar-search">
         <div class="settings-sidebar-search__icon">${createLucideIcon(Search, 14)}</div>
         <input
           type="text"
           class="settings-search__input"
           placeholder="Filter settings..."
           value="${searchQuery}"
           spellcheck="false"
         />
         ${
           searchQuery
             ? `<button class="settings-sidebar-search__clear" id="settings-search-clear" title="Clear search">${createLucideIcon(X, 14)}</button>`
             : ''
         }
      </div>
      <button class="settings-view__sidebar-item ${activeSection === 'editor' ? 'is-active' : ''}" data-section-tab="editor">
        ${codicons.edit} Editor
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'editor-options' ? 'is-active' : ''}" data-section-tab="editor-options">
        ${codicons.settingsGear} Editor Options
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'appearance' ? 'is-active' : ''}" data-section-tab="appearance">
        ${codicons.paintbrush} Appearance
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'behavior' ? 'is-active' : ''}" data-section-tab="behavior">
        ${codicons.settingsGear} Behavior
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'ai' ? 'is-active' : ''}" data-section-tab="ai">
        ${codicons.sparkles} AI
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'vault' ? 'is-active' : ''}" data-section-tab="vault">
        ${codicons.folderRoot} Vault
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'sync' ? 'is-active' : ''}" data-section-tab="sync" data-search="sync backup restore github gist cloud">
        ${createLucideIcon(CloudUpload, 16)} Sync
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'shortcuts' ? 'is-active' : ''}" data-section-tab="shortcuts">
        ${codicons.keyboard} Shortcuts
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'terminal' ? 'is-active' : ''}" data-section-tab="terminal">
        ${codicons.terminal} Terminal
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'tab' ? 'is-active' : ''}" data-section-tab="tab">
        ${createLucideIcon(Layout, 16)} Tab
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'security' ? 'is-active' : ''}" data-section-tab="security">
        ${codicons.lock} Security
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'sidebar' ? 'is-active' : ''}" data-section-tab="sidebar">
        ${createLucideIcon(PanelLeft, 16)} Sidebar
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'activityBar' ? 'is-active' : ''}" data-section-tab="activityBar">
        ${createLucideIcon(Activity, 16)} Activity Bar
      </button>
      <button class="settings-view__sidebar-item ${activeSection === 'search' ? 'is-active' : ''}" data-section-tab="search">
        ${createLucideIcon(Search, 16)} Search UI
      </button>
    </aside>
  `
}
