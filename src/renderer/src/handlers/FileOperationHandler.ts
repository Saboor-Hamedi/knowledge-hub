import { state } from '../core/state'
import type { NotePayload } from '../core/types'
import { noteService } from '../services/noteService'
import { modalManager } from '../components/modal/modal'
import { securityService } from '../services/security/securityService'
import { ragService } from '../services/rag/ragService'
import { tabService } from '../services/tabService'
import { gitService } from '../services/git/gitService'

export class FileOperationHandler {
  constructor(
    private components: {
      sidebar: { startRename: (id: string) => void; renderTree: (filter?: string) => void }
      tabBar: { render: () => void }
      statusBar: { setStatus: (msg: string) => void; setMeta: (msg: string) => void }
      editor: { showEmpty: () => void }
      breadcrumbs: { render: () => void }
    },
    private callbacks: {
      refreshNotes: () => Promise<void>
      openNote: (id: string, path?: string, focus?: 'editor' | 'sidebar' | 'none') => Promise<void>
      saveExpandedFolders: () => Promise<void>
      persistWorkspace: () => Promise<void>
      updateViewVisibility: () => void
    }
  ) {}

  public async openNote(
    id: string,
    path?: string,
    focus?: 'editor' | 'sidebar' | 'none'
  ): Promise<void> {
    return this.callbacks.openNote(id, path, focus)
  }

  public async createNote(
    title?: string,
    content?: string,
    path?: string,
    suppressRename: boolean = false
  ): Promise<void> {
    const meta = await window.api.createNote(title || '', path)
    state.newlyCreatedIds.add(meta.id)

    if (path) {
      state.expandedFolders.add(path)
    }

    // Save content if provided
    if (content) {
      await window.api.saveNote({ id: meta.id, content, title: meta.title } as any)
    }

    await this.callbacks.refreshNotes()
    this.components.statusBar.setStatus(`Created note "${meta.title}"`)
    void this.callbacks.persistWorkspace()

    await this.callbacks.openNote(meta.id, meta.path, 'editor')

    if (!content && !suppressRename) {
      setTimeout(() => {
        this.components.sidebar.startRename(meta.id)
      }, 100)
    }
  }

  public async duplicateItem(id: string, type: 'note' | 'folder'): Promise<void> {
    if (type === 'folder') {
      this.components.statusBar.setStatus('Folder duplication is not supported yet')
      return
    }

    try {
      this.components.statusBar.setStatus(`Duplicating note...`)
      const meta = await window.api.duplicateNote(id)

      await this.callbacks.refreshNotes()
      this.components.statusBar.setStatus(`Duplicated note to "${meta.title}"`)
      void this.callbacks.persistWorkspace()

      await this.callbacks.openNote(meta.id, meta.path, 'editor')

      // Optionally start rename
      setTimeout(() => {
        this.components.sidebar.startRename(meta.id)
      }, 100)
    } catch (error) {
      this.components.statusBar.setStatus(`Duplicate failed: ${(error as Error).message}`)
    }
  }

  public async createFolder(name: string = 'New Folder', parentPath?: string): Promise<void> {
    try {
      const result = await window.api.createFolder(name, parentPath)
      state.newlyCreatedIds.add(result.path)

      if (parentPath) {
        state.expandedFolders.add(parentPath)
      }

      await this.callbacks.refreshNotes()
      this.components.statusBar.setStatus(`Created folder "${result.name}"`)

      if (name === 'New Folder') {
        setTimeout(() => {
          this.components.sidebar.startRename(result.path)
        }, 100)
      }
    } catch (error) {
      this.components.statusBar.setStatus(`Failed: ${(error as Error).message}`)
    }
  }

  public async deleteItems(
    items: { id: string; type: 'note' | 'folder'; path?: string }[]
  ): Promise<void> {
    const verified = await securityService.verifyAction()
    if (!verified) return

    this.showDeleteConfirmationModal(items, async () => {
      this.components.statusBar.setStatus(`Deleting ${items.length} items...`)

      try {
        const result = await noteService.deleteItems(items)

        if (result.success) {
          this.components.statusBar.setStatus(`${items.length} items deleted`)

          // Close tabs immediately for the deleted items
          const idsToClose = items.filter((i) => i.type === 'note').map((i) => i.id)

          // Also find notes that were inside deleted folders
          const deletedFolderPaths = items
            .filter((i) => i.type === 'folder')
            .map((i) => (i.id.endsWith('/') ? i.id : i.id + '/'))

          state.openTabs.forEach((tab) => {
            if (deletedFolderPaths.some((folderPath) => tab.id.startsWith(folderPath))) {
              if (!idsToClose.includes(tab.id)) idsToClose.push(tab.id)
            }
          })

          if (idsToClose.length > 0) {
            tabService.closeTabs(idsToClose)
          }

          window.dispatchEvent(new CustomEvent('vault-changed'))

          tabService.syncTabs()
          this.components.breadcrumbs.render()

          if (!state.activeId || !state.openTabs.some((t) => t.id === state.activeId)) {
            const nextTab = tabService.findNextTabToOpen()
            if (nextTab) {
              await this.callbacks.openNote(nextTab.id, nextTab.path)
            } else {
              state.activeId = ''
              this.components.editor.showEmpty()
              this.callbacks.updateViewVisibility()
            }
          }

          for (const item of items) {
            if (item.type === 'note') {
              await ragService.deleteNote(item.id)
            }
          }
        } else {
          this.components.statusBar.setStatus('Some items could not be deleted')
        }

        await this.callbacks.refreshNotes()
      } catch {
        this.components.statusBar.setStatus('Some items could not be deleted')
        await this.callbacks.refreshNotes()
      }
    })
  }

