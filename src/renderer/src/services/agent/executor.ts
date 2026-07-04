import { state } from '../../core/state'
import { ragService } from '../rag/ragService'
import { tabService } from '../tabService'
import type { NoteMeta, NotePayload, TreeItem } from '../../core/types'

/**
 * Agent Executor
 *
 * Responsible for translating agent actions into real file operations.
 * Handles path resolution, error handling, and RAG re-indexing.
 */
export class AgentExecutor {
  private transactionQueue: (() => Promise<unknown>)[] = []
  private isTransactionActive = false
  private pendingProposals: Map<string, string> = new Map()

  /**
   * TRANSACTION: Start a new atomic operation series
   */
  startTransaction(): void {
    this.transactionQueue = []
    this.pendingProposals.clear()
    this.isTransactionActive = true
  }

  /**
   * TRANSACTION: Commit all queued operations
   */
  async commitTransaction(): Promise<unknown[]> {
    if (!this.isTransactionActive) return []
    const results: unknown[] = []
    try {
      for (const op of this.transactionQueue) {
        results.push(await op())
      }

      // After successful execution of all operations, dispatch batched proposals
      this.pendingProposals.forEach((content, id) => {
        window.dispatchEvent(
          new CustomEvent('knowledge-hub:propose-note', {
            detail: { id, content, isBatched: true }
          })
        )
      })

      return results
    } finally {
      this.transactionQueue = []
      this.pendingProposals.clear()
      this.isTransactionActive = false
    }
  }

  private dispatchProposal(id: string, content: string): void {
    if (this.isTransactionActive) {
      this.pendingProposals.set(id, content)
    } else {
      window.dispatchEvent(
        new CustomEvent('knowledge-hub:propose-note', {
          detail: { id, content }
        })
      )
    }
  }

  private queueOrExecute<T>(op: () => Promise<T>): Promise<T | string> {
    if (this.isTransactionActive) {
      this.transactionQueue.push(op)
      return Promise.resolve('Queued for transaction commit.')
    }
    return op()
  }

  private dispatchVaultChange(): void {
    window.dispatchEvent(new CustomEvent('vault-changed'))
  }

  private refreshActiveNoteIfNeeded(id: string, path?: string): void {
    if (state.activeId === id) {
      window.dispatchEvent(
        new CustomEvent('knowledge-hub:open-note', {
          detail: { id, path, focus: 'none' }
        })
      )
    }
  }

  /**
   * EXECUTE: Read Note
   */
  async readNote(query: string): Promise<{ title: string; path: string; content: string }> {
    const note = this.resolveNote(query)
    if (!note) throw new Error(`Note not found: ${query}`)

    const data = await window.api.loadNote(note.id, note.path)

    window.dispatchEvent(
      new CustomEvent('knowledge-hub:open-note', {
        detail: { id: note.id, path: note.path, focus: 'none' }
      })
    )

    return {
      title: note.title,
      path: note.path || '',
      content: data?.content || ''
    }
  }

