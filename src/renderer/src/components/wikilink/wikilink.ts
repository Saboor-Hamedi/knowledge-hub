import { state } from '../../core/state'

export class WikiLinkPreviewModal {
  private el: HTMLElement
  private titleEl: HTMLElement
  private bodyEl: HTMLElement
  private openBtn: HTMLElement
  private visible = false
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private currentTarget: string | null = null
  private onOpenNote?: (target: string) => void

  public setOpenNoteHandler(handler: (target: string) => void): void {
    this.onOpenNote = handler
  }

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'wikilink-preview-modal'
    this.el.innerHTML = `
      <div class="wikilink-preview-header">
        <span class="wikilink-preview-title"></span>
        <div class="wikilink-preview-actions">
          <span class="wikilink-preview-hint">Ctrl+Click</span>
          <button class="wikilink-preview-open-btn" title="Open Note">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
        </div>
      </div>
      <div class="wikilink-preview-body"></div>
    `
    document.body.appendChild(this.el)

    this.titleEl = this.el.querySelector('.wikilink-preview-title') as HTMLElement
    this.openBtn = this.el.querySelector('.wikilink-preview-open-btn') as HTMLElement
    this.bodyEl = this.el.querySelector('.wikilink-preview-body') as HTMLElement

    this.el.addEventListener('mouseenter', () => this.cancelHide())
    this.el.addEventListener('mouseleave', () => this.hide(100))
    this.openBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.currentTarget && this.onOpenNote) {
        this.hide(0)
        this.onOpenNote(this.currentTarget)
      }
    })

    document.addEventListener('mousemove', (e) => {
      if (!this.visible) return
      const target = e.target as HTMLElement
      if (
        !target.closest('.wikilink-preview-modal') &&
        !target.closest('.wiki-link') &&
        !target.closest('.monaco-editor') &&
        !target.closest('.monaco-scrollable-element')
      ) {
        this.hide(150)
      }
    })

    document.addEventListener('keydown', (e) => {
      if (this.visible && (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        this.hide(0)
      }
    })
  }

  private cancelHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  public async show(
    target: string,
    rect: DOMRect,
    getNotePreview: (id: string) => Promise<string | null>
  ): Promise<void> {
    this.cancelHide()
    this.currentTarget = target

    this.titleEl.textContent = `📄 ${target}`
    this.openBtn.title = `Open Note (${target})`
    this.bodyEl.innerHTML = '<div class="wikilink-preview-loading">Loading preview...</div>'
    this.el.style.display = 'flex'
    this.position(rect)
    this.el.classList.add('is-visible')
    this.visible = true

    const preview = await getNotePreview(target)
    if (this.currentTarget !== target) return

    const note = state.notes.find(
      (n) =>
        n.id.toLowerCase() === target.toLowerCase() ||
        (n.title && n.title.toLowerCase() === target.toLowerCase()) ||
        (n.path && `${n.path}/${n.id}`.toLowerCase() === target.toLowerCase())
    )
    const noteTitle = note ? note.title || note.id : target
    const previewText = preview || (note ? 'Note is empty' : 'Note not found')

    const formattedPreview = previewText
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^#+\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[\[(.*?)\]\]/g, '$1')
      .trim()

    this.titleEl.textContent = `📄 ${noteTitle}`
    this.bodyEl.innerHTML = `<div class="wikilink-preview-content">${formattedPreview}</div>`
    this.position(rect)
  }

  public position(rect: DOMRect): void {
    this.el.style.display = 'flex'
    const modalRect = this.el.getBoundingClientRect()
    const targetCenterX = rect.left + rect.width / 2
    let left = Math.max(16, Math.min(window.innerWidth - modalRect.width - 16, targetCenterX - modalRect.width / 2))

    if (rect.bottom + 8 + modalRect.height > window.innerHeight - 16 && rect.top > window.innerHeight - rect.bottom) {
      this.el.style.top = `${Math.max(16, rect.top - modalRect.height - 8)}px`
    } else {
      this.el.style.top = `${rect.bottom + 8}px`
    }
    this.el.style.left = `${left}px`
  }

  public hide(delay = 150): void {
    if (this.hideTimer) return
    this.hideTimer = setTimeout(() => {
      this.el.classList.remove('is-visible')
      this.el.style.display = 'none'
      this.visible = false
      this.hideTimer = null
      this.currentTarget = null
    }, delay)
  }
}

