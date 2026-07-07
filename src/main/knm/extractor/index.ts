import { watch } from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { isSupportedFile } from './registry'
import { processFile, removeFile } from './processor'

/**
 * Document Extractor — watches a vault directory and automatically
 * extracts text from supported files into PostgreSQL + pgvector.
 *
 * Lifecycle:
 *   extractor.watch(vaultPath)  → start Chokidar watcher
 *   extractor.stop()             → stop watcher
 *   extractor.extractFile(path)  → manual one-shot extraction
 *   extractor.reindexAll()       → re-extract entire vault
 */
export class DocumentExtractor {
  private watcher: FSWatcher | null = null
  private vaultRoot: string = ''
  private isPaused: boolean = false

  // Batch Ingestion Queue
  private batchQueue: string[] = []
  private isProcessingBatch: boolean = false
  private cancelBatch: boolean = false
  private totalBatchSize: number = 0

  // Debounce map: filePath → timer ID
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Start watching a vault directory.
   */
  async watch(vaultRoot: string, emitStatus?: (msg: string) => void): Promise<void> {
    await this.stop()
    this.vaultRoot = vaultRoot

    const notify = emitStatus || ((msg: string) => console.log(`[Extractor] ${msg}`))

    notify(`Watching ${vaultRoot} for document changes...`)

    this.watcher = watch(vaultRoot, {
      ignored: (path: string) => {
        // Skip hidden files and node_modules etc., but pass supported files
        const parts = path.split(/[\\/]/)
        const name = parts[parts.length - 1]

        if (name.startsWith('.') && !name.endsWith('.env')) return true

        const ignoredDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache']
        if (parts.some((p) => ignoredDirs.includes(p))) return true

        // Only watch supported document types
        return !isSupportedFile(path)
      },
      persistent: true,
      ignoreInitial: false // process existing files on start
    })

    this.watcher.on('add', (path) => this.debounceProcess(path, vaultRoot, notify))
    this.watcher.on('change', (path) => this.debounceProcess(path, vaultRoot, notify))
    this.watcher.on('unlink', (path) => {
      // Unlink has no debounce — remove immediately
      removeFile(vaultRoot, path).catch((err) => console.error('[Extractor] Error on unlink:', err))
    })
  }