  /**
   * Resolve a fuzzy title or path to a specific NoteMeta
   */
  public resolveNote(query: string): (NoteMeta & { type: 'note' | 'folder' }) | undefined {
    if (!query) return undefined
    const cleanQuery = query
      .toLowerCase()
      .trim()
      .replace(/^vault\//, '')

    const byId = state.notes.find((n) => n.id === query)
    if (byId) return { ...byId, type: 'note' }

    const exact = state.notes.find(
      (n) => n.title.toLowerCase() === cleanQuery || n.path?.toLowerCase() === cleanQuery
    )
    if (exact) return { ...exact, type: 'note' }

    // Folder match
    const notesWithFolders = state.notes.filter((n) => n.path)
    for (const n of notesWithFolders) {
      const parts = n.path!.split('/')
      for (let i = 0; i < parts.length; i++) {
        const folderPath = parts.slice(0, i + 1).join('/')
        if (folderPath.toLowerCase() === cleanQuery) {
          return {
            id: `folder-${folderPath}`,
            title: parts[i],
            path: folderPath,
            type: 'folder',
            updatedAt: n.updatedAt
          } as any
        }
      }
    }

    const fuzzy = state.notes.find(
      (n) =>
        n.title.toLowerCase().includes(cleanQuery) || cleanQuery.includes(n.title.toLowerCase())
    )
    if (fuzzy) return { ...fuzzy, type: 'note' }

    return undefined as any
  }

  public resolveFolder(query: string): string | undefined {
    if (!query || query === '/' || query.toLowerCase() === 'root') return ''
    const cleanQuery = query
      .toLowerCase()
      .trim()
      .replace(/^vault\//, '')

    const existing = state.notes.find((n) => n.path?.toLowerCase().includes(cleanQuery))
    if (existing) {
      const parts = existing.path!.split('/')
      const idx = parts.findIndex((p) => p.toLowerCase() === cleanQuery.split('/').pop())
      if (idx !== -1) return parts.slice(0, idx + 1).join('/')
    }

    return cleanQuery
  }

  /**
   * EXECUTE: Write Note
   */
  async writeNote(title: string, content: string, parentPath?: string): Promise<NoteMeta | string> {
    return this.queueOrExecute(async () => {
      const existing = this.resolveNote(title)
      let resolvedParentPath = parentPath
      if (!resolvedParentPath && existing?.path) {
        resolvedParentPath = existing.path.substring(0, existing.path.lastIndexOf('/'))
      }

      const meta = existing
        ? await window.api.saveNote({ ...existing, content } as NotePayload)
        : await window.api.createNote(title, resolvedParentPath)

      const result = await window.api.saveNote({
        id: meta.id,
        content,
        title: meta.title,
        path: meta.path
      } as NotePayload)

      void ragService.indexNote(meta.id, content, {
        title: meta.title,
        path: meta.path,
        updatedAt: meta.updatedAt
      })
      this.dispatchVaultChange()
      this.refreshActiveNoteIfNeeded(meta.id, meta.path)

      window.dispatchEvent(
        new CustomEvent('knowledge-hub:open-note', {
          detail: { id: meta.id, path: meta.path }
        })
      )

      return result
    })
  }

  /**
   * EXECUTE: Propose changes to a Note (Diff mode)
   */
  async proposeNote(title: string, content: string): Promise<NoteMeta> {
    const note = this.resolveNote(title)
    if (!note) throw new Error(`Note not found: ${title}`)

    this.dispatchProposal(note.id, content)
    return note
  }

  /**
   * EXECUTE: Append to Note
   */
  async appendNote(title: string, content: string): Promise<NoteMeta | string> {
    return this.queueOrExecute(async () => {
      const note = this.resolveNote(title)
      if (!note) throw new Error(`Note not found: ${title}`)

      const data = await window.api.loadNote(note.id, note.path)
      const existingContent = data?.content || ''
      const newContent = existingContent + (existingContent.endsWith('\n') ? '' : '\n') + content

      if (state.activeId === note.id) {
        this.dispatchProposal(note.id, newContent)
        return note as NoteMeta
      }

      const result = await window.api.saveNote({
        id: note.id,
        content: newContent,
        title: note.title,
        path: note.path
      } as NotePayload)

      void ragService.indexNote(note.id, newContent, {
        title: note.title,
        path: note.path,
        updatedAt: note.updatedAt
      })
      this.refreshActiveNoteIfNeeded(note.id, note.path)
      return result
    })
  }

  /**
   * EXECUTE: Semantic Patch (Line-specific)
   */
  async patchLine(
    idOrPath: string,
    lineIndex: number,
    newContent: string
  ): Promise<NoteMeta | string> {
    return this.queueOrExecute(async () => {
      const note = this.resolveNote(idOrPath)
      if (!note) throw new Error(`Note not found: ${idOrPath}`)

      const data = await window.api.loadNote(note.id, note.path)
      const content = data?.content || ''
      const lines = content.split(/\r?\n/)

      // 1-indexed from AI
      const idx = lineIndex - 1
      if (idx < 0 || idx >= lines.length) {
        throw new Error(`Line index ${lineIndex} out of range (Total lines: ${lines.length})`)
      }

      lines[idx] = newContent
      const updatedContent = lines.join('\n')

      if (state.activeId === note.id) {
        this.dispatchProposal(note.id, updatedContent)
        return note as NoteMeta
      }

      const result = await window.api.saveNote({
        id: note.id,
        content: updatedContent,
        title: note.title,
        path: note.path
      } as NotePayload)

      void ragService.indexNote(note.id, updatedContent, {
        title: note.title,
        path: note.path,
        updatedAt: note.updatedAt
      })
      this.refreshActiveNoteIfNeeded(note.id, note.path)
      return result
    })
  }

  /**
   * EXECUTE: Patch Note (Robust Context-Aware Search and Replace)
   */
  async patchNote(
    title: string,
    search: string,
    replace: string,
    contextBefore?: string,
    contextAfter?: string
  ): Promise<NoteMeta | string> {
    return this.queueOrExecute(async () => {
      const note = this.resolveNote(title)
      if (!note) throw new Error(`Note not found: ${title}`)

      const data = await window.api.loadNote(note.id, note.path)
      const originalContent = (data?.content || '').replace(/\r\n/g, '\n')

      const searchNormalized = search.replace(/\r\n/g, '\n')
      const replaceNormalized = replace.replace(/\r\n/g, '\n')
      const ctxBeforeNorm = contextBefore?.replace(/\r\n/g, '\n') || ''
      const ctxAfterNorm = contextAfter?.replace(/\r\n/g, '\n') || ''

      const finalizeMatch = async (newContent: string) => {
        if (state.activeId === note.id) {
          this.dispatchProposal(note.id, newContent)
          return note as NoteMeta
        }

        const result = await window.api.saveNote({
          id: note.id,
          content: newContent,
          title: note.title,
          path: note.path
        } as NotePayload)

        void ragService.indexNote(note.id, newContent, {
          title: note.title,
          path: note.path,
          updatedAt: note.updatedAt
        })
        this.refreshActiveNoteIfNeeded(note.id, note.path)
        return result
      }

      if (ctxBeforeNorm || ctxAfterNorm) {
        const fullBlock = (ctxBeforeNorm + searchNormalized + ctxAfterNorm).trim()
        if (originalContent.includes(fullBlock)) {
          const replacementBlock = ctxBeforeNorm + replaceNormalized + ctxAfterNorm
          const newContent = originalContent.replace(fullBlock, replacementBlock)
          return finalizeMatch(newContent)
        }
      }

      if (originalContent.includes(searchNormalized)) {
        const newContent = originalContent.replace(searchNormalized, replaceNormalized)
        return finalizeMatch(newContent)
      }

      const contentLines = originalContent.split('\n')
      const searchLines = searchNormalized.split('\n')

      const findMatch = (lines: string[], target: string[]): number => {
        for (let i = 0; i <= lines.length - target.length; i++) {
          let isMatch = true
          for (let j = 0; j < target.length; j++) {
            const l1 = lines[i + j].trim()
            const l2 = target[j].trim()
            if (!l1 && !l2) continue
            if (l1 !== l2) {
              isMatch = false
              break
            }
          }
          if (isMatch) return i
        }
        return -1
      }

      const matchIdx = findMatch(contentLines, searchLines)
      if (matchIdx !== -1) {
        contentLines.splice(matchIdx, searchLines.length, replaceNormalized)
        return finalizeMatch(contentLines.join('\n'))
      }

      throw new Error(`Patch failed: Precision block not found in "${title}".`)
    })
  }

  /**
   * EXECUTE: Append Chunk (Internal for streaming)
   */
  async appendChunk(id: string, chunk: string): Promise<void> {
    await window.api.appendNote(id, chunk)
  }

  /**
   * EXECUTE: Create Folder
   */
  async createFolder(
    name: string,
    parentPath?: string
  ): Promise<{ name: string; path: string } | string> {
    return this.queueOrExecute(async () => {
      const result = await window.api.createFolder(name, parentPath)
      this.dispatchVaultChange()
      return result
    })
  }

  /**
   * EXECUTE: Rename
   */
  async rename(
    oldId: string,
    newName: string
  ): Promise<NoteMeta | { name: string; path: string } | string> {
    return this.queueOrExecute(async () => {
      const item = this.resolveNote(oldId)
      if (item) {
        let result
        if (item.type === 'folder') {
          result = await window.api.renameFolder(item.path!, newName)
        } else {
          result = await window.api.renameNote(item.id, newName, item.path)
        }
        this.dispatchVaultChange()
        return result
      }
      throw new Error(`Item not found for renaming: ${oldId}`)
    })
  }

  /**
   * EXECUTE: Move
   */
  async move(
    id: string,
    targetFolderPath: string
  ): Promise<NoteMeta | { success?: boolean; path?: string } | string> {
    return this.queueOrExecute(async () => {
      const item = this.resolveNote(id)
      if (!item) throw new Error(`Item not found for moving: ${id}`)

      const targetPath = this.resolveFolder(targetFolderPath)
      if (!targetPath) throw new Error(`Target folder not found: ${targetFolderPath}`)

      if (item.type === 'folder') {
        const res = await window.api.moveFolder(item.path!, targetPath)
        this.dispatchVaultChange()
        return res
      } else {
        const res = await window.api.moveNote(item.id, item.path, targetPath)
        this.dispatchVaultChange()
        return res
      }
    })
  }

  /**
   * EXECUTE: Delete
   */
  async delete(id: string): Promise<{ success: boolean } | string> {
    return this.queueOrExecute(async () => {
      const item = this.resolveNote(id)
      if (!item) return { success: true }

      let res
      if (item.type === 'folder') {
        res = await window.api.deleteFolder(item.id)
        const folderPathPrefix = item.id.endsWith('/') ? item.id : item.id + '/'
        const idsToClose = state.openTabs
          .filter(
            (tab) => tab.path?.startsWith(folderPathPrefix) || tab.id.startsWith(folderPathPrefix)
          )
          .map((tab) => tab.id)
        if (idsToClose.length > 0) {
          tabService.closeTabs(idsToClose)
        }
      } else {
        res = await window.api.deleteNote(item.id, item.path || '')
        tabService.closeTab(item.id)
        void ragService.deleteNote(item.id)
      }
      this.dispatchVaultChange()
      return res
    })
  }

  /**
   * EXECUTE: Terminal/Shell
   */
  async executeTerminal(command: string): Promise<string> {
    try {
      const vault = await window.api.getVault()
      const result = (await window.api.invoke('terminal:run-command', command, vault.path)) as {
        success: boolean
        output: string
        error: string
      }
      if (result.success) {
        return result.output || 'Command executed successfully.'
      } else {
        return `Error: ${result.error}\nOutput: ${result.output}`
      }
    } catch (err) {
      throw new Error(`Terminal execution failed: ${(err as Error).message}`)
    }
  }

  /**
   * UTILS: Tree formatting for AI context
   */
  formatTree(items: TreeItem[], prefix = '', limit = 100): string {
    let result = ''
    let count = 0
    const render = (children: TreeItem[], currentPrefix: string) => {
      for (const item of children) {
        if (count >= limit) break
        count++
        const isLast = children.indexOf(item) === children.length - 1
        const line = `${currentPrefix}${isLast ? '└── ' : '├── '}${item.title}${item.type === 'folder' ? '/' : ''}`
        result += line + '\n'
        if (item.type === 'folder' && item.children) {
          render(item.children, currentPrefix + (isLast ? '    ' : '│   '))
        }
      }
    }
    render(items, prefix)
    return result
  }
}

export const agentExecutor = new AgentExecutor()