  private showDeleteConfirmationModal(
    items: { id: string; type: 'note' | 'folder'; path?: string }[],
    onConfirm: () => Promise<void>
  ): void {
    if (items.length === 0) return
    const count = items.length
    const label = count === 1 ? (items[0].type === 'note' ? 'note' : 'folder') : 'items'

    modalManager.open({
      title: `Delete ${count > 1 ? count + ' ' : ''}${label}`,
      content: `Are you sure you want to delete ${count === 1 ? 'this ' + label : 'these ' + count + ' items'}? This action cannot be undone.`,
      size: 'md',
      buttons: [
        {
          label: 'Delete',
          variant: 'danger',
          onClick: async (m) => {
            m.close()
            await onConfirm()
          }
        },
        { label: 'Cancel', variant: 'ghost', onClick: (m) => m.close() }
      ]
    })
  }

  public async saveNote(payload: NotePayload): Promise<void> {
    if (!state.activeId) return
    this.components.statusBar.setStatus('Saving...')
    const meta = await window.api.saveNote(payload)

    if (meta) {
      state.newlyCreatedIds.delete(payload.id)
      state.lastSavedAt = meta.updatedAt
      state.isDirty = false

      const idx = state.notes.findIndex((n) => n.id === meta.id)
      if (idx >= 0) state.notes[idx] = { ...meta }
      else state.notes.unshift(meta)

      tabService.syncTabs()
      this.components.sidebar.renderTree()
      this.components.tabBar.render()
      this.components.breadcrumbs.render()
      this.components.statusBar.setStatus('Autosaved')

      // Refresh git status for the timeline and status bar
      gitService.refreshStatus()

      ragService
        .indexNote(payload.id, payload.content, {
          title: meta.title,
          path: meta.path,
          updatedAt: meta.updatedAt
        })
        .catch(console.error)
    } else {
      this.components.statusBar.setStatus('Save failed')
    }
  }

  public async renameNote(
    noteId: string,
    newTitle: string,
    onCoreDone?: () => void
  ): Promise<void> {
    const isActive = state.activeId === noteId
    let existing =
      state.notes.find((n) => n.id === noteId) ||
      (state.openTabs.find((t) => t.id === noteId) as any)

    if (!existing) {
      await this.callbacks.refreshNotes()
      existing = state.notes.find((n) => n.id === noteId)
    }

    const newId = newTitle.trim().replace(/[<>:"/\\|?*]/g, '-')
    if (noteId === newId) return

    try {
      const newMeta = await noteService.renameNote(noteId, newId, existing?.path)
      const actualNewId = newMeta.id

      // Update newly created IDs state if applicable
      if (state.newlyCreatedIds.has(noteId)) {
        state.newlyCreatedIds.delete(noteId)
        state.newlyCreatedIds.add(actualNewId)
      }

      onCoreDone?.()

      if (isActive) tabService.setActiveTab(actualNewId)
      await this.callbacks.refreshNotes()

      if (isActive) {
        state.isDirty = false
        await this.callbacks.openNote(actualNewId, newMeta.path)
      } else {
        this.components.tabBar.render()
      }
      this.components.breadcrumbs.render()

      this.components.statusBar.setStatus(`Renamed to "${newTitle}"`)
      void this.callbacks.persistWorkspace()

      const note = await window.api.loadNote(actualNewId, newMeta.path)
      if (note) {
        await ragService.indexNote(actualNewId, note.content, {
          title: newMeta.title,
          path: newMeta.path,
          updatedAt: note.updatedAt || newMeta.updatedAt
        })
      }
    } catch (err) {
      throw err
    }
  }

  public async renameFolder(id: string, newName: string, onCoreDone?: () => void): Promise<void> {
    const result = await window.api.renameFolder(id, newName)
    const actualNewPath = result.path
    onCoreDone?.()

    if (state.expandedFolders.has(id)) {
      state.expandedFolders.delete(id)
      state.expandedFolders.add(actualNewPath)
    }

    state.openTabs = state.openTabs.map((tab) => {
      if (tab.path === id || tab.path?.startsWith(id + '/')) {
        const newTabPath = tab.path.replace(id, actualNewPath)
        const newId = tab.id.startsWith(id) ? tab.id.replace(id, actualNewPath) : tab.id
        if (state.activeId === tab.id) state.activeId = newId
        if (state.pinnedTabs.has(tab.id)) {
          state.pinnedTabs.delete(tab.id)
          state.pinnedTabs.add(newId)
        }
        return { ...tab, id: newId, path: newTabPath }
      }
      return tab
    })

    this.components.statusBar.setStatus(`Renamed folder to ${newName}`)
    await this.callbacks.saveExpandedFolders()
    await this.callbacks.refreshNotes()
  }

  public async handleNoteMove(id: string, fromPath?: string, toPath?: string): Promise<void> {
    try {
      const newMeta = await noteService.moveNote(id, fromPath, toPath)

      this.components.tabBar.render()
      await this.callbacks.refreshNotes()

      // Re-index in RAG with new ID
      const note = await window.api.loadNote(newMeta.id, newMeta.path)
      if (note) {
        await ragService.indexNote(newMeta.id, note.content, {
          title: newMeta.title,
          path: newMeta.path,
          updatedAt: note.updatedAt || newMeta.updatedAt
        })
      }
    } catch (error) {
      console.error('[FileOps] Move note failed:', error)
      this.components.statusBar.setStatus('Move failed')
    }
  }

  public async handleFolderMove(sourcePath: string, targetPath: string): Promise<void> {
    try {
      await noteService.moveFolder(sourcePath, targetPath)
      this.components.tabBar.render()
      await this.callbacks.refreshNotes()
    } catch {
      this.components.statusBar.setStatus('Move failed')
    }
  }
}