  /**
   * Debounce add/change events so rapid saves don't trigger cascading re-indexes.
   */
  private debounceProcess(
    filePath: string,
    vaultRoot: string,
    notify: (msg: string) => void
  ): void {
    const existing = this.debounceTimers.get(filePath)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath)
      if (this.isPaused) return
      processFile(vaultRoot, filePath)
        .then((result) => {
          if (result) {
            notify(`Extracted ${filePath} (${result.chunkCount} chunks)`)
          }
        })
        .catch((err) => console.error(`[Extractor] Error processing ${filePath}:`, err))
    }, 1500) // 1.5s debounce

    this.debounceTimers.set(filePath, timer)
  }

  /**
   * Process a single file on demand.
   */
  async extractFile(
    filePath: string
  ): Promise<{ success: boolean; chunkCount?: number; error?: string }> {
    if (!this.vaultRoot) {
      return { success: false, error: 'No vault root set. Call watch() first.' }
    }
    try {
      const result = await processFile(this.vaultRoot, filePath)
      if (result) {
        return { success: true, chunkCount: result.chunkCount }
      }
      return { success: false, error: 'Unsupported file type or extraction failed' }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  /**
   * Re-index all supported files in the vault.
   */
  async reindexAll(notify?: (msg: string) => void): Promise<{ processed: number; failed: number }> {
    const { readdirSync } = await import('fs')
    const { join } = await import('path')

    const results = { processed: 0, failed: 0 }
    const files: string[] = []

    // Walk directory tree collecting supported files
    const walkDir = (dir: string): void => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.name.startsWith('.') && entry.name !== '.env') continue
        if (entry.isDirectory()) {
          const ignoredDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache']
          if (ignoredDirs.includes(entry.name)) continue
          walkDir(fullPath)
        } else if (entry.isFile() && isSupportedFile(fullPath)) {
          files.push(fullPath)
        }
      }
    }

    const log = notify || console.log
    log(`[Extractor] Re-indexing ${this.vaultRoot}...`)
    walkDir(this.vaultRoot)
    log(`[Extractor] Found ${files.length} files to process`)

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      try {
        const result = await processFile(this.vaultRoot, filePath)
        if (result) {
          results.processed++
        } else {
          results.failed++
        }
      } catch {
        results.failed++
      }

      if ((i + 1) % 10 === 0) {
        log(`[Extractor] Progress: ${i + 1}/${files.length}`)
      }
    }

    log(`[Extractor] Re-index complete: ${results.processed} processed, ${results.failed} failed`)
    return results
  }

  // Batch Ingestion State exposed for UI restoration
  private processedCount: number = 0
  private currentStatusText: string = ''

  /**
   * Get the current status of the batch ingestion.
   */
  getBatchStatus(): { isProcessing: boolean; percent: number; status: string; queue: string[] } {
    let percent = 0
    if (this.totalBatchSize > 0) {
      percent = Math.round((this.processedCount / this.totalBatchSize) * 100)
    }
    return {
      isProcessing: this.isProcessingBatch,
      percent,
      status: this.currentStatusText,
      queue: [...this.batchQueue]
    }
  }

  /**
   * Start a batch ingestion of multiple files, reporting progress back to renderer.
   */
  async startBatchIngestion(filePaths: string[], notifyProgress: (percent: number, status: string) => void): Promise<{ success: boolean; message?: string }> {
    if (!this.vaultRoot) {
      const { loadSettings } = await import('../../settings')
      const settings = loadSettings()
      if (settings.vaultPath) {
        this.vaultRoot = settings.vaultPath
      } else {
        return { success: false, message: 'No vault root set. Please open a vault first.' }
      }
    }
    
    // Add to queue
    this.batchQueue.push(...filePaths)
    this.totalBatchSize += filePaths.length
    
    if (this.isProcessingBatch) {
      return { success: true, message: 'Added to existing batch queue' }
    }
    
    this.isProcessingBatch = true
    this.cancelBatch = false
    this.processedCount = 0
    
    const { mkdir, copyFile } = await import('fs/promises')
    const { join, basename } = await import('path')
    
    const importsDir = join(this.vaultRoot, '.knowledgehub', 'imports')
    try {
      await mkdir(importsDir, { recursive: true })
    } catch {
      // Ignore if exists
    }

    // Process queue
    const failedFiles: string[] = []
    let totalChunks = 0
    const startTime = Date.now()
    
    while (this.batchQueue.length > 0 && !this.cancelBatch) {
      const originalFilePath = this.batchQueue.shift()!
      const fileName = basename(originalFilePath)
      const targetFilePath = join(importsDir, fileName)

      this.currentStatusText = `Extracting ${fileName}...`
      notifyProgress(Math.round((this.processedCount / this.totalBatchSize) * 100), this.currentStatusText)
      
      try {
        const result = await processFile(this.vaultRoot, originalFilePath)
        if (!result) {
          failedFiles.push(fileName)
        } else {
          totalChunks += result.chunkCount
        }
      } catch (err) {
        console.error(`[Extractor] Batch error on ${originalFilePath}:`, err)
        failedFiles.push(fileName)
      }
      this.processedCount++
    }
    
    const wasCancelled = this.cancelBatch
    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1)
    
    // Reset state
    const processed = this.totalBatchSize
    this.isProcessingBatch = false
    this.cancelBatch = false
    this.processedCount = 0
    this.totalBatchSize = 0
    this.batchQueue = []
    this.currentStatusText = ''
    
    if (failedFiles.length > 0) {
      notifyProgress(100, `Failed: ${failedFiles.length} file(s)`)
      return { success: false, message: `Failed to process: ${failedFiles.join(', ')}. Check database connection or file format.` }
    }
    
    if (wasCancelled) {
      notifyProgress(0, 'Batch ingestion cancelled.')
      return { success: false, message: 'Batch ingestion cancelled' }
    } else {
      const msg = `Processed ${processed} files, extracted ${totalChunks} chunks in ${durationSeconds}s`
      notifyProgress(100, msg)
      return { success: true, message: msg, stats: { files: processed, chunks: totalChunks, time: durationSeconds } }
    }
  }

  /**
   * Cancel an ongoing batch ingestion.
   */
  cancelBatchIngestion(): void {
    if (this.isProcessingBatch) {
      this.cancelBatch = true
    }
  }

  /**
   * Pause/unpause file watching (e.g. during vault switch).
   */
  setPaused(paused: boolean): void {
    this.isPaused = paused
  }

  /**
   * Stop the file watcher and clear debounce timers.
   */
  async stop(): Promise<void> {
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}

// Singleton
export const documentExtractor = new DocumentExtractor()
