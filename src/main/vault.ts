import { join, basename, relative, dirname, normalize } from 'path'
import { readFile, writeFile, rm, rename, stat, readdir, mkdir, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { watch } from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
// import { version } from './package.json'
export type NoteMeta = {
  id: string
  title: string
  updatedAt: number
  createdAt?: number
  path?: string // relative path from vault root
  type?: 'note' | 'folder'
  children?: NoteMeta[]
  collapsed?: boolean
}

export type NotePayload = NoteMeta & {
  content: string
}

export type FileChange = {
  event: 'add' | 'change' | 'unlink'
  path: string
}

const TEXT_EXTENSIONS = [
  '.md',
  '.txt',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.c',
  '.cpp',
  '.cs',
  '.h',
  '.hpp',
  '.css',
  '.scss',
  '.html',
  '.json',
  '.yaml',
  '.yml',
  '.sh',
  '.bash',
  '.sql',
  '.rs',
  '.go',
  '.java',
  '.php',
  '.rb',
  '.xml',
  '.toml',
  '.ini',
  '.csv',
  '.tsv',
  '.log',
  '.lock',
  '.env',
  '.babelrc',
  '.eslintrc',
  '.prettierrc',
  '.stylelintrc',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.dockerignore',
  '.env.example',
  '.env.local',
  '.twig',
  '.blade.php',
  '.less',
  '.sass',
  '.mdx',
  'dockerfile',
  'makefile',
  '.ipynb',
  '.kt',
  '.kts',
  '.dart',
  '.swift',
  '.m',
  '.mm',
  '.gradle',
  '.gradle.kts'
]

const IGNORED_NAMES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  'vendor',
  '.idea',
  '.vscode',
  'storage',
  'bin',
  'obj'
]

export class VaultManager {
  private rootPath: string = ''
  private watcher: FSWatcher | null = null
  private windows = new Set<BrowserWindow>()

  // In-memory cache
  private notes = new Map<string, NoteMeta>()
  private folders = new Set<string>()
  private links = new Map<string, Set<string>>() // Source -> Targets
  private backlinks = new Map<string, Set<string>>() // Target -> Sources
  private tags = new Map<string, Set<string>>() // Source -> Tags
  private codeLinks = new Map<string, Set<string>>() // Source -> Code target names
  private folderMetasCache: NoteMeta[] = []
  private folderCacheValid: boolean = false

  public addWindow(window: BrowserWindow): void {
    this.windows.add(window)
    window.on('closed', () => {
      this.windows.delete(window)
    })
  }

  public removeWindow(window: BrowserWindow): void {
    this.windows.delete(window)
  }

  public getRootPath(): string {
    return this.rootPath
  }

  public async setVaultPath(path: string): Promise<void> {
    if (!path || !existsSync(path)) {
      throw new Error(`Invalid vault path: ${path}`)
    }
    this.rootPath = path
    this.notes.clear()
    this.folders.clear()
    this.links.clear()
    this.backlinks.clear()
    this.tags.clear()
    this.codeLinks.clear()
    this.folderCacheValid = false

    await this.startWatcher()
    await this.initialScan()
  }

  private async initialScan(): Promise<void> {
    // Phase 1: Rapid Metadata Scan (Names/Paths/Stats) - Non-blocking
    // This allows the UI to reveal almost instantly even on large vaults.
    await this.scanDirectory(this.rootPath, false)

    // Phase 2: Background Content Hydration (Titles/Links)
    // We don't await this so the renderer can move on.
    this.backgroundContentHydration().catch((err) =>
      console.error('[Vault] Background hydration failed:', err)
    )
  }

  private async backgroundContentHydration(): Promise<void> {
    const ids = Array.from(this.notes.keys())
    let processedCount = 0
    for (const id of ids) {
      const fullPath = join(this.rootPath, id)
      if (existsSync(fullPath)) {
        await this.indexFile(fullPath, true)
      }
      processedCount++
      // Yield every few files to keep the main process responsive
      if (processedCount % 20 === 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  }

  private async scanDirectory(dir: string, indexContent: boolean = true): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const entryName = entry.name.toLowerCase()

      // Skip hidden directories and bulky code folders (Shadow Folders)
      if (
        entry.isDirectory() &&
        (entry.name.startsWith('.') || IGNORED_NAMES.includes(entryName))
      ) {
        continue
      }

      if (entry.isDirectory()) {
        const relPath = relative(this.rootPath, fullPath)
        const normalizedPath = relPath.replace(/\\/g, '/')
        this.folders.add(normalizedPath)
        await this.scanDirectory(fullPath, indexContent)
      } else if (entry.isFile() && this.isSupportedFile(entry.name)) {
        await this.indexFile(fullPath, indexContent)
      }
    }
  }
  private isSupportedFile(filename: string): boolean {
    const lower = filename.toLowerCase()
    return TEXT_EXTENSIONS.some((ext) => {
      if (ext.startsWith('.')) return lower.endsWith(ext)
      return lower === ext // Exact match for things like 'makefile' or 'dockerfile'
    })
  }

