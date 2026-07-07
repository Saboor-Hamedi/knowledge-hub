// --- App Update Integration ---
import { setupUpdateApp } from '../renderer/src/components/updateApp/updateApp'
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  type MenuItemConstructorOptions
} from 'electron'
import { join, basename, dirname, isAbsolute, resolve } from 'path'
import { writeFile, mkdir, readFile, readdir } from 'fs/promises'
import { existsSync, mkdirSync, cpSync, readdirSync } from 'fs'
import { userInfo } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.ico?asset'
import { VaultManager } from './vault'
import type { NotePayload } from './vault'
import {
  loadSettings,
  saveSettings,
  updateSettings,
  resetSettings,
  type Settings
} from './settings'
import { createPool, closePool, isConnected, runMigrationsSafe, queries } from './knm/database'
import { documentExtractor } from './knm/extractor'
import { registerTerminalHandlers, cleanupTerminals } from './modules/terminal'
import {
  getGitStatus,
  getGitInfo,
  initGit,
  getFileHistory,
  getRepoHistory,
  getFileContentAtCommit,
  getCommitDetails
} from './git'

let mainWindowRef: BrowserWindow | null = null
const freshWindows = new Set<number>()

function addRecentVault(path: string): void {
  const settings = loadSettings()
  const recents = settings.recentVaults || []
  const filtered = recents.filter((p) => p !== path)
  settings.recentVaults = [path, ...filtered].slice(0, 10)
  saveSettings(settings)
}