export const wikiLinkPreviewModal = new WikiLinkPreviewModal()

export function registerWikiLinkProviders(
  monaco: any,
  getNotePreview: (id: string) => Promise<string | null>,
  onOpenNote?: (target: string) => void
): { dispose: () => void }[] {
  if (onOpenNote) {
    wikiLinkPreviewModal.setOpenNoteHandler(onOpenNote)
  }
  const disposables: { dispose: () => void }[] = []

  // Attach mouse move & scroll listeners to active editor for clean hover dismissal
  try {
    const editor = monaco.editor.getEditors()[0]
    if (editor && !(editor as any)._wikiLinkHoverAttached) {
      ;(editor as any)._wikiLinkHoverAttached = true
      disposables.push(
        editor.onMouseMove((e: any) => {
          if (!e.target || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) {
            wikiLinkPreviewModal.hide(150)
          } else if (e.target.range) {
            const model = editor.getModel()
            if (model) {
              const line = model.getLineContent(e.target.range.startLineNumber)
              if (!line || !line.includes('[[')) {
                wikiLinkPreviewModal.hide(150)
              } else {
                const regex = /\[\[(.*?)\]\]/g
                let m: RegExpExecArray | null
                let inWikiLink = false
                const col = e.target.range.startColumn
                while ((m = regex.exec(line)) !== null) {
                  if (col >= m.index + 1 && col <= m.index + m[0].length + 1) {
                    inWikiLink = true
                    break
                  }
                }
                if (!inWikiLink) {
                  wikiLinkPreviewModal.hide(150)
                }
              }
            }
          }
        })
      )
      disposables.push(editor.onDidChangeCursorPosition(() => wikiLinkPreviewModal.hide(100)))
      disposables.push(editor.onDidScrollChange(() => wikiLinkPreviewModal.hide(100)))
    }
  } catch (err) {
    console.error('[WikiLink] Failed attaching editor hover listeners:', err)
  }

  // 1. Hover Provider
  const hoverProvider = {
    provideHover: async (model: any, position: any) => {
      try {
        const lineContent = model.getLineContent(position.lineNumber)
        if (!lineContent.includes('[[')) {
          wikiLinkPreviewModal.hide(100)
          return null
        }

        const regex = /\[\[(.*?)\]\]/g
        let match: RegExpExecArray | null
        while ((match = regex.exec(lineContent)) !== null) {
          const startCol = match.index + 1
          const endCol = match.index + match[0].length + 1

          if (position.column >= startCol && position.column <= endCol) {
            const content = match[1]
            const [target] = content.split('|')
            const cleanTarget = target.trim()

            const editor = monaco.editor.getEditors()[0]
            if (editor) {
              const pos = editor.getScrolledVisiblePosition(position)
              const editorEl = editor.getDomNode()
              if (pos && editorEl) {
                const rect = editorEl.getBoundingClientRect()
                const targetRect = new DOMRect(
                  rect.left + pos.left,
                  rect.top + pos.top,
                  Math.max(40, (endCol - startCol) * 8),
                  pos.height || 20
                )
                void wikiLinkPreviewModal.show(cleanTarget, targetRect, getNotePreview)
              }
            }
            return null
          }
        }
        wikiLinkPreviewModal.hide(100)
        return null
      } catch (err) {
        console.error('[WikiLink] Hover Error:', err)
        return null
      }
    }
  }

  // 2. Completion Provider (Autocomplete)
  const completionProvider = {
    triggerCharacters: ['[', '@'],
    provideCompletionItems: (model: any, position: any) => {
      try {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })

        // Check for [[ trigger
        const wikiMatch = /\[\[([^\]]*)$/.exec(textUntilPosition)
        // Check for @ trigger
        const mentionMatch = /@([^@\s]*)$/.exec(textUntilPosition)

        if (!wikiMatch && !mentionMatch) return { suggestions: [] }

        const isMention = !!mentionMatch && !wikiMatch
        const match = wikiMatch || mentionMatch
        const search = match![1].toLowerCase()

        const textAfterPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column + 2
        })
        const hasClosing = textAfterPosition.startsWith(']]')

        // Calculate range to replace:
        // For [[, replace from match.index + 3 (after [[)
        // For @, replace from match.index + 2 (after @)
        const startCol = match!.index + (isMention ? 2 : 3)
        const endCol = position.column
        const range = new monaco.Range(position.lineNumber, startCol, position.lineNumber, endCol)

        const suggestions = state.notes
          .filter((n) => (n.title || n.id).toLowerCase().includes(search))
          .map((n) => {
            const name = n.title || n.id
            return {
              label: isMention ? `@${name}` : name,
              kind: monaco.languages.CompletionItemKind.File,
              // If it's a mention, we still want to insert a wiki-link for functionality
              insertText: isMention ? `[[${name}]]` : hasClosing ? name : name + ']]',
              detail: '',
              documentation: '',
              range: range,
              filterText: isMention ? `@${name}` : name,
              sortText: '1-' + name
            }
          })

        if (search.trim().length > 0) {
          const query = match![1]
          if (!suggestions.find((s) => s.label === query || s.label === `@${query}`)) {
            suggestions.push({
              label: `Create "${query}"`,
              kind: monaco.languages.CompletionItemKind.Constructor,
              insertText: isMention ? `[[${query}]]` : hasClosing ? query : query + ']]',
              detail: '',
              documentation: '',
              range: range,
              sortText: '0-' + query,
              filterText: query
            })
          }
        }

        return { suggestions }
      } catch (err) {
        if (err && typeof err === 'object' && 'message' in err && err.message !== 'Canceled') {
          console.error('[WikiLink] Completion Error:', err)
        }
        return { suggestions: [] }
      }
    }
  }

  // 3. Inline Provider (Ghost Text)
  const inlineProvider = {
    provideInlineCompletions: (model: any, position: any) => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })

      if (textUntilPosition.includes('[[')) {
        const match = /\[\[([^\]]*)$/.exec(textUntilPosition)
        if (match) {
          const partial = match[1].toLowerCase()
          // Only show suggestion if there's at least one character typed
          if (partial && partial.length > 0) {
            const bestMatch = state.notes.find((n) =>
              (n.title || n.id).toLowerCase().startsWith(partial)
            )
            if (bestMatch) {
              const name = bestMatch.title || bestMatch.id
              // Calculate where the [[ starts (match.index is the position of [[ in the string)
              const bracketStartCol = match.index! + 1 // +1 because Monaco columns are 1-based
              // The range should start right after [[ and end at current cursor
              // This positions the ghost text right after [[
              return {
                items: [
                  {
                    insertText: name + ']]',
                    range: new monaco.Range(
                      position.lineNumber,
                      bracketStartCol + 2, // Start right after [[
                      position.lineNumber,
                      position.column // End at current cursor position
                    ),
                    command: {
                      id: 'editor.action.inlineSuggest.commit',
                      title: 'Accept'
                    }
                  }
                ]
              }
            }
          }
        }
      }
      return { items: [] }
    },
    freeInlineCompletions: () => {}
  }

  // Register ONCE for all languages via wildcard '*'
  // This prevents the "Duplicate" pop-ups where the same info appears multiple times.
  disposables.push(monaco.languages.registerHoverProvider('*', hoverProvider))
  disposables.push(monaco.languages.registerCompletionItemProvider('*', completionProvider))
  disposables.push(monaco.languages.registerInlineCompletionsProvider('*', inlineProvider))

  return disposables
}
