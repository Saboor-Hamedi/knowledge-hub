import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const settingsFile = join(app.getPath('userData'), 'settings.json')

export type Settings = {
  vaultPath?: string
  theme?: string
  editorTheme?: string
  sidebarVisible?: boolean
  autoSave?: boolean
  autoSaveDelay?: number
  fontSize?: number
  lineNumbers?: boolean
  wordWrap?: boolean
  minimap?: boolean
  recentVaults?: string[]
  lastOpenedNote?: string
  expandedFolders?: string[]
  openTabs?: { id: string; path?: string; title?: string }[]
  pinnedTabs?: string[]
  activeId?: string
  activeView?: 'notes' | 'search' | 'settings' | 'graph' | 'history' | 'theme'
  windowBounds?: { width: number; height: number; x?: number; y?: number }
  deepseekApiKey?: string
  openaiApiKey?: string
  claudeApiKey?: string
  grokApiKey?: string
  ollamaBaseUrl?: string
  aiProvider?: 'deepseek' | 'openai' | 'claude' | 'grok' | 'ollama'
  aiModel?: string
  gistToken?: string
  gistId?: string
  rightPanelWidth?: number
  rightPanelVisible?: boolean
  passwordHash?: string | null
  activeSettingsSection?: string
  // Caret settings
  caretEnabled?: boolean
  caretMaxWidth?: number
  cursorPositions?: Record<string, { lineNumber: number; column: number }>
  graphTheme?: string
  graphZoom?: { x: number; y: number; k: number }
  // Security & Lock screen settings
  fireWall?: {
    passwordHash?: string | null
    lockScreenAlignment?: 'left' | 'center' | 'right'
    lockScreenName?: string
    autoLockTimeout?: number
  }
  // TTS settings
  ttsVoice?: string
  ttsSpeed?: number
  // Tab appearance settings
  tab?: {
    borderPosition?: 'right' | 'left' | 'top' | 'bottom'
    backgroundColor?: string
    borderColor?: string
    activeTabColor?: string
    inactiveTabColor?: string
    activeTextColor?: string
    inactiveTextColor?: string
    compactMode?: boolean
  }
  sidebar?: {
    backgroundColor?: string
    borderColor?: string
    textColor?: string
    activeItemColor?: string
    activeTextColor?: string
    fontSize?: number
  }
  activityBar?: {
    backgroundColor?: string
    borderColor?: string
    activeItemColor?: string
    activeIconColor?: string
    inactiveIconColor?: string
  }
  statusbar?: {
    words?: boolean
    chars?: boolean
    lines?: boolean
    tags?: boolean
    links?: boolean
    cursor?: boolean
    sync?: boolean
    version?: boolean
    git?: boolean
  }
  // Terminal Customization
  terminalFontSize?: number
  terminalFontFamily?: string
  terminalBackground?: string
  terminalForeground?: string
  terminalCursor?: string
  terminalFrameColor?: string
  terminalDefaultShell?: string
  searchInput?: {
    backgroundColor?: string
    borderColor?: string
    focusBorderColor?: string
    textColor?: string
    placeholderColor?: string
    buttonColor?: string
    buttonHoverColor?: string
    buttonActiveColor?: string
  }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  autoSave: true,
  autoSaveDelay: 800,
  fontSize: 14,
  lineNumbers: true,
  wordWrap: true,
  minimap: false,
  // sensible defaults for caret
  caretEnabled: true,
  caretMaxWidth: 2,
  recentVaults: [],
  expandedFolders: [],
  sidebarVisible: true,
  rightPanelVisible: false,
  graphTheme: 'default',
  fireWall: {
    passwordHash: null,
    lockScreenAlignment: 'center',
    lockScreenName: '',
    autoLockTimeout: 0
  },
  ttsSpeed: 1.0,
  terminalDefaultShell: 'powershell',
  terminalFontSize: 13,
  editorTheme: 'dark',
  activeView: 'notes',
  aiProvider: 'deepseek',
  aiModel: '',
  sidebar: {
    fontSize: 13
  },
  activityBar: {}
}

/**
 * Loads the current settings from disk, merging with defaults.
 * @returns The complete Settings object.
 */