function isValidVaultPath(path: string): boolean {
  if (!path || path.trim().length === 0) return false
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

function migrateVaultContent(oldPath: string, newPath: string): void {
  if (!existsSync(oldPath)) return
  if (!existsSync(newPath)) {
    try {
      mkdirSync(newPath, { recursive: true })
    } catch (e) {
      console.error('Failed to create new vault dir', e)
      return
    }
  }

  try {
    const files = readdirSync(newPath)
    if (files.length > 0) {
      return
    }
    cpSync(oldPath, newPath, { recursive: true })
  } catch {
    // Migration failed
  }
}

function resolveVaultPath(): string {
  const settings = loadSettings()
  const defaultPath = join(app.getPath('documents'), 'KnowledgeHub')
  const oldDefault = join(app.getPath('userData'), 'notes')

  if (settings.vaultPath === oldDefault) {
    migrateVaultContent(oldDefault, defaultPath)
    settings.vaultPath = undefined
    saveSettings(settings)
  }

  if (settings.vaultPath && isValidVaultPath(settings.vaultPath)) {
    return settings.vaultPath
  }

  if (!existsSync(defaultPath)) {
    try {
      mkdirSync(defaultPath, { recursive: true })
    } catch (e) {
      console.error('Failed to create default notes dir', e)
    }
  }

  if (settings.vaultPath && settings.vaultPath !== defaultPath) {
    settings.vaultPath = undefined
    saveSettings(settings)
  }

  return defaultPath
}

const vaultManagers = new Map<string, VaultManager>()
const windowVaultPaths = new Map<number, string>()

async function getOrCreateVaultManager(path: string): Promise<VaultManager> {
  const normPath = resolve(path)
  let manager = vaultManagers.get(normPath)
  if (!manager) {
    manager = new VaultManager()
    await manager.setVaultPath(normPath)
    vaultManagers.set(normPath, manager)
  }
  return manager
}

function getVaultManager(sender: Electron.WebContents): VaultManager | null {
  const win = BrowserWindow.fromWebContents(sender)
  if (!win) return null
  const path = windowVaultPaths.get(win.id)
  if (!path) return null
  return vaultManagers.get(resolve(path)) || null
}

async function ensureVault(sender: Electron.WebContents): Promise<VaultManager> {
  const manager = getVaultManager(sender)
  if (manager) return manager

  const path = resolveVaultPath()
  const newManager = await getOrCreateVaultManager(path)
  const win = BrowserWindow.fromWebContents(sender)
  if (win) {
    windowVaultPaths.set(win.id, path)
    newManager.addWindow(win)
  }
  return newManager
}

async function chooseVault(
  sender: Electron.WebContents
): Promise<{ path: string; name: string; changed: boolean }> {
  const manager = getVaultManager(sender)
  const currentPath = manager?.getRootPath() || resolveVaultPath()

  const result = await dialog.showOpenDialog({
    title: 'Select Knowledge Hub Vault',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: currentPath,
    buttonLabel: 'Select Vault'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { path: currentPath, name: basename(currentPath) || 'Vault', changed: false }
  }

  const selected = result.filePaths[0]
  if (selected === currentPath) {
    return { path: selected, name: basename(selected), changed: false }
  }

  try {
    const newManager = await getOrCreateVaultManager(selected)
    const win = BrowserWindow.fromWebContents(sender)
    if (win) {
      if (manager) manager.removeWindow(win)
      windowVaultPaths.set(win.id, selected)
      newManager.addWindow(win)
      // Once a vault is chosen, it's no longer a "fresh" window
      freshWindows.delete(win.id)
    }

    updateSettings({ vaultPath: selected })
    addRecentVault(selected)
    return { path: selected, name: basename(selected), changed: true }
  } catch (error) {
    throw new Error(`Cannot use selected folder: ${(error as Error).message}`)
  }
}

function createWindow(isNewInstance = false): void {
  const settings = loadSettings()
  const bounds = settings.windowBounds || { width: 1200, height: 800 }

  const mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon, // Set icon for all platforms
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: true,
      devTools: is.dev,
      additionalArguments: isNewInstance ? ['--new-instance'] : []
    }
  })
  mainWindowRef = mainWindow

  let boundsTimeout: NodeJS.Timeout
  mainWindow.on('resize', () => {
    clearTimeout(boundsTimeout)
    boundsTimeout = setTimeout(() => {
      // Don't save bounds if maximized, or we lose the restore size
      if (!mainWindow.isMaximized()) {
        const bounds = mainWindow.getBounds()
        updateSettings({ windowBounds: bounds })
      }
    }, 500)
  })

  mainWindow.on('move', () => {
    clearTimeout(boundsTimeout)
    boundsTimeout = setTimeout(() => {
      if (!mainWindow.isMaximized()) {
        const bounds = mainWindow.getBounds()
        updateSettings({ windowBounds: bounds })
      }
    }, 500)
  })

  mainWindow.on('ready-to-show', async () => {
    mainWindow.maximize()
    mainWindow.show()
    if (!isNewInstance) {
      const v = await ensureVault(mainWindow.webContents)
      v.addWindow(mainWindow)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Prevent internal navigation to external sites (which causes a blank screen)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isInternal =
      url.startsWith('file://') ||
      url.startsWith('http://localhost:5173') ||
      url.startsWith('http://localhost:3000') ||
      url.startsWith('http://localhost:4173')

    if (!isInternal) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (isNewInstance) {
    freshWindows.add(mainWindow.id)
    mainWindow.on('closed', () => freshWindows.delete(mainWindow.id))
  }

  const query = isNewInstance ? '?newInstance=true' : ''

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      search: isNewInstance ? 'newInstance=true' : ''
    })
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  console.log('[Main] Registering config handlers...')
  // Config Handlers (for .config.json in vault)
  ipcMain.handle('config:get', async (event) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    const configPath = join(root, '.config.json')
    try {
      if (existsSync(configPath)) {
        const raw = await readFile(configPath, 'utf-8')
        return JSON.parse(raw)
      }
    } catch (e) {
      console.error('[Config] Failed to read .config.json:', e)
    }
    return {}
  })

  ipcMain.handle('config:update', async (event, updates: Record<string, unknown>) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    const configPath = join(root, '.config.json')
    try {
      let current = {}
      if (existsSync(configPath)) {
        const raw = await readFile(configPath, 'utf-8')
        current = JSON.parse(raw)
      }
      const updated = { ...current, ...updates }
      await writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8')
      return updated
    } catch (e) {
      console.error('[Config] Failed to update .config.json:', e)
      return {}
    }
  })

  // Path Helpers
  ipcMain.handle('path:join', async (_, ...args: string[]) => join(...args))
  ipcMain.handle('path:resolve', async (_, ...args: string[]) => resolve(...args))
  ipcMain.handle('path:isAbsolute', async (_, p: string) => isAbsolute(p))
  ipcMain.handle('path:exists', async (_, p: string) => existsSync(p))

  ipcMain.on('app:open-external', (_, url: string) => {
    shell.openExternal(url).catch((err) => {
      console.error(`[Main] Failed to open external link: ${url}`, err)
    })
  })

  app.on('browser-window-created', (_, window) => {
    if (is.dev) {
      optimizer.watchWindowShortcuts(window, { zoom: false })
    }
  })

  // Set up Application Menu
  const isMac = process.platform === 'darwin'
  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { role: 'forceReload' }
  ]
  if (is.dev) {
    viewSubmenu.push({ role: 'toggleDevTools' })
  }
  viewSubmenu.push(
    { type: 'separator' },
    {
      label: 'Reset Zoom',
      accelerator: 'CommandOrControl+0',
      click: (_, focusedWindow): void => {
        focusedWindow?.webContents.send('editor:zoom', 'reset')
      }
    },
    {
      label: 'Zoom In',
      accelerator: 'CommandOrControl+Plus',
      click: (_, focusedWindow): void => {
        focusedWindow?.webContents.send('editor:zoom', 'in')
      }
    },
    {
      label: 'Zoom In (Secondary)',
      accelerator: 'CommandOrControl+=',
      visible: false,
      click: (_, focusedWindow): void => {
        focusedWindow?.webContents.send('editor:zoom', 'in')
      }
    },
    {
      label: 'Zoom Out',
      accelerator: 'CommandOrControl+-',
      click: (_, focusedWindow): void => {
        focusedWindow?.webContents.send('editor:zoom', 'out')
      }
    },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  )

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: viewSubmenu
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CommandOrControl+Shift+N',
          click: (): void => createWindow(true) // Pass true for new instance
        },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    viewMenu,
    { role: 'windowMenu' }
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  // Register terminal handlers
  registerTerminalHandlers()

  ipcMain.handle('notes:list', async (event) => {
    const v = getVaultManager(event.sender)
    return v ? v.getNotes() : []
  })
  ipcMain.handle('notes:load', async (event, id: string) => {
    const v = getVaultManager(event.sender)
    return v ? v.getNote(id) : null
  })
  ipcMain.handle('notes:exportAll', async (event) => {
    const v = getVaultManager(event.sender)
    return v ? v.exportAllNotes() : null
  })
  ipcMain.handle('notes:create', async (event, title?: string, path?: string) => {
    const v = await ensureVault(event.sender)
    return v.createNote(title || 'Untitled', path)
  })
  ipcMain.handle('notes:save', async (event, payload: NotePayload) => {
    const v = await ensureVault(event.sender)
    return v.saveNote(payload.id, payload.content, payload.title)
  })
  ipcMain.handle('notes:append', async (event, id: string, content: string) => {
    const v = await ensureVault(event.sender)
    return v.appendNote(id, content)
  })
  ipcMain.handle('notes:delete', async (event, id: string) => {
    const v = await ensureVault(event.sender)
    await v.deleteNote(id)
    return { id }
  })
  ipcMain.handle('notes:move', async (event, id: string, fromPath?: string, toPath?: string) => {
    const v = await ensureVault(event.sender)
    return v.moveNote(id, fromPath, toPath)
  })
  ipcMain.handle('notes:duplicate', async (event, id: string) => {
    const v = await ensureVault(event.sender)
    return v.duplicateNote(id)
  })
  ipcMain.handle('notes:rename', async (event, id: string, newId: string) => {
    const v = await ensureVault(event.sender)
    const newName = await v.renameNote(id, newId)
    const note = await v.getNote(newName)
    return note
  })
  ipcMain.handle('notes:import', async (event, filePath: string, folderPath?: string) => {
    const v = await ensureVault(event.sender)
    return v.importNote(filePath, folderPath)
  })
  ipcMain.handle('folder:create', async (event, name: string, parentPath?: string) => {
    const v = await ensureVault(event.sender)
    return v.createFolder(name, parentPath)
  })
  ipcMain.handle('folder:delete', async (event, path: string) => {
    const v = await ensureVault(event.sender)
    await v.deleteFolder(path)
    return { path }
  })
  ipcMain.handle('folder:rename', async (event, path: string, newName: string) => {
    const v = await ensureVault(event.sender)
    return v.renameFolder(path, newName)
  })
  ipcMain.handle('folder:move', async (event, sourcePath: string, targetPath: string) => {
    const v = await ensureVault(event.sender)
    return v.moveFolder(sourcePath, targetPath)
  })

  ipcMain.handle('vault:get', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { path: null, name: null }

    if (freshWindows.has(win.id) && !windowVaultPaths.has(win.id)) {
      return { path: null, name: null }
    }

    const v = await ensureVault(event.sender)
    const path = v.getRootPath()
    return { path, name: basename(path) }
  })

  ipcMain.handle('vault:get-path', async (event) => {
    const v = getVaultManager(event.sender)
    return v ? v.getRootPath() : resolveVaultPath()
  })

  ipcMain.handle('vault:reveal', async (event, targetPath?: string) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()

    console.log('[Reveal] Root:', root)
    console.log('[Reveal] Target Path:', targetPath)

    if (targetPath && root) {
      const fullPath = isAbsolute(targetPath) ? targetPath : resolve(root, targetPath)
      console.log('[Reveal] Resolved Full Path:', fullPath)
      if (existsSync(fullPath)) {
        shell.showItemInFolder(fullPath)
        return
      }
    }

    if (root && existsSync(root)) {
      await shell.openPath(root)
    }
  })

  ipcMain.handle('vault:choose', async (event) => {
    return await chooseVault(event.sender)
  })

  ipcMain.handle('vault:set', async (event, dir: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const oldManager = getVaultManager(event.sender)
    const newManager = await getOrCreateVaultManager(dir)

    if (win) {
      if (oldManager) oldManager.removeWindow(win)
      windowVaultPaths.set(win.id, dir)
      newManager.addWindow(win)
    }

    updateSettings({ vaultPath: dir })
    addRecentVault(dir)
    return { path: dir, name: basename(dir), changed: true }
  })

  // Vault validation and location handlers
  ipcMain.handle('vault:validate', async (_event, path: string) => {
    const exists = isValidVaultPath(path)
    const settings = loadSettings()
    const recentVault = settings.recentVaults?.find((p) => p === path)
    return {
      exists,
      lastOpened: recentVault ? Date.now() : undefined // Could track actual last opened time
    }
  })

  ipcMain.handle('vault:locate', async (_event, originalPath: string) => {
    if (!originalPath) {
      return { foundPath: null }
    }

    // If path exists, return it
    if (existsSync(originalPath)) {
      return { foundPath: originalPath }
    }

    // Phase 3: Smart Detection - Try to find vault by name in common locations
    const vaultName = basename(originalPath)
    if (!vaultName) {
      return { foundPath: null }
    }

    const commonLocations = [
      app.getPath('documents'),
      app.getPath('home'),
      join(app.getPath('home'), 'Documents'),
      join(app.getPath('home'), 'Desktop'),
      dirname(originalPath), // Check parent directory
      join(dirname(originalPath), '..') // Check grandparent
    ]

    // Also check recent vaults for similar structure
    const settings = loadSettings()
    const recentPaths = settings.recentVaults || []
    for (const recentPath of recentPaths) {
      if (recentPath !== originalPath && existsSync(recentPath)) {
        const recentName = basename(recentPath)
        if (recentName === vaultName) {
          // Found a recent vault with the same name
          try {
            const files = readdirSync(recentPath, { recursive: true, withFileTypes: true })
            const hasNotes = files.some(
              (f) => f.isFile() && (f.name.endsWith('.md') || f.name.endsWith('.txt'))
            )
            if (hasNotes) {
              return { foundPath: recentPath }
            }
          } catch {
            // Skip if can't read
          }
        }
      }
    }

    // Search common locations
    for (const basePath of commonLocations) {
      try {
        if (!existsSync(basePath)) continue

        const potentialPath = join(basePath, vaultName)
        if (existsSync(potentialPath)) {
          // Quick validation: check if it looks like a vault (has .md files)
          try {
            const files = readdirSync(potentialPath, { recursive: true, withFileTypes: true })
            const hasNotes = files.some(
              (f) => f.isFile() && (f.name.endsWith('.md') || f.name.endsWith('.txt'))
            )
            if (hasNotes) {
              return { foundPath: potentialPath }
            }
          } catch {
            // Skip if can't read directory
          }
        }

        // Also check subdirectories (one level deep)
        try {
          const entries = readdirSync(basePath, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name === vaultName) {
              const subPath = join(basePath, entry.name)
              try {
                const files = readdirSync(subPath, { recursive: true, withFileTypes: true })
                const hasNotes = files.some(
                  (f) => f.isFile() && (f.name.endsWith('.md') || f.name.endsWith('.txt'))
                )
                if (hasNotes) {
                  return { foundPath: subPath }
                }
              } catch {
                // Skip if can't read
              }
            }
          }
        } catch {
          // Skip if can't read base path
        }
      } catch {
        // Skip inaccessible paths
      }
    }

    return { foundPath: null }
  })

  ipcMain.handle(
    'notes:search',
    async (event, query: string, options?: Record<string, unknown>) => {
      const v = getVaultManager(event.sender)
      return v ? v.search(query, options) : []
    }
  )
  ipcMain.handle('notes:getBacklinks', async (event, id: string) => {
    const v = getVaultManager(event.sender)
    return v ? v.getBacklinks(id) : []
  })
  ipcMain.handle('graph:get', async (event) => {
    const v = getVaultManager(event.sender)
    return v
      ? {
          links: v.getAllLinks(),
          tags: v.getAllTags(),
          codeLinks: v.getAllCodeLinks()
        }
      : { links: [], tags: {}, codeLinks: [] }
  })

  ipcMain.handle('assets:save', async (event, buffer: ArrayBuffer, name: string) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    const assetsDir = join(root, 'assets')
    await mkdir(assetsDir, { recursive: true })
    const filePath = join(assetsDir, name)
    await writeFile(filePath, Buffer.from(buffer))
    return `assets/${name}`
  })

  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:update', async (_event, updates: Partial<Settings>) =>
    updateSettings(updates)
  )
  ipcMain.handle('settings:reset', async () => {
    cleanupTerminals()
    return resetSettings()
  })

  // Gist Sync Handlers
  ipcMain.handle(
    'sync:backup',
    async (_event, token: string, gistId: string | undefined, vaultData: unknown) => {
      try {
        const GIST_FILENAME = 'knowledge-hub-backup.json'
        const GIST_DESCRIPTION = 'Knowledge Hub Vault Backup'
        const GIST_API_URL = 'https://api.github.com/gists'

        const content = JSON.stringify(
          {
            version: 1,
            timestamp: Date.now(),
            vaultPath: getVaultManager(_event.sender)?.getRootPath(),
            notes: vaultData
          },
          null,
          2
        )

        const body: Record<string, unknown> = {
          description: GIST_DESCRIPTION,
          public: false,
          files: {
            [GIST_FILENAME]: {
              content
            }
          }
        }

        // Use Bearer for fine-grained tokens (ghp_) or token for classic tokens
        const authHeader = token.startsWith('ghp_') ? `Bearer ${token}` : `token ${token}`
        const headers: Record<string, string> = {
          Authorization: authHeader,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        }

        let response: Response
        if (gistId) {
          // Update existing gist
          response = await fetch(`${GIST_API_URL}/${gistId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(body)
          })
        } else {
          // Create new gist
          response = await fetch(GIST_API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          })
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Unknown error' }))
          return {
            success: false,
            message: error.message || `HTTP ${response.status}: ${response.statusText}`
          }
        }

        const result = await response.json()
        const newGistId = result.id

        // Save gistId to settings
        if (newGistId) {
          updateSettings({ gistId: newGistId })
        }

        return {
          success: true,
          message: gistId ? 'Backup updated successfully' : 'Backup created successfully',
          gistId: newGistId
        }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Backup failed'
        }
      }
    }
  )

  ipcMain.handle('sync:restore', async (_event, token: string, gistId: string) => {
    try {
      const GIST_API_URL = `https://api.github.com/gists/${gistId}`
      const GIST_FILENAME = 'knowledge-hub-backup.json'

      // Use Bearer for fine-grained tokens (ghp_) or token for classic tokens
      const authHeader = token.startsWith('ghp_') ? `Bearer ${token}` : `token ${token}`
      const response = await fetch(GIST_API_URL, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/vnd.github.v3+json'
        }
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }))
        return {
          success: false,
          message: error.message || `HTTP ${response.status}: ${response.statusText}`
        }
      }

      const gist = await response.json()
      const file = gist.files[GIST_FILENAME]

      if (!file) {
        return {
          success: false,
          message: 'Backup file not found in Gist'
        }
      }

      const backupData = JSON.parse(file.content)
      return {
        success: true,
        message: 'Backup restored successfully',
        data: backupData
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Restore failed'
      }
    }
  })

  ipcMain.handle('sync:testToken', async (_event, token: string) => {
    try {
      // Use Bearer for fine-grained tokens (ghp_) or token for classic tokens
      const authHeader = token.startsWith('ghp_') ? `Bearer ${token}` : `token ${token}`
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: authHeader,
          Accept: 'application/vnd.github.v3+json'
        }
      })

      if (response.ok) {
        const user = await response.json()
        return {
          valid: true,
          message: `Token valid for user: ${user.login || 'Unknown'}`
        }
      } else {
        return {
          valid: false,
          message: `Token validation failed: ${response.status} ${response.statusText}`
        }
      }
    } catch (error) {
      return {
        valid: false,
        message: error instanceof Error ? error.message : 'Token test failed'
      }
    }
  })

  ipcMain.handle('window:minimize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.minimize()
  })
  ipcMain.handle('window:maximize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.maximize()
  })
  ipcMain.handle('window:unmaximize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.unmaximize()
  })
  ipcMain.handle('window:isMaximized', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      return win.isMaximized()
    }
    return false
  })
  ipcMain.handle('window:close', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.close()
  })

  // Session Storage Backup/Restore for Updates
  ipcMain.handle('sessions:backup', async () => {
    const userDataPath = app.getPath('userData')
    const sessionsPath = join(userDataPath, 'sessions-backup.json')

    try {
      // Get sessions from renderer via webContents
      const result = await mainWindowRef?.webContents.executeJavaScript(`
        // Access sessionStorageService from renderer
        if (window.sessionStorageService) {
          return window.sessionStorageService.getAllSessions(true)
        }
        return null
      `)

      if (result) {
        await writeFile(
          sessionsPath,
          JSON.stringify(
            {
              version: Date.now(),
              sessions: result
            },
            null,
            2
          )
        )
        return { success: true, path: sessionsPath }
      }

      return { success: false, message: 'Could not access sessions' }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('sessions:restore', async () => {
    const userDataPath = app.getPath('userData')
    const sessionsPath = join(userDataPath, 'sessions-backup.json')

    try {
      if (existsSync(sessionsPath)) {
        const backupData = JSON.parse(await readFile(sessionsPath, 'utf-8'))
        return { success: true, data: backupData }
      }
      return { success: false, message: 'No backup found' }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  // Expose app icon path to renderer
  ipcMain.handle('app:getIcon', async () => {
    return icon
  })
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })
  console.log('[Main] Registering app:getDocumentation handler')

  ipcMain.handle('app:getDocumentation', async (_event, section?: string) => {
    // Determine the base documentation directory based on environment
    let docsDir = is.dev
      ? join(process.cwd(), 'resources/docs')
      : join(process.resourcesPath, 'docs')

    // Support legacy dev paths or alternate layouts
    if (is.dev && !existsSync(docsDir)) {
      docsDir = join(__dirname, '../../resources/docs')
    }

    // Production build variations (ASAR vs non-ASAR, or custom resource paths)
    if (!is.dev && !existsSync(docsDir)) {
      // Try nested resources folder (sometimes electron-builder preserves it)
      const alternatePath = join(process.resourcesPath, 'resources/docs')
      if (existsSync(alternatePath)) {
        docsDir = alternatePath
      }
    }

    if (!existsSync(docsDir)) {
      console.warn(
        `[Main] Documentation directory NOT found. Tried:\n 1. ${join(process.resourcesPath, 'docs')}\n 2. ${join(process.resourcesPath, 'resources/docs')}`
      )
      return section === 'list' ? [] : 'Documentation not available.'
    }

    // Return the list of available documentation modules
    if (section === 'list') {
      try {
        const files = await readdir(docsDir)
        return files.filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''))
      } catch (error) {
        console.error('[Main] Failed to list documentation:', error)
        return []
      }
    }

    // Fetch specific documentation content
    const targetFile = join(docsDir, `${section || 'introduction'}.md`)
    try {
      if (existsSync(targetFile)) {
        return await readFile(targetFile, 'utf-8')
      }
      return `Section "${section}" not found.`
    } catch (error) {
      console.error(`[Main] Error reading documentation: ${targetFile}`, error)
      return 'Error loading documentation content.'
    }
  })

  ipcMain.handle('git:status', async (event) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    return getGitStatus(root)
  })

  ipcMain.handle('git:info', async (event, forcedPath?: string) => {
    let root = forcedPath
    if (!root) {
      const v = getVaultManager(event.sender)
      root = v?.getRootPath() || resolveVaultPath()
    }
    // console.log('[Main] Getting Git info for:', root)
    return getGitInfo(root)
  })

  ipcMain.handle('git:init', async (event) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    return initGit(root)
  })

  ipcMain.handle('git:history', async (event, filePath: string) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    return getFileHistory(root, filePath)
  })

  ipcMain.handle('git:repo-history', async (event) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    return getRepoHistory(root)
  })

  ipcMain.handle('git:show-content', async (event, filePath: string, hash: string) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    return getFileContentAtCommit(root, filePath, hash)
  })

  ipcMain.handle('git:commit-details', async (event, hash: string) => {
    const v = getVaultManager(event.sender)
    const root = v?.getRootPath() || resolveVaultPath()
    return getCommitDetails(root, hash)
  })

  // ----------------------------------------------------------------------
  // Database IPC Handlers
  // ----------------------------------------------------------------------
  ipcMain.handle('database:connect', async (_event, dbConfig?: Record<string, unknown>) => {
    try {
      const settings = loadSettings()
      const cfg = dbConfig || settings.database || {}
      await closePool()
      createPool({
        host: cfg.host as string | undefined,
        port: cfg.port as number | undefined,
        database: cfg.database as string | undefined,
        user: cfg.user as string | undefined,
        password: cfg.password as string | undefined
      })
      await runMigrationsSafe()
      return { success: true, message: 'Connected to PostgreSQL' }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('database:disconnect', async () => {
    try {
      await closePool()
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('database:status', async () => {
    const connected = isConnected()
    let stats = { total_docs: 0, total_chunks: 0, by_type: {} }
    if (connected) {
      try {
        stats = await queries.getDocumentStats()
      } catch {
        // DB might not be migrated yet
      }
    }
    return { connected, ...stats }
  })

  ipcMain.handle('database:query', async (_event, sql: string, params?: unknown[]) => {
    try {
      const { query } = await import('./knm/database')
      const rows = await query(sql, params)
      return { success: true, rows }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ----------------------------------------------------------------------
  // Extractor IPC Handlers
  // ----------------------------------------------------------------------
  ipcMain.handle('extractor:start', async (_event, vaultPath?: string) => {
    try {
      const settings = loadSettings()
      const path = vaultPath || settings.vaultPath
      if (!path) return { success: false, message: 'No vault path configured' }
      await documentExtractor.watch(path)
      return { success: true, message: 'Extractor watcher started' }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:stop', async () => {
    try {
      await documentExtractor.stop()
      return { success: true }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:extract', async (_event, filePath: string) => {
    return documentExtractor.extractFile(filePath)
  })

  ipcMain.handle('extractor:reindex', async () => {
    try {
      const result = await documentExtractor.reindexAll()
      return { success: true, ...result }
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:startBatchIngestion', async (event, filePaths: string[]) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      return await documentExtractor.startBatchIngestion(filePaths, (percent, status) => {
        if (win) {
          win.webContents.send('extractor:progress', percent, status)
        }
      })
    } catch (err) {
      return { success: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:cancelBatchIngestion', async () => {
    documentExtractor.cancelBatchIngestion()
    return { success: true }
  })

  ipcMain.handle('extractor:getBatchStatus', async () => {
    return documentExtractor.getBatchStatus()
  })

  ipcMain.handle('extractor:status', async () => {
    const connected = isConnected()
    let stats = { total_docs: 0, total_chunks: 0, by_type: {} }
    if (connected) {
      try {
        stats = await queries.getDocumentStats()
      } catch {
        // not migrated yet
      }
    }
    return {
      watching: !!documentExtractor['watcher'],
      databaseConnected: connected,
      ...stats
    }
  })

  ipcMain.handle('extractor:search', async (_event, queryVector: number[], limit: number = 10) => {
    try {
      const embedding = new Float32Array(queryVector)
      const results = await queries.searchChunks(embedding, limit)
      return { success: true, results }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:hybridSearch', async (_event, keywordQuery: string, queryVector: number[], limit: number = 10) => {
    try {
      const embedding = new Float32Array(queryVector)
      const results = await queries.hybridSearchChunks(keywordQuery, embedding, limit)
      return { success: true, results }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:getUnembeddedChunks', async (_event, limit: number = 50) => {
    try {
      const chunks = await queries.getUnembeddedChunks(limit)
      return { success: true, chunks }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('extractor:updateChunkEmbedding', async (_event, chunkId: string, embeddingVector: number[]) => {
    try {
      const embedding = new Float32Array(embeddingVector)
      await queries.updateChunkEmbedding(chunkId, embedding)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('system:getUsername', () => {
    try {
      return userInfo().username
    } catch {
      return 'user'
    }
  })

  try {
    // Initialize default vault manager for main window
    const savedPath = resolveVaultPath()
    await getOrCreateVaultManager(savedPath)
  } catch (err) {
    console.error('Failed to initialize vault:', err)
  }

  // Auto-connect to PostgreSQL if configured
  const settings = loadSettings()
  if (settings.database?.autoConnect && settings.database?.host) {
    console.log('[Main] Auto-connecting to PostgreSQL...')
    createPool({
      host: settings.database.host,
      port: settings.database.port,
      database: settings.database.database,
      user: settings.database.user,
      password: settings.database.password
    })
    await runMigrationsSafe()

    // Auto-start extractor watcher if enabled
    if (settings.extractor?.enabled !== false) {
      const vaultPath = resolveVaultPath()
      await documentExtractor.watch(vaultPath)
    }
  }

  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url && url.startsWith('http')) {
      shell.openExternal(url)
    }
  })

  createWindow()

  if (mainWindowRef) {
    setupUpdateApp(mainWindowRef)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Cleanup terminals before quitting
  cleanupTerminals()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Ensure terminals are cleaned up
  cleanupTerminals()
  documentExtractor.stop().catch(() => {})
  closePool().catch(() => {})
})
