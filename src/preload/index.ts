import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type NoteMeta = {
  id: string
  title: string
  updatedAt: number
  path?: string
  type?: 'note' | 'folder'
  children?: NoteMeta[]
  collapsed?: boolean
}

type TreeItem = NoteMeta

type NotePayload = NoteMeta & {
  content: string
}

// Custom APIs for renderer
type VaultInfo = {
  path: string
  name: string
  changed?: boolean
}

type AppSettings = {
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

const api = {
  requestUpdate: (): void => {
    ipcRenderer.send('app:update')
  },
  listNotes: (): Promise<TreeItem[]> => ipcRenderer.invoke('notes:list'),
  loadNote: (id: string, path?: string): Promise<NotePayload | null> =>
    ipcRenderer.invoke('notes:load', id, path),
  createNote: (title?: string, path?: string): Promise<NoteMeta> =>
    ipcRenderer.invoke('notes:create', title, path),
  saveNote: (payload: NotePayload): Promise<NoteMeta> => ipcRenderer.invoke('notes:save', payload),
  appendNote: (id: string, content: string): Promise<NoteMeta> =>
    ipcRenderer.invoke('notes:append', id, content),
  deleteNote: (id: string, path?: string): Promise<{ id: string }> =>
    ipcRenderer.invoke('notes:delete', id, path),
  moveNote: (id: string, fromPath?: string, toPath?: string): Promise<NoteMeta> =>
    ipcRenderer.invoke('notes:move', id, fromPath, toPath),
  renameNote: (id: string, newId: string, path?: string): Promise<NoteMeta> =>
    ipcRenderer.invoke('notes:rename', id, newId, path),
  duplicateNote: (id: string): Promise<NoteMeta> => ipcRenderer.invoke('notes:duplicate', id),
  importNote: (filePath: string, folderPath?: string): Promise<NoteMeta> =>
    ipcRenderer.invoke('notes:import', filePath, folderPath),
  saveAsset: (buffer: ArrayBuffer, name: string): Promise<string> =>
    ipcRenderer.invoke('assets:save', buffer, name),
  createFolder: (name: string, parentPath?: string): Promise<{ name: string; path: string }> =>
    ipcRenderer.invoke('folder:create', name, parentPath),

  deleteFolder: (path: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('folder:delete', path),
  renameFolder: (path: string, newName: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('folder:rename', path, newName),
  moveFolder: (sourcePath: string, targetPath: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('folder:move', sourcePath, targetPath),
  getVault: (): Promise<VaultInfo> => ipcRenderer.invoke('vault:get'),
  chooseVault: (): Promise<VaultInfo> => ipcRenderer.invoke('vault:choose'),
  setVault: (dir: string): Promise<VaultInfo> => ipcRenderer.invoke('vault:set', dir),
  revealVault: (path?: string): Promise<void> => ipcRenderer.invoke('vault:reveal', path),
  validateVaultPath: (path: string): Promise<{ exists: boolean; lastOpened?: number }> =>
    ipcRenderer.invoke('vault:validate', path),
  locateMovedVault: (originalPath: string): Promise<{ foundPath: string | null }> =>
    ipcRenderer.invoke('vault:locate', originalPath),

  searchNotes: (query: string, options?: Record<string, unknown>): Promise<NoteMeta[]> =>
    ipcRenderer.invoke('notes:search', query, options),
  getBacklinks: (id: string): Promise<string[]> => ipcRenderer.invoke('notes:getBacklinks', id),
  getGraph: (): Promise<{
    links: { source: string; target: string }[]
    tags?: Record<string, string[]>
    codeLinks?: { source: string; target: string }[]
  }> => ipcRenderer.invoke('graph:get'),
  getGitStatus: (): Promise<Record<string, string>> => ipcRenderer.invoke('git:status'),
  getGitInfo: (
    forcedPath?: string
  ): Promise<{
    status: Record<string, string>
    metadata: { branch: string; remote?: string; repoName?: string }
  }> => ipcRenderer.invoke('git:info', forcedPath),
  gitInit: (): Promise<boolean> => ipcRenderer.invoke('git:init'),
  getTerminalBuffer: (id: string): Promise<{ success: boolean; buffer: string }> =>
    ipcRenderer.invoke('terminal:get-buffer', id),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (updates: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', updates),
  resetSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:reset'),
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    unmaximize: (): Promise<void> => ipcRenderer.invoke('window:unmaximize'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close')
  },
  getAppIcon: (): Promise<string> => ipcRenderer.invoke('app:getIcon'),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getDocumentation: (section?: string): Promise<unknown> =>
    ipcRenderer.invoke('app:getDocumentation', section),
  getUsername: (): Promise<string> => ipcRenderer.invoke('system:getUsername'),
  syncBackup: (
    token: string,
    gistId: string | undefined,
    vaultData: unknown
  ): Promise<{ success: boolean; message: string; gistId?: string }> =>
    ipcRenderer.invoke('sync:backup', token, gistId, vaultData),
  syncRestore: (
    token: string,
    gistId: string
  ): Promise<{ success: boolean; message: string; data?: unknown }> =>
    ipcRenderer.invoke('sync:restore', token, gistId),
  syncTestToken: (token: string): Promise<{ valid: boolean; message: string }> =>
    ipcRenderer.invoke('sync:testToken', token),
  sessions: {
    backup: (): Promise<{ success: boolean; message?: string; path?: string }> =>
      ipcRenderer.invoke('sessions:backup'),
    restore: (): Promise<{ success: boolean; message?: string; data?: unknown }> =>
      ipcRenderer.invoke('sessions:restore')
  },
  onVaultChanged: (callback: (data: unknown) => void): (() => void) => {
    const subscription = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('vault:changed', subscription)
    return () => ipcRenderer.removeListener('vault:changed', subscription)
  },
  // Generic IPC methods for terminal
  openExternal: (url: string): void => {
    ipcRenderer.send('app:open-external', url)
  },
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]): void => {
    ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const subscription = (_event: unknown, ...args: unknown[]): void => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  path: {
    join: (...args: string[]): Promise<string> => ipcRenderer.invoke('path:join', ...args),
    resolve: (...args: string[]): Promise<string> => ipcRenderer.invoke('path:resolve', ...args),
    isAbsolute: (p: string): Promise<boolean> => ipcRenderer.invoke('path:isAbsolute', p),
    exists: (p: string): Promise<boolean> => ipcRenderer.invoke('path:exists', p)
  },
  onNoteOpened: (callback: (id: string) => void): void => {
    // This is currently a stub if not used, but let's keep the parameter to match expected interface
    void callback
  },
  getGitHistory: (filePath: string): Promise<Record<string, unknown>[]> =>
    ipcRenderer.invoke('git:history', filePath),
  getGitRepoHistory: (): Promise<Record<string, unknown>[]> =>
    ipcRenderer.invoke('git:repo-history'),
  getGitContentAtCommit: (filePath: string, hash: string): Promise<string> =>
    ipcRenderer.invoke('git:show-content', filePath, hash),
  getCommitDetails: (hash: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('git:commit-details', hash)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