  private async indexFile(fullPath: string, indexContent: boolean = true): Promise<void> {
    try {
      const stats = await stat(fullPath)
      const relPath = relative(this.rootPath, fullPath)
      const normalizedPath = relPath.replace(/\\/g, '/')
      const id = this.getIdFromPath(normalizedPath)

      // Only read content if requested (for titles/links/search)
      let content = ''
      if (indexContent) {
        content = await readFile(fullPath, 'utf-8')
      }

      // Extract directory path (without filename)
      const dirPath = dirname(normalizedPath)
      const relativeDir = dirPath === '.' ? '' : dirPath

      const existingMeta = this.notes.get(id)
      const birthtime = stats.birthtimeMs
      const mtime = stats.mtimeMs
      const existingCreatedAt = existingMeta?.createdAt

      let createdAt: number
      if (existingCreatedAt && existingCreatedAt > 0 && existingCreatedAt <= mtime + 1000) {
        createdAt = existingCreatedAt
      } else {
        const now = Date.now()
        // Use birthtime if valid and not in the future, otherwise mtime
        createdAt = birthtime > 0 && birthtime <= now ? birthtime : mtime
        // Final fallback to now if everything is 0
        if (createdAt === 0) createdAt = now
      }

      const extractedTitle = indexContent ? this.extractTitle(content, id) : basename(id)
      const meta: NoteMeta = {
        id,
        title: this.sanitizeFilename(extractedTitle) || basename(id) || 'Untitled',
        updatedAt: mtime,
        createdAt: createdAt,
        path: relativeDir,
        type: 'note'
      }

      this.notes.set(id, meta)
      if (indexContent) {
        this.updateLinks(id, content)
      }
    } catch (err) {
      console.error(`[Vault] Failed to index ${fullPath}`, err)
    }
  }