export function loadSettings(): Settings {
  try {
    if (!existsSync(settingsFile)) {
      saveSettings(DEFAULT_SETTINGS)
      return { ...DEFAULT_SETTINGS }
    }

    const raw = readFileSync(settingsFile, 'utf-8')
    const loaded = JSON.parse(raw) as Partial<Settings>
    const merged: Settings = { ...DEFAULT_SETTINGS, ...loaded }

    if (merged.autoSaveDelay && (merged.autoSaveDelay < 100 || merged.autoSaveDelay > 5000)) {
      merged.autoSaveDelay = DEFAULT_SETTINGS.autoSaveDelay
    }

    if (merged.fontSize && (merged.fontSize < 8 || merged.fontSize > 32)) {
      merged.fontSize = DEFAULT_SETTINGS.fontSize
    }

    if (!merged.recentVaults) merged.recentVaults = []
    if (!merged.expandedFolders) merged.expandedFolders = []

    // Validate caret settings
    if (merged.caretEnabled === undefined) merged.caretEnabled = DEFAULT_SETTINGS.caretEnabled
    if (merged.caretMaxWidth && (merged.caretMaxWidth < 1 || merged.caretMaxWidth > 10)) {
      merged.caretMaxWidth = DEFAULT_SETTINGS.caretMaxWidth
    }

    // Migrate old settings to fireWall
    if (!merged.fireWall) {
      merged.fireWall = { ...DEFAULT_SETTINGS.fireWall }
    } else {
      // Ensure sub-keys exist
      merged.fireWall = { ...DEFAULT_SETTINGS.fireWall, ...merged.fireWall }
    }

    const oldKeys = ['passwordHash', 'lockScreenAlignment', 'lockScreenName'] as const
    const loadedAny = loaded as Record<string, unknown>
    const mergedAny = merged as Record<string, unknown>
    const firewall = merged.fireWall as Record<string, unknown>

    oldKeys.forEach((key) => {
      if (loadedAny[key] !== undefined) {
        firewall[key] = loadedAny[key]
        delete mergedAny[key]
      }
    })

    return merged
  } catch (error) {
    console.warn('Failed to read settings, using defaults', error)
    saveSettings(DEFAULT_SETTINGS)
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Persists the settings object to the local disk.
 * @param settings The settings to save.
 */
export function saveSettings(settings: Settings): void {
  try {
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save settings', error)
  }
}

const NESTED_SETTING_OBJECTS: (keyof Settings)[] = [
  'fireWall',
  'sidebar',
  'tab',
  'activityBar',
  'statusbar',
  'searchInput'
]

/**
 * Updates the existing settings with a partial object.
 * Performs deep merging for complex UI preference objects.
 * @param updates The changes to apply.
 * @returns The updated complete Settings object.
 */
export function updateSettings(updates: Partial<Settings>): Settings {
  const current = loadSettings()

  // Helper for deep merging specific top-level objects to prevent wiping siblings
  const deepMerge = (obj: Settings, source: Partial<Settings>, key: keyof Settings): void => {
    const sourceVal = source[key]
    const objVal = obj[key]

    if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      if (objVal && typeof objVal === 'object' && !Array.isArray(objVal)) {
        // Safe cast since we checked the key is valid and target is an object
        ;(obj as unknown as Record<string, unknown>)[key] = {
          ...(objVal as Record<string, unknown>),
          ...(sourceVal as Record<string, unknown>)
        }
      } else {
        ;(obj as unknown as Record<string, unknown>)[key] = sourceVal
      }
    } else if (sourceVal !== undefined) {
      ;(obj as unknown as Record<string, unknown>)[key] = sourceVal
    }
  }

  const updated: Settings = { ...current, ...updates }

  // Apply deep merging for complex preference groups
  NESTED_SETTING_OBJECTS.forEach((key) => deepMerge(updated, updates, key))

  saveSettings(updated)
  return updated
}

/**
 * Resets UI/Editor settings to defaults while preserving sensitive/structural data.
 * Keeps: AI Keys, Vault Path, Security Password, and Workspace Setup.
 */
export function resetSettings(): Settings {
  const current = loadSettings()
  const reset: Settings = { ...DEFAULT_SETTINGS }

  // List of keys to STRICTLY PRESERVE from current settings
  const preservedKeys: (keyof Settings)[] = [
    'vaultPath',
    'recentVaults',
    'deepseekApiKey',
    'openaiApiKey',
    'claudeApiKey',
    'grokApiKey',
    'ollamaBaseUrl',
    'aiProvider',
    'aiModel',
    'gistToken',
    'gistId'
  ]

  preservedKeys.forEach((key) => {
    if (current[key] !== undefined) {
      ;(reset as unknown as Record<string, unknown>)[key] = current[key]
    }
  })

  // Deep preserve critical security bits (password) but let other security UI reset
  if (current.fireWall && current.fireWall.passwordHash) {
    reset.fireWall = {
      ...DEFAULT_SETTINGS.fireWall,
      passwordHash: current.fireWall.passwordHash
    }
  }

  saveSettings(reset)
  return reset
}
