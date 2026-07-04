import { state } from '../../core/state'
import type { NoteMeta } from '../../core/types'

export interface WikiLinkServiceCallbacks {
  openNote: (id: string, path?: string) => Promise<void>
  createNote: (title?: string, path?: string) => Promise<void>
  getEditorValue?: () => string | null
  setStatus?: (message: string) => void
}

export class WikiLinkService {
  private callbacks: WikiLinkServiceCallbacks

  constructor(callbacks: WikiLinkServiceCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Resolves a wiki link target to a NoteMeta object
   */
  resolveNote(target: string): NoteMeta | undefined {
    const cleanTarget = target.trim().toLowerCase()
    const targetNoExt = cleanTarget.endsWith('.md') ? cleanTarget.slice(0, -3) : cleanTarget

    const getBasename = (p: string): string => {
      const parts = p.split(/[/\\]/)
      return parts[parts.length - 1]
    }

    return state.notes.find((n) => {
      const idLow = n.id.toLowerCase()
      const idNoExt = idLow.endsWith('.md') ? idLow.slice(0, -3) : idLow
      const baseLow = getBasename(idLow)
      const baseNoExt = baseLow.endsWith('.md') ? baseLow.slice(0, -3) : baseLow
      const titleLow = (n.title || '').toLowerCase()
      const fullPathLow = (n.path ? `${n.path}/${n.id}` : n.id).toLowerCase()
      const fullPathNoExt = fullPathLow.endsWith('.md') ? fullPathLow.slice(0, -3) : fullPathLow

      return (
        idLow === cleanTarget ||
        idLow === targetNoExt ||
        idNoExt === cleanTarget ||
        idNoExt === targetNoExt ||
        baseLow === cleanTarget ||
        baseLow === targetNoExt ||
        baseNoExt === cleanTarget ||
        baseNoExt === targetNoExt ||
        titleLow === cleanTarget ||
        titleLow === targetNoExt ||
        fullPathLow === cleanTarget ||
        fullPathLow === targetNoExt ||
        fullPathNoExt === cleanTarget ||
        fullPathNoExt === targetNoExt
      )
    })
  }

  /**
   * Generates a preview text for a wiki link target
   */
  async getNotePreview(target: string): Promise<string | null> {
    const cleanTarget = target.trim().toLowerCase()
    const note = this.resolveNote(cleanTarget)

    if (note) {
      // Optimization: If the target note is the one currently open in the editor,
      // return the live content instead of reading stale data from disk.
      if (note.id === state.activeId && this.callbacks.getEditorValue) {
        const content = this.callbacks.getEditorValue()
        if (content) {
          // Sanitize content for preview
          const clean = this.sanitizeContent(content)
          const snippet = clean.substring(0, 1000).trim()
          return snippet + (content.length > 1000 ? '...' : '') || '(Empty unsaved note)'
        }
      }

      try {
        const loaded = await window.api.loadNote(note.id, note.path)
        if (loaded && loaded.content && loaded.content.trim()) {
          const clean = this.sanitizeContent(loaded.content)
          const snippet = clean.substring(0, 1000).trim()
          return snippet + (loaded.content.length > 1000 ? '...' : '')
        }
        return '(Note is empty)'
      } catch (err) {
        console.error(`[WikiLinkService] loadNote failed for preview:`, err)
        return '(Failed to load note)'
      }
    }
    return null
  }

  /**
   * Opens a wiki link (opens existing note or creates new one)
   */
  async openWikiLink(target: string): Promise<void> {
    const cleanTarget = target.trim()
    const [linkTarget] = cleanTarget.split('|')
    const note = this.resolveNote(linkTarget.trim())

    if (note) {
      await this.callbacks.openNote(note.id, note.path)
      if (this.callbacks.setStatus) {
        this.callbacks.setStatus(`Jumped to [[${target}]]`)
      }
    } else {
      // Auto-create note on click if it doesn't exist (Wiki behavior)
      try {
        await this.callbacks.createNote(linkTarget.trim())
        if (this.callbacks.setStatus) {
          this.callbacks.setStatus(`Created new note: [[${linkTarget}]]`)
        }
      } catch (e) {
        console.error('Failed to create note from link', e)
        if (this.callbacks.setStatus) {
          this.callbacks.setStatus(`Failed to create note: ${linkTarget}`)
        }
      }
    }
  }

  /**
   * Sanitizes markdown content for preview display
   */
  private sanitizeContent(content: string): string {
    return content
      .replace(/^---\n[\s\S]*?\n---\n/, '') // Frontmatter
      .replace(/<!--[\s\S]*?-->/g, '') // Comments
      .replace(/#+\s/g, '') // Headers
      .replace(/\[\[([^\]|]+)\|?.*?\]\]/g, '$1') // WikiLinks
      .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // Markdown Links
      .replace(/(\*\*|__)(.*?)\1/g, '$2') // Bold
      .replace(/(\*|_)(.*?)\1/g, '$2') // Italic
      .replace(/`{3}[\s\S]*?`{3}/g, '[Code]') // Code blocks
      .replace(/`/g, '') // Inline code
  }
}