  private async startWatcher(): Promise<void> {
    if (this.watcher) await this.watcher.close()

    this.watcher = watch(this.rootPath, {
      ignored: (path: string) => {
        const parts = path.split(/[\\/]/)
        const name = parts[parts.length - 1].toLowerCase()
        // Ignore hidden folders and ignored code folders
        if (
          name.startsWith('.') &&
          !parts.some((p) => TEXT_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)))
        )
          return true
        if (IGNORED_NAMES.includes(name)) return true
        return false
      },
      persistent: true,
      ignoreInitial: true
    })

    this.watcher.on('add', (path) => void this.handleFileChange('add', path))
    this.watcher.on('change', (path) => void this.handleFileChange('change', path))
    this.watcher.on('unlink', (path) => void this.handleFileChange('unlink', path))
    this.watcher.on('addDir', (path) => void this.handleDirChange('add', path))
    this.watcher.on('unlinkDir', (path) => void this.handleDirChange('unlink', path))
  }

  private notifyWindows(data: unknown): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('vault:changed', data)
      }
    })
  }

  private async handleFileChange(
    event: 'add' | 'change' | 'unlink',
    fullPath: string
  ): Promise<void> {
    if (!this.isSupportedFile(fullPath)) return
    const relativePath = relative(this.rootPath, fullPath)
    const id = this.getIdFromPath(relativePath)

    if (event === 'unlink') {
      this.notes.delete(id)
      this.removeLinks(id)
    } else {
      await this.indexFile(fullPath)
    }

    this.notifyWindows({
      event,
      id,
      meta: this.notes.get(id)
    })
  }

  private async handleDirChange(event: 'add' | 'unlink', fullPath: string): Promise<void> {
    const relPath = relative(this.rootPath, fullPath)
    const normalizedPath = relPath.replace(/\\/g, '/')

    if (event === 'add') {
      this.folders.add(normalizedPath)
    } else {
      this.folders.delete(normalizedPath)
    }
    this.folderCacheValid = false
    this.notifyWindows({ event: 'refresh' })
  }

  // --- Helpers ---

  private getIdFromPath(relPath: string): string {
    // UNIFIED ID: The ID is now the full relative path including extension.
    // This allows unique selection and editing of any file in the workspace.
    return relPath.replace(/\\/g, '/')
  }

  private extractTitle(_content: string, id: string): string {
    // Title is ALWAYS the filename (basename of id)
    return basename(id)
  }

  private sanitizeFilename(name: string): string {
    // Windows forbidden chars: < > : " | ? * (Removed / and \ from here to allow path parsing)
    // Also remove control characters and trim trailing dots/spaces
    return (
      name
        .replace(/[<>:"|?*]/g, ' ') // Replace forbidden chars with space
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f]/g, '') // Remove control characters
        .trim()
        .replace(/[.\s]+$/, '') // Remove trailing dots and spaces
        .substring(0, 250)
    ) // Basic length limit for Windows
  }

  private updateLinks(sourceId: string, content: string): void {
    const links = new Set<string>()
    const regex = /\[\[(.*?)\]\]/g
    let match
    while ((match = regex.exec(content)) !== null) {
      const [target] = match[1].split('|')
      links.add(target.trim())
    }

    this.links.set(sourceId, links)
    this.updateTags(sourceId, content)
    this.updateCodeLinks(sourceId, content)
  }

  private updateTags(sourceId: string, content: string): void {
    const tags = new Set<string>()

    // Frontmatter tags: tags: [tag1, tag2] or tags: tag1, tag2
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1]
      const tagsMatch = frontmatter.match(/tags:\s*\[?(.*?)\]?\s*$/m)
      if (tagsMatch) {
        const tagStr = tagsMatch[1]
        tagStr
          .split(',')
          .map((t) => t.trim().replace(/['"]/g, ''))
          .filter(Boolean)
          .forEach((t) => tags.add(t))
      }
    }

    // Inline tags: #tag (not in code blocks)
    const inlineTagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g
    let match: RegExpExecArray | null
    while ((match = inlineTagRegex.exec(content)) !== null) {
      if (match[1]) tags.add(match[1])
    }

    this.tags.set(sourceId, tags)
  }

  private updateCodeLinks(sourceId: string, content: string): void {
    const codeLinks = new Set<string>()
    const addTarget = (target?: string): void => {
      if (target && target !== sourceId) {
        codeLinks.add(target)
      }
    }

    // 1. JS/TS/React: import ... from '...', require('...')
    const jsImportRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"])|(?:require\(['"]([^'"]+)['"]\))/g
    let match: RegExpExecArray | null
    while ((match = jsImportRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2]
      if (importPath) {
        const filename = importPath.split('/').pop()?.replace(/\.[^/.]+$/, '')
        addTarget(filename)
      }
    }

    // 2. PHP Includes
    const phpIncludeRegex = /(?:include|include_once|require|require_once)\s*(?:\(?\s*['"]([^'"]+)['"]\s*\)?)/g
    while ((match = phpIncludeRegex.exec(content)) !== null) {
      const includePath = match[1]
      if (includePath) {
        const filename = includePath.split('/').pop()?.replace(/\.[^/.]+$/, '')
        addTarget(filename)
      }
    }

    // 3. PHP Use Statements
    const phpUseRegex = /use\s+([a-zA-Z0-9_\\]+)(?:\s+as\s+[a-zA-Z0-9_]+)?;/g
    while ((match = phpUseRegex.exec(content)) !== null) {
      const fullNamespace = match[1]
      if (fullNamespace) {
        const className = fullNamespace.split('\\').pop()
        addTarget(className)
      }
    }

    // 4. Static Calls (e.g. User::all())
    const staticCallRegex = /([A-Z][a-zA-Z0-9_]*)::/g
    while ((match = staticCallRegex.exec(content)) !== null) {
      if (match[1]) addTarget(match[1])
    }

    // 5. Python Imports
    const pythonImportRegex = /(?:from\s+([a-zA-Z0-9_.]+)\s+import)|(?:import\s+([a-zA-Z0-9_.]+))/g
    while ((match = pythonImportRegex.exec(content)) !== null) {
      const moduleName = match[1] || match[2]
      if (moduleName) {
        const filename = moduleName.split('.').pop()
        addTarget(filename)
      }
    }

    // 6. C/C++ Includes
    const cIncludeRegex = /#include\s*["<]([^">]+)[">]/g
    while ((match = cIncludeRegex.exec(content)) !== null) {
      const includePath = match[1]
      if (includePath) {
        const filename = includePath.split('/').pop()?.replace(/\.[^/.]+$/, '')
        addTarget(filename)
      }
    }

    // 7. Ruby Requires
    const rubyRequireRegex = /(?:require|require_relative)\s*['"]([^'"]+)['"]/g
    while ((match = rubyRequireRegex.exec(content)) !== null) {
      const path = match[1]
      if (path) {
        const filename = path.split('/').pop()?.replace(/\.[^/.]+$/, '')
        addTarget(filename)
      }
    }

    // 8. Class Instantiation: new ClassName()
    const classRegex = /new\s+([A-Z][a-zA-Z0-9_]*)/g
    while ((match = classRegex.exec(content)) !== null) {
      if (match[1]) addTarget(match[1])
    }

    this.codeLinks.set(sourceId, codeLinks)
  }

  private removeLinks(sourceId: string): void {
    this.links.delete(sourceId)
    this.tags.delete(sourceId)
    this.codeLinks.delete(sourceId)
  }

  // --- Public API for Renderer ---

  public async getNotes(): Promise<NoteMeta[]> {
    const notes = Array.from(this.notes.values())

    if (this.folderCacheValid) {
      return [...notes, ...this.folderMetasCache]
    }

    const folderMetas: NoteMeta[] = []

    for (const path of this.folders) {
      const dir = dirname(path)
      const parentPath = dir === '.' ? '' : dir.replace(/\\/g, '/')
      const fullPath = join(this.rootPath, path)

      let createdAt = 0
      let updatedAt = 0

      try {
        const stats = await stat(fullPath)
        createdAt = stats.birthtimeMs || stats.mtimeMs
        updatedAt = stats.mtimeMs
      } catch {
        // Fallback if folder disappears or can't be stat'd
      }

      folderMetas.push({
        id: path,
        title: basename(path),
        updatedAt,
        createdAt,
        path: parentPath,
        type: 'folder'
      })
    }

    this.folderMetasCache = folderMetas
    this.folderCacheValid = true
    return [...notes, ...folderMetas]
  }

  public async getNote(id: string): Promise<NotePayload | null> {
    let meta = this.notes.get(id)

    // If not in cache, try to find it on disk directly (Direct Path Awareness)
    if (!meta) {
      const fullPath = join(this.rootPath, id)
      if (existsSync(fullPath) && this.isSupportedFile(fullPath)) {
        await this.indexFile(fullPath)
        meta = this.notes.get(id)
      }
    }

    if (!meta) return null

    // Ensure title is set (safety check)
    if (!meta.title) {
      meta.title = basename(id) || 'Untitled'
    }

    const fullPath = join(this.rootPath, id)

    try {
      let content = await readFile(fullPath, 'utf-8')

      // MIGRATION: Auto-strip old <!-- Title --> comments only for markdown
      if (id.toLowerCase().endsWith('.md') && content.startsWith('<!--')) {
        content = content.replace(/^<!--\s*(.+?)\s*-->\r?\n?/, '')
      }

      return {
        id,
        content,
        title: meta.title || basename(id) || 'Untitled',
        path: meta.path,
        updatedAt: meta.updatedAt,
        createdAt: meta.createdAt
      }
    } catch (e) {
      console.error(`[Vault] Failed to load file ${id} at ${fullPath}`, e)
      return null
    }
  }

  /**
   * Export all notes with their content for backup
   */
  public async exportAllNotes(): Promise<NotePayload[]> {
    const notes = Array.from(this.notes.values())
    const exported: NotePayload[] = []

    for (const meta of notes) {
      try {
        const note = await this.getNote(meta.id)
        if (note) {
          exported.push(note)
        }
      } catch (e) {
        console.error(`[Vault] Failed to export note ${meta.id}`, e)
      }
    }

    return exported
  }

  public async saveNote(id: string, content: string, _title?: string): Promise<NoteMeta> {
    void _title // Suppress unused parameter warning
    let meta = this.notes.get(id)
    if (!meta) {
      // Direct path access
      const fullPath = join(this.rootPath, id)
      if (existsSync(fullPath)) {
        await this.indexFile(fullPath)
        meta = this.notes.get(id)
      }
      if (!meta) {
        throw new Error(`File not found: ${id}`)
      }
    }

    const fullPath = join(this.rootPath, id)
    await writeFile(fullPath, content, 'utf-8')
    await this.indexFile(fullPath)

    return this.notes.get(id)!
  }

  public async appendNote(id: string, content: string): Promise<NoteMeta> {
    let meta = this.notes.get(id)
    if (!meta) {
      const fullPath = join(this.rootPath, id)
      if (existsSync(fullPath)) {
        await this.indexFile(fullPath)
        meta = this.notes.get(id)
      }
      if (!meta) throw new Error(`File not found: ${id}`)
    }

    const fullPath = join(this.rootPath, id)
    // Read current content and append
    const current = await readFile(fullPath, 'utf-8')
    await writeFile(fullPath, current + content, 'utf-8')
    await this.indexFile(fullPath)

    return this.notes.get(id)!
  }

  public async createNote(titleInput: string, folderPath = '.'): Promise<NoteMeta> {
    const rawPath = titleInput.trim() || 'Untitled'
    const normalizedPath = rawPath.replace(/\\/g, '/')

    // Split into segments to sanitize each part but keep the structure
    const segments = normalizedPath.split('/').map((s) => this.sanitizeFilename(s))
    let filename = segments.pop()!
    const subDir = segments.join('/')

    let targetDir = join(this.rootPath, folderPath)
    if (subDir) {
      targetDir = join(targetDir, subDir)
    }

    // Ensure target directory exists and all parents are indexed as folders
    await mkdir(targetDir, { recursive: true })
    const dirRelPath = relative(this.rootPath, targetDir).replace(/\\/g, '/')
    if (dirRelPath && dirRelPath !== '.') {
      const dirParts = dirRelPath.split('/')
      let currentDirPart = ''
      for (const part of dirParts) {
        currentDirPart = currentDirPart ? `${currentDirPart}/${part}` : part
        this.folders.add(currentDirPart)
      }
      this.folderCacheValid = false
    }

    // If filename doesn't have an extension, default to .md
    if (!filename.includes('.')) {
      filename = `${filename}.md`
    }

    const fullPath = join(targetDir, filename)
    const relPath = relative(this.rootPath, fullPath).replace(/\\/g, '/')

    // For IDE/Agent scaffolding: If it exists, don't suffix, just return existing
    if (existsSync(fullPath)) {
      await this.indexFile(fullPath)
      return this.notes.get(relPath)!
    }

    const content = '\n'
    await writeFile(fullPath, content, 'utf-8')
    await this.indexFile(fullPath)

    // Notify windows of the change to trigger a refresh
    this.notifyWindows({ event: 'refresh' })

    return this.notes.get(relPath)!
  }

  public async deleteNote(id: string): Promise<void> {
    const fullPath = join(this.rootPath, id)
    if (!existsSync(fullPath)) return

    // Stop watcher to prevent locks on Windows
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    try {
      await rm(fullPath, { recursive: true, force: true })
    } finally {
      await this.startWatcher()
    }

    this.notes.delete(id)
    this.removeLinks(id)
  }

  public async duplicateNote(id: string): Promise<NoteMeta> {
    const sourceFullPath = join(this.rootPath, id)
    if (!existsSync(sourceFullPath)) throw new Error('File not found')

    const dir = dirname(id)
    const filename = basename(id)
    const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
    const baseName = ext ? filename.slice(0, -ext.length) : filename

    let counter = 1
    let newFilename = `${baseName} copy${ext}`
    let newFullPath = join(this.rootPath, dir, newFilename)

    while (existsSync(newFullPath)) {
      newFilename = `${baseName} copy ${counter}${ext}`
      newFullPath = join(this.rootPath, dir, newFilename)
      counter++
    }

    await copyFile(sourceFullPath, newFullPath)
    const newId = join(dir, newFilename).replace(/\\/g, '/')
    await this.indexFile(newFullPath)

    const meta = this.notes.get(newId)
    if (!meta) throw new Error('Failed to index duplicated note')
    return meta
  }

  public async renameNote(id: string, newTitle: string): Promise<string> {
    const meta = this.notes.get(id)
    if (!meta) throw new Error('File not found')

    const currentPath = join(this.rootPath, id)
    const dir = dirname(id)

    // Ensure extension remains or is added
    const oldExt = id.split('.').pop()
    const safeTitle = this.sanitizeFilename(newTitle)
    let newFilename = safeTitle
    if (!newFilename.includes('.') && oldExt) {
      newFilename = `${safeTitle}.${oldExt}`
    }

    const newId = dir === '.' || dir === '' ? newFilename : `${dir}/${newFilename}`
    const newPath = join(this.rootPath, newId)

    if (existsSync(newPath)) throw new Error('File already exists')

    await rename(currentPath, newPath)

    this.notes.delete(id)
    await this.indexFile(newPath)
    return newId
  }

  public async moveNote(id: string, _fromPath?: string, toPath?: string): Promise<NoteMeta> {
    const sourceNorm = id.replace(/\\/g, '/')
    const targetDirNorm = (toPath || '').replace(/\\/g, '/')
    const sourceFullPath = join(this.rootPath, sourceNorm)
    const targetDirFullPath = join(this.rootPath, targetDirNorm)

    const filename = basename(sourceNorm)
    const safeFilename = this.sanitizeFilename(filename)
    let newFullPath = join(targetDirFullPath, safeFilename)

    if (sourceFullPath === newFullPath) {
      const existing = this.notes.get(id)
      if (!existing) throw new Error(`Note ${id} not found`)
      return existing
    }

    if (!existsSync(sourceFullPath)) {
      throw new Error(`Source file not found: ${id}`)
    }

    // Handle name collisions at destination
    const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
    const baseName = ext ? filename.slice(0, -ext.length) : filename
    let counter = 1
    while (existsSync(newFullPath)) {
      const suffixedName = `${baseName} ${counter}${ext}`
      newFullPath = join(targetDirFullPath, suffixedName)
      counter++
    }

    await mkdir(targetDirFullPath, { recursive: true })

    try {
      // Try rename first (fastest)
      await rename(sourceFullPath, newFullPath)
    } catch {
      // Fallback: cross-drive copy
      await copyFile(sourceFullPath, newFullPath)
      await rm(sourceFullPath)
    }

    // Update cache
    this.notes.delete(id)
    await this.indexFile(newFullPath)

    const newRelPath = relative(this.rootPath, newFullPath).replace(/\\/g, '/')
    const newId = this.getIdFromPath(newRelPath)
    const newMeta = this.notes.get(newId)

    if (!newMeta) {
      throw new Error(`Failed to index moved note: ${newId}`)
    }

    return newMeta
  }

  public async importNote(externalFilePath: string, folderPath?: string): Promise<NoteMeta> {
    const normalizedPath = normalize(externalFilePath)
    if (!existsSync(normalizedPath)) throw new Error(`File not found: ${normalizedPath}`)

    const content = await readFile(normalizedPath, 'utf-8')
    const fileName = basename(externalFilePath)
    const nameWithoutExt = fileName.replace(/\.[^.]+$/, '')
    let idBase = nameWithoutExt
    const targetDir = folderPath ? join(this.rootPath, folderPath) : this.rootPath

    let targetPath = join(targetDir, `${idBase}.md`)
    let counter = 1
    while (existsSync(targetPath)) {
      idBase = `${nameWithoutExt} ${counter}`
      targetPath = join(targetDir, `${idBase}.md`)
      counter++
    }

    await mkdir(targetDir, { recursive: true })
    await writeFile(targetPath, content, 'utf-8')
    await this.indexFile(targetPath)

    const newRelPath = relative(this.rootPath, targetPath).replace(/\\/g, '/')
    const newId = this.getIdFromPath(newRelPath)
    return this.notes.get(newId)!
  }

  public async createFolder(
    nameInput: string,
    parentPath = '.'
  ): Promise<{ name: string; path: string }> {
    const normalizedPath = nameInput.replace(/\\/g, '/')
    const segments = normalizedPath.split('/').map((s) => this.sanitizeFilename(s))
    const name = segments.join('/')

    const targetDir = join(this.rootPath, parentPath)
    const safeName = name
    const folderPath = join(targetDir, safeName)

    // For IDE/Agent: If folder exists, just return it
    if (existsSync(folderPath)) {
      const relPath = relative(this.rootPath, folderPath).replace(/\\/g, '/')
      this.folders.add(relPath)
      return { name: basename(folderPath), path: relPath }
    }

    await mkdir(folderPath, { recursive: true })

    const relPath = relative(this.rootPath, folderPath).replace(/\\/g, '/')

    // Add all intermediate folders to cache
    const parts = relPath.split('/')
    let currentPart = ''
    for (const part of parts) {
      if (!part) continue
      currentPart = currentPart ? `${currentPart}/${part}` : part
      this.folders.add(currentPart)
    }

    this.folderCacheValid = false
    return { name: safeName, path: relPath }
  }

  public async deleteFolder(relativePath: string): Promise<{ success: boolean }> {
    const fullPath = join(this.rootPath, relativePath)
    console.log(`[Vault] deleteFolder request: "${relativePath}" -> "${fullPath}"`)

    if (!existsSync(fullPath)) {
      console.warn(`[Vault] Folder does not exist: ${fullPath}`)
      return { success: false }
    }

    // Stop watcher to prevent locks on Windows
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    try {
      await rm(fullPath, { recursive: true, force: true })
      console.log(`[Vault] Successfully deleted: ${fullPath}`)
    } catch (err) {
      console.error(`[Vault] Failed to delete folder: ${fullPath}`, err)
      await this.startWatcher()
      return { success: false }
    } finally {
      await this.startWatcher()
    }

    const normalizedPath = relativePath.replace(/\\/g, '/')
    this.folders.delete(normalizedPath)
    this.folderCacheValid = false

    // Cleanup all notes inside this folder from cache
    const prefix = normalizedPath === '' ? '' : normalizedPath + '/'
    for (const [id] of this.notes.entries()) {
      if (id.startsWith(prefix) || id === normalizedPath) {
        this.notes.delete(id)
      }
    }

    // Notify windows that the vault has changed
    this.notifyWindows({ event: 'refresh' })

    return { success: true }
  }

  public async renameFolder(path: string, newName: string): Promise<{ path: string }> {
    const normalizedPath = path.replace(/\\/g, '/')
    const sourceDir = join(this.rootPath, normalizedPath)
    const parent = dirname(normalizedPath)
    const parentDir = parent === '.' || parent === '' ? '' : parent
    const newRelPath = parentDir === '' ? newName : `${parentDir}/${newName}`
    const targetDir = join(this.rootPath, newRelPath)

    if (existsSync(targetDir)) throw new Error('Folder already exists')

    // Temporarily stop watcher to prevent EPERM locks on Windows
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    try {
      await rename(sourceDir, targetDir)
    } finally {
      // Always restart watcher
      await this.startWatcher()
    }

    const finalRelPath = newRelPath.replace(/\\/g, '/')

    // Update cache
    this.folders.delete(normalizedPath)
    this.folders.add(finalRelPath)
    this.folderCacheValid = false

    // Update all notes inside from cache
    for (const [id, meta] of this.notes.entries()) {
      if (meta.path?.startsWith(normalizedPath)) {
        // Care with substring logic - ensure boundary
        const prefix = normalizedPath === '' ? '' : normalizedPath + '/'
        if (id.startsWith(prefix) || meta.path === normalizedPath) {
          // Wait, if meta.path starts with it.
          // Re-calculate new ID properly
          const suffix = id.substring(normalizedPath.length)
          // suffix starts with / usually
          const newId = join(finalRelPath, suffix).replace(/\\/g, '/')
          const newPath = dirname(newId) === '.' ? '' : dirname(newId)

          this.notes.delete(id)
          this.notes.set(newId, {
            ...meta,
            id: newId,
            path: newPath
          })
        }
      }
    }

    // Recursive folder cache update for subfolders
    for (const folder of Array.from(this.folders)) {
      if (folder !== finalRelPath && folder.startsWith(normalizedPath + '/')) {
        this.folders.delete(folder)
        const suffix = folder.substring(normalizedPath.length)
        this.folders.add(finalRelPath + suffix)
      }
    }

    return { path: finalRelPath }
  }

  public async moveFolder(sourcePath: string, targetPath: string): Promise<{ path: string }> {
    const sourceNorm = sourcePath.replace(/\\/g, '/')
    const targetNorm = targetPath.replace(/\\/g, '/')

    const sourceFullPath = join(this.rootPath, sourceNorm)
    const targetFullPath = join(this.rootPath, targetNorm)
    const folderName = basename(sourceNorm)

    if (targetNorm.startsWith(sourceNorm + '/') || targetNorm === sourceNorm) {
      throw new Error('Cannot move a folder into itself or its descendants')
    }

    let newFolderPath = join(targetFullPath, folderName)
    let safeFolderName = folderName
    let counter = 1

    while (existsSync(newFolderPath)) {
      safeFolderName = `${folderName} ${counter}`
      newFolderPath = join(targetFullPath, safeFolderName)
      counter++
    }

    // Ensure target directory exists
    await mkdir(targetFullPath, { recursive: true })

    try {
      // Try rename first (fastest for simple moves)
      await rename(sourceFullPath, newFolderPath)
    } catch {
      // Fallback: copy the entire folder recursively, then delete source
      try {
        await this.copyFolderRecursive(sourceFullPath, newFolderPath)
        await rm(sourceFullPath, { recursive: true, force: true })
      } catch (copyError) {
        throw new Error(`Failed to move folder: ${(copyError as Error).message}`)
      }
    }

    const finalPath = join(targetNorm, safeFolderName).replace(/\\/g, '/')

    // Update cache
    this.folders.delete(sourceNorm)
    this.folders.add(finalPath)

    // Update subfolders and notes
    // (Actually simpler to just trigger a rescan or update prefix)
    for (const folder of Array.from(this.folders)) {
      if (folder.startsWith(sourceNorm + '/')) {
        this.folders.delete(folder)
        this.folders.add(folder.replace(sourceNorm, finalPath))
      }
    }

    for (const [id, meta] of this.notes.entries()) {
      if (id.startsWith(sourceNorm + '/')) {
        const newId = id.replace(sourceNorm, finalPath)
        this.notes.delete(id)
        this.notes.set(newId, {
          ...meta,
          id: newId,
          path: dirname(newId) === '.' ? '' : dirname(newId)
        })
      }
    }

    return { path: finalPath }
  }

  public async search(
    query: string,
    options: { matchCase?: boolean; useRegex?: boolean; wholeWord?: boolean } = {}
  ): Promise<(NoteMeta & { content: string })[]> {
    const matches: (NoteMeta & { content: string })[] = []
    let regex: RegExp

    try {
      if (options.useRegex) {
        regex = new RegExp(query, options.matchCase ? 'g' : 'gi')
      } else {
        let escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (options.wholeWord) {
          escaped = `\\b${escaped}\\b`
        }
        regex = new RegExp(escaped, options.matchCase ? 'g' : 'gi')
      }
    } catch {
      // Invalid regex
      return []
    }

    for (const [id, meta] of this.notes.entries()) {
      try {
        const fullPath = join(this.rootPath, id)
        const content = await readFile(fullPath, 'utf-8')

        const matchesTitle = regex.test(meta.title)
        regex.lastIndex = 0 // Reset for next test
        const matchesContent = regex.test(content)
        regex.lastIndex = 0

        if (matchesTitle || matchesContent) {
          matches.push({
            ...meta,
            content
          })
        }
      } catch {
        // ignore read error
      }
    }
    return matches
  }

  public getBacklinks(targetId: string): string[] {
    const sources: string[] = []
    for (const [sourceId, targets] of this.links.entries()) {
      if (targets.has(targetId)) {
        sources.push(sourceId)
      }
    }
    return sources
  }

  private async copyFolderRecursive(source: string, destination: string): Promise<void> {
    // Ensure destination directory exists
    await mkdir(destination, { recursive: true })

    const entries = await readdir(source, { withFileTypes: true })

    for (const entry of entries) {
      const sourcePath = join(source, entry.name)
      const destPath = join(destination, entry.name)

      if (entry.isDirectory()) {
        await this.copyFolderRecursive(sourcePath, destPath)
      } else if (entry.isFile()) {
        await copyFile(sourcePath, destPath)
      }
      // Skip other types (symlinks, etc.) for safety
    }
  }

  public getAllLinks(): { source: string; target: string }[] {
    const links: { source: string; target: string }[] = []
    for (const [source, targets] of this.links.entries()) {
      for (const target of targets) {
        links.push({ source, target })
      }
    }
    return links
  }

  public getAllTags(): Record<string, string[]> {
    const tags: Record<string, string[]> = {}
    for (const [source, tagSet] of this.tags.entries()) {
      tags[source] = Array.from(tagSet)
    }
    return tags
  }

  public getAllCodeLinks(): { source: string; target: string }[] {
    const links: { source: string; target: string }[] = []
    for (const [source, targets] of this.codeLinks.entries()) {
      for (const target of targets) {
        links.push({ source, target })
      }
    }
    return links
  }
}
