import { state } from '../../core/state'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { renderMermaid } from '../preview/mermaid'
import { checkIcon, copyIcon, imageIcon, failIcon, flashButton, copyHtmlAsImage } from '../preview/capture'
import '../preview/codewrapper.css'
import '../preview/preview.css'

// ── Shared MarkdownIt instance for popover renders ────────────────────────────
const md = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: true })

// Register wiki_link rule
md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
  const max = state.posMax
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5b) return false
  let pos = start + 2
  let labelEnd = -1
  while (pos < max) {
    if (state.src.charCodeAt(pos) === 0x5d && state.src.charCodeAt(pos + 1) === 0x5d) { labelEnd = pos; pos += 2; break }
    pos++
  }
  if (labelEnd < 0) return false
  const label = state.src.slice(start + 2, labelEnd)
  if (!label) return false
  if (!silent) { const t = state.push('wiki_link', 'a', 0); t.content = label; t.attrSet('href', '#'); t.attrSet('data-wiki-link', label); t.markup = '[[' }
  state.pos = pos
  return true
})
md.renderer.rules.wiki_link = (tokens, idx) => {
  const label = tokens[idx].content
  return `<a href="#" class="wiki-link" data-wiki-link="${md.utils.escapeHtml(label)}">${md.utils.escapeHtml(label)}</a>`
}

// ── Wrap code blocks with header + copy/image buttons ────────────────────────
function wrapCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll('pre').forEach((pre) => {
    const el = pre as HTMLElement
    if (el.parentElement?.classList.contains('code-block-wrapper')) return
    const code = el.querySelector('code')
    const lang = code?.className?.replace('language-', '') || ''
    if (lang === 'mermaid') return

    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'

    const header = document.createElement('div')
    header.className = 'code-block-header'

    const label = document.createElement('span')
    label.className = 'code-block-language'
    label.textContent = lang || 'code'
    header.appendChild(label)

    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:4px'

    // Copy code button
    const copyBtn = document.createElement('button')
    copyBtn.className = 'code-copy-button'
    copyBtn.title = 'Copy code'
    copyBtn.dataset.restoreIcon = copyIcon
    copyBtn.dataset.restoreTitle = 'Copy code'
    copyBtn.innerHTML = copyIcon
    copyBtn.addEventListener('click', async () => {
      if (!code) return
      try {
        await navigator.clipboard.writeText(code.textContent || '')
        flashButton(copyBtn, checkIcon(), 'Copied!')
      } catch { /* ignore */ }
    })

    // Copy as image button
    const imgBtn = document.createElement('button')
    imgBtn.className = 'code-copy-button'
    imgBtn.title = 'Copy as image'
    imgBtn.dataset.restoreIcon = imageIcon
    imgBtn.dataset.restoreTitle = 'Copy as image'
    imgBtn.innerHTML = imageIcon
    imgBtn.addEventListener('click', async () => {
      try {
        await copyHtmlAsImage(el)
        flashButton(imgBtn, checkIcon(), 'Copied image!')
      } catch {
        flashButton(imgBtn, failIcon, 'Failed')
      }
    })

    actions.append(copyBtn, imgBtn)
    header.appendChild(actions)

    el.parentNode?.insertBefore(wrapper, el)
    wrapper.append(header, el)
  })
}

function rehighlightCode(container: HTMLElement): void {
  container.querySelectorAll('pre code').forEach((block) => {
    const el = block as HTMLElement
    const lang = el.className.match(/language-(\w+)/)?.[1]
    if (lang && hljs.getLanguage(lang)) {
      try { hljs.highlightElement(el) } catch { /* ignore */ }
    }
  })
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?\n---\n?/, '')
}

// ── Render markdown content into a container element ─────────────────────────
function renderMarkdownInto(rawContent: string, container: HTMLElement): void {
  const content = stripFrontmatter(rawContent)

  // Save existing mermaid SVGs to avoid re-render flicker
  const mermaidSvgMap = new Map<string, string>()
  container.querySelectorAll('.mermaid svg').forEach((svg) => {
    const wrapper = svg.closest('.code-block-wrapper')
    if (wrapper) mermaidSvgMap.set(wrapper.outerHTML, svg.outerHTML)
  })

  container.innerHTML = DOMPurify.sanitize(
    md.render(content.replace(/!\[\s+([^\]]+)\]/g, '![$1]')),
    { ADD_ATTR: ['class', 'data-wiki-link', 'src', 'alt', 'title'], ADD_TAGS: ['pre', 'code', 'img'], ALLOW_DATA_ATTR: true, KEEP_CONTENT: true, ALLOW_UNKNOWN_PROTOCOLS: false }
  )

  renderMermaid(container, mermaidSvgMap)
  wrapCodeBlocks(container)
  rehighlightCode(container)
}

// ── WikiLinkPreviewModal ──────────────────────────────────────────────────────
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
      <div class="wikilink-preview-body"><div class="wikilink-preview-content"></div></div>
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

    // Show loading state
    const contentEl = this.bodyEl.querySelector('.wikilink-preview-content') as HTMLElement
    contentEl.innerHTML = '<div class="wikilink-preview-loading">Loading preview...</div>'

    this.el.style.display = 'flex'
    this.position(rect)
    this.el.classList.add('is-visible')
    this.visible = true

    const preview = await getNotePreview(target)
    if (this.currentTarget !== target) return

    // Resolve note title
    const note = state.notes.find(
      (n) =>
        n.id.toLowerCase() === target.toLowerCase() ||
        (n.title && n.title.toLowerCase() === target.toLowerCase()) ||
        (n.path && `${n.path}/${n.id}`.toLowerCase() === target.toLowerCase())
    )
    const noteTitle = note ? note.title || note.id : target
    this.titleEl.textContent = `📄 ${noteTitle}`

    if (!preview) {
      contentEl.innerHTML = '<div class="wikilink-preview-loading">Note not found</div>'
    } else if (!preview.trim()) {
      contentEl.innerHTML = '<div class="wikilink-preview-loading">Note is empty</div>'
    } else {
      // Render full markdown pipeline — same as main preview
      renderMarkdownInto(preview, contentEl)
    }

    this.position(rect)
  }

  public position(rect: DOMRect): void {
    this.el.style.display = 'flex'
    const modalRect = this.el.getBoundingClientRect()
    const targetCenterX = rect.left + rect.width / 2
    const left = Math.max(16, Math.min(window.innerWidth - modalRect.width - 16, targetCenterX - modalRect.width / 2))

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
