import { ElectronAPI } from '@electron-toolkit/preload'

type NoteMeta = {
  id: string
  title: string
  updatedAt: number
  createdAt?: number
  path?: string
  type?: 'note' | 'folder'
  children?: NoteMeta[]
  collapsed?: boolean
}

type TreeItem = NoteMeta

type GitCommit = {
  hash: string
  timestamp: number
  author: string
  subject: string
  parents?: string[]
}

type NotePayload = NoteMeta & {
  content: string
}

type VaultInfo = {
  path: string
  name: string
  changed?: boolean
}

type AppSettings = {
  vaultPath?: string
  theme?: string
  editorTheme?: string
  splitViewRatio?: number
  splitViewEnabled?: boolean
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

type WindowApi = {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  unmaximize: () => Promise<void>
  isMaximized: () => Promise<boolean>
  close: () => Promise<void>
}

type NoteApi = {
  requestUpdate: () => void
  listNotes: () => Promise<TreeItem[]>
  loadNote: (id: string, path?: string) => Promise<NotePayload | null>
  createNote: (title?: string, path?: string) => Promise<NoteMeta>
  saveNote: (payload: NotePayload) => Promise<NoteMeta>
  appendNote: (id: string, content: string) => Promise<NoteMeta>
  deleteNote: (id: string, path?: string) => Promise<{ id: string }>
  moveNote: (id: string, fromPath?: string, toPath?: string) => Promise<NoteMeta>
  renameNote: (id: string, newId: string, path?: string) => Promise<NoteMeta>
  duplicateNote: (id: string) => Promise<NoteMeta>
  importNote: (filePath: string, folderPath?: string) => Promise<NoteMeta>
  saveAsset: (buffer: ArrayBuffer, name: string) => Promise<string>
  createFolder: (name: string, parentPath?: string) => Promise<{ name: string; path: string }>
  renameFolder: (path: string, newName: string) => Promise<{ path: string }>
  deleteFolder: (path: string) => Promise<{ path: string }>
  moveFolder: (sourcePath: string, targetPath: string) => Promise<{ path: string }>
  searchNotes: (
    query: string,
    options?: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean }
  ) => Promise<NoteMeta[]>
  getBacklinks: (id: string) => Promise<string[]>
  getGraph: () => Promise<{
    links: { source: string; target: string }[]
    tags?: Record<string, string[]>
    codeLinks?: { source: string; target: string }[]
  }>
  getGitStatus: () => Promise<Record<string, string>>
  getGitInfo: (
    forcedPath?: string
  ) => Promise<{ status: Record<string, string>; metadata: GitMetadata }>
  gitInit: () => Promise<boolean>
  getGitHistory: (filePath: string) => Promise<GitCommit[]>
  getGitRepoHistory: () => Promise<GitCommit[]>
  getGitContentAtCommit: (filePath: string, hash: string) => Promise<string>
  getCommitDetails: (hash: string) => Promise<any>
  getVault: () => Promise<VaultInfo>
  chooseVault: () => Promise<VaultInfo>
  setVault: (dir: string) => Promise<VaultInfo>
  revealVault: (path?: string) => Promise<void>
  validateVaultPath: (path: string) => Promise<{ exists: boolean; lastOpened?: number }>
  locateMovedVault: (originalPath: string) => Promise<{ foundPath: string | null }>
  getSettings: () => Promise<AppSettings>
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>
  resetSettings: () => Promise<AppSettings>
  syncBackup: (
    token: string,
    gistId: string | undefined,
    vaultData: any
  ) => Promise<{ success: boolean; message: string; gistId?: string }>
  syncRestore: (
    token: string,
    gistId: string
  ) => Promise<{ success: boolean; message: string; data?: any }>
  syncTestToken: (token: string) => Promise<{ valid: boolean; message: string }>
  window: WindowApi
  getAppIcon: () => Promise<string>
  getAppVersion: () => Promise<string>
  getDocumentation: (section?: string) => Promise<any>
  getUsername: () => Promise<string>
  onVaultChanged: (callback: (data: any) => void) => () => void
  onNoteOpened: (callback: (id: string) => void) => void
  openExternal?: (url: string) => Promise<void>
  path?: any
  // Generic IPC methods for terminal
  invoke: (channel: string, ...args: any[]) => Promise<any>
  send: (channel: string, ...args: any[]) => void
  on: (channel: string, callback: (...args: any[]) => void) => () => void
  statusBar: {
    setStatus: (msg: string) => void
    setMeta: (msg: string) => void
    setMetrics: (metrics: { words: number; chars: number; lines: number } | null) => void
    setCursor: (pos: { ln: number; col: number } | null) => void
    updateVisibility: () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: NoteApi
  }
}
