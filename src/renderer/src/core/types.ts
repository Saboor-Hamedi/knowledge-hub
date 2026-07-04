export type NoteMeta = {
  id: string
  title: string
  updatedAt: number
  createdAt?: number
  path?: string
  type?: 'note' | 'folder'
  children?: NoteMeta[]
  collapsed?: boolean
}

export type FolderItem = NoteMeta & { type: 'folder' }

export type TreeItem = NoteMeta

export type NotePayload = NoteMeta & {
  content: string
}

export type AppState = {
  notes: NoteMeta[]
  tree: TreeItem[]
  expandedFolders: Set<string>
  openTabs: NoteMeta[]
  activeId: string
  isDirty: boolean
  lastSavedAt: number
  applyingRemote: boolean
  activeView: 'notes' | 'search' | 'settings' | 'graph' | 'history' | 'theme'
  projectName: string
  vaultPath?: string
  settings?: AppSettings
  pinnedTabs: Set<string>
  newlyCreatedIds: Set<string>
  selectedIds: Set<string>
  recentProjects?: { name: string; path: string }[]
  cursorPositions: Map<string, { lineNumber: number; column: number }>
  isLoading: boolean
}

export type AppSettings = {
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
  aiChatMode?: 'balanced' | 'thinking' | 'creative' | 'precise' | 'code'
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
