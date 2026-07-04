import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { state } from '../../core/state'
import { renderMermaid } from './mermaid'
import { checkIcon, copyIcon, imageIcon, failIcon, flashButton, copyHtmlAsImage } from './capture'
import './codewrapper.css'
import './preview.css'
import '../wikilink/wikilink.css'
import { wikiLinkPreviewModal } from '../wikilink/wikilink'

import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('yaml', yaml)

hljs.configure({ ignoreUnescapedHTML: true })

const isIdentifierChar = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  code === 0x5f || code === 0x2d

export class PreviewComponent {
  private container: HTMLElement
  private md: MarkdownIt
  private onWikiLinkClick?: (target: string) => void
  private currentFilePath: string | null = null
  private lastContent: string | null = null
  private renderPending = false
  private boundUpdateFontSize: () => void

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    if (!this.container) {
      throw new Error(`Preview container with id "${containerId}" not found`)
    }

    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      breaks: false,
      typographer: true
    })

    this.registerWikiLinkRule()
    this.registerTagRule()
    this.registerMentionRule()

    this.render()
    this.attachEvents()

    this.boundUpdateFontSize = () => this.updateFontSize()
    window.addEventListener('knowledge-hub:settings-updated', this.boundUpdateFontSize)
  }

  private registerWikiLinkRule(): void {
    this.md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
      const max = state.posMax
      const start = state.pos

      if (state.src.charCodeAt(start) !== 0x5b) return false
      if (state.src.charCodeAt(start + 1) !== 0x5b) return false

      let pos = start + 2
      const labelStart = pos
      let labelEnd = -1

      while (pos < max) {
        if (state.src.charCodeAt(pos) === 0x5d && state.src.charCodeAt(pos + 1) === 0x5d) {
          labelEnd = pos
          pos += 2
          break
        }
        pos++
      }

      if (labelEnd < 0) return false
      const label = state.src.slice(labelStart, labelEnd)
      if (!label) return false

      if (!silent) {
        const token = state.push('wiki_link', 'a', 0)
        token.content = label
        token.attrSet('href', '#')
        token.attrSet('data-wiki-link', label)
        token.markup = '[['
      }

      state.pos = pos
      return true
    })

    this.md.renderer.rules.wiki_link = (tokens, idx) => {
      const label = tokens[idx].content
      return `<a href="#" class="wiki-link" data-wiki-link="${this.md.utils.escapeHtml(label)}">${this.md.utils.escapeHtml(label)}</a>`
    }
  }

  private registerTagRule(): void {
    this.md.inline.ruler.after('wiki_link', 'tag', (state, silent) => {
      const start = state.pos
      if (state.src.charCodeAt(start) !== 0x23) return false

      const max = state.posMax
      let pos = start + 1

      if (pos >= max || !isIdentifierChar(state.src.charCodeAt(pos))) return false

      while (pos < max && isIdentifierChar(state.src.charCodeAt(pos))) pos++
      if (pos === start + 1) return false

      if (!silent) {
        const token = state.push('tag', 'span', 0)
        token.content = state.src.slice(start + 1, pos)
        token.markup = '#'
      }

      state.pos = pos
      return true
    })

    this.md.renderer.rules.tag = (tokens, idx) => {
      return `<span class="tag">#${this.md.utils.escapeHtml(tokens[idx].content)}</span>`
    }
  }

  private registerMentionRule(): void {
    this.md.inline.ruler.after('tag', 'mention', (state, silent) => {
      const start = state.pos
      if (state.src.charCodeAt(start) !== 0x40) return false

      const max = state.posMax
      let pos = start + 1

      if (pos >= max || !isIdentifierChar(state.src.charCodeAt(pos))) return false

      while (pos < max && isIdentifierChar(state.src.charCodeAt(pos))) pos++
      if (pos === start + 1) return false

      if (!silent) {
        const token = state.push('mention', 'span', 0)
        token.content = state.src.slice(start + 1, pos)
        token.markup = '@'
      }

      state.pos = pos
      return true
    })

    this.md.renderer.rules.mention = (tokens, idx) => {
      return `<span class="mention">@${this.md.utils.escapeHtml(tokens[idx].content)}</span>`
    }
  }

  setWikiLinkHandler(handler: (target: string) => void): void {
    this.onWikiLinkClick = handler
  }

  update(content: string, filePath?: string): void {
    if (filePath !== undefined) {
      this.currentFilePath = filePath
    }
    if (this.lastContent === content || this.renderPending) return
    this.lastContent = content
    this.renderPending = true

    requestAnimationFrame(() => {
      if (this.lastContent !== null) {
        this.performRender(this.lastContent)
      }
      this.renderPending = false
    })
  }

  clear(): void {
    const el = this.container.querySelector('.preview-content') as HTMLElement
    if (el) el.innerHTML = ''
    this.lastContent = null
  }

  destroy(): void {
    window.removeEventListener('knowledge-hub:settings-updated', this.boundUpdateFontSize)
    this.clear()
    this.container.innerHTML = ''
  }

  private render(): void {
    this.container.innerHTML = '<div class="preview-content"></div>'
    this.updateFontSize()
  }

  private updateFontSize(): void {
    const el = this.container.querySelector('.preview-content') as HTMLElement
    if (el) {
      el.style.fontSize = `${state.settings?.fontSize ?? 14}px`
    }
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?\n---\n?/, '')
  }

  private performRender(content: string): void {
    const previewContent = this.container.querySelector('.preview-content') as HTMLElement
    if (!previewContent) return

    this.updateFontSize()
    const scrollTop = this.container.scrollTop
    content = this.stripFrontmatter(content)

    const isCode = this.currentFilePath && this.isCodeFile(this.currentFilePath)
    const renderContent = isCode
      ? `\`\`\`${this.getLanguageFromPath(this.currentFilePath!)}\n${content}\n\`\`\``
      : content

    // Save mermaid wrappers before DOM wipe to prevent flash
    const mermaidSvgMap = new Map<string, string>()
    previewContent.querySelectorAll('.mermaid svg').forEach((svg) => {
      const wrapper = svg.closest('.code-block-wrapper')
      if (wrapper) mermaidSvgMap.set(wrapper.outerHTML, svg.outerHTML)
    })

    previewContent.classList.toggle('is-full-file', !!isCode)
    previewContent.innerHTML = DOMPurify.sanitize(
      this.md.render(renderContent.replace(/!\[\s+([^\]]+)\]/g, '![$1]')),
      { ADD_ATTR: ['class', 'data-wiki-link', 'src', 'alt', 'title'], ADD_TAGS: ['pre', 'code', 'img'], ALLOW_DATA_ATTR: true, KEEP_CONTENT: true, ALLOW_UNKNOWN_PROTOCOLS: false }
    )

    this.container.scrollTop = scrollTop
    this.resolveImages(previewContent)
    renderMermaid(previewContent, mermaidSvgMap)
    this.wrapCodeBlocks(previewContent)
    this.rehighlightCode(previewContent)
  }

  private resolveImages(container: HTMLElement): void {
    container.querySelectorAll('img').forEach((img) => {
      const el = img as HTMLImageElement
      const src = el.getAttribute('src')
      if (!src || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('file://')) return

      const vaultPath = state.vaultPath
      if (vaultPath && !src.startsWith('/')) {
        const full = `${vaultPath.replace(/\\/g, '/')}/${src.replace(/\\/g, '/').replace(/^\//, '')}`
        const resolved = full.match(/^[A-Za-z]:/) ? `file:///${full.replace(/\\/g, '/')}` : `file://${full}`
        el.src = resolved
        el.onerror = () => {
          el.alt = `Failed to load: ${src}`
          el.style.border = '2px dashed var(--danger)'
        }
      }
    })
  }

  private wrapCodeBlocks(container: HTMLElement): void {
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

      const copyBtn = this.makeCopyButton(code)
      const imgBtn = this.makeImageButton(el)
      actions.append(copyBtn, imgBtn)
      header.appendChild(actions)

      el.parentNode?.insertBefore(wrapper, el)
      wrapper.append(header, el)
    })
  }

  private makeCopyButton(codeEl: HTMLElement | null): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'code-copy-button'
    btn.title = 'Copy code'
    btn.dataset.restoreIcon = copyIcon
    btn.dataset.restoreTitle = 'Copy code'
    btn.innerHTML = copyIcon
    btn.addEventListener('click', async () => {
      if (!codeEl) return
      try {
        await navigator.clipboard.writeText(codeEl.textContent || '')
        flashButton(btn, checkIcon(), 'Copied!')
      } catch { /* ignore */ }
    })
    return btn
  }

  private makeImageButton(preEl: HTMLElement): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'code-copy-button'
    btn.title = 'Copy as image'
    btn.dataset.restoreIcon = imageIcon
    btn.dataset.restoreTitle = 'Copy as image'
    btn.innerHTML = imageIcon
    btn.addEventListener('click', async () => {
      try {
        await copyHtmlAsImage(preEl)
        flashButton(btn, checkIcon(), 'Copied image!')
      } catch {
        flashButton(btn, failIcon, 'Failed')
      }
    })
    return btn
  }

  private rehighlightCode(container: HTMLElement): void {
    container.querySelectorAll('pre code').forEach((block) => {
      const el = block as HTMLElement
      const lang = el.className.match(/language-(\w+)/)?.[1]
      if (lang && hljs.getLanguage(lang)) {
        try { hljs.highlightElement(el) } catch { /* ignore */ }
      }
    })
  }

  private isCodeFile(filePath: string): boolean {
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return false

    return ['.js','.jsx','.ts','.tsx','.json','.py','.rb','.php','.java','.c','.cpp','.cs',
      '.go','.rs','.html','.css','.scss','.sass','.less','.sql','.sh','.bash','.yaml','.yml',
      '.xml','.toml','.swift','.kt','.dart','.lua','.r','.m','.h'
    ].some((ext) => lower.endsWith(ext))
  }

  private getLanguageFromPath(filePath: string): string {
    const map: Record<string, string> = {
      '.js':'javascript','.jsx':'javascript','.ts':'typescript','.tsx':'typescript',
      '.json':'json','.py':'python','.rb':'ruby','.php':'php','.java':'java',
      '.c':'c','.cpp':'cpp','.cs':'csharp','.go':'go','.rs':'rust',
      '.html':'html','.css':'css','.scss':'scss','.sass':'sass','.less':'less',
      '.sql':'sql','.sh':'bash','.bash':'bash','.yaml':'yaml','.yml':'yaml',
      '.xml':'xml','.toml':'toml','.swift':'swift','.kt':'kotlin','.dart':'dart',
      '.lua':'lua','.r':'r','.m':'objective-c','.h':'c'
    }
    const ext = Object.keys(map).find((e) => filePath.toLowerCase().endsWith(e))
    return ext ? map[ext] : 'plaintext'
  }

  private attachEvents(): void {
    this.container.addEventListener('mouseover', (e) => {
      const link = (e.target as HTMLElement).closest('.wiki-link') as HTMLElement
      if (link?.dataset.wikiLink) {
        const target = link.dataset.wikiLink
        void wikiLinkPreviewModal.show(target, link.getBoundingClientRect(), async (id) => {
          try {
            const cleanTarget = id.trim().toLowerCase()
            const targetNoExt = cleanTarget.endsWith('.md') ? cleanTarget.slice(0, -3) : cleanTarget
            const getBasename = (p: string): string => p.split(/[\/\\]/).pop() || p

            const note = state.notes.find((n) => {
              const idLow = n.id.toLowerCase()
              const idNoExt = idLow.endsWith('.md') ? idLow.slice(0, -3) : idLow
              const baseLow = getBasename(idLow)
              const baseNoExt = baseLow.endsWith('.md') ? baseLow.slice(0, -3) : baseLow
              const titleLow = (n.title || '').toLowerCase()
              const fullPathLow = (n.path ? `${n.path}/${n.id}` : n.id).toLowerCase()
              const fullPathNoExt = fullPathLow.endsWith('.md') ? fullPathLow.slice(0, -3) : fullPathLow
              return (
                idLow === cleanTarget || idNoExt === cleanTarget ||
                baseLow === cleanTarget || baseNoExt === cleanTarget ||
                titleLow === cleanTarget || titleLow === targetNoExt ||
                fullPathLow === cleanTarget || fullPathNoExt === cleanTarget
              )
            })
            if (!note) return null
            const res = await window.api.loadNote(note.id, note.path)
            return res?.content || null
          } catch { return null }
        })
      }
    })

    this.container.addEventListener('mouseout', (e) => {
      const link = (e.target as HTMLElement).closest('.wiki-link') as HTMLElement
      if (link) wikiLinkPreviewModal.hide(150)
    })

    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement

      const wikiLink = target.closest('.wiki-link') as HTMLElement
      if (wikiLink && this.onWikiLinkClick) {
        e.preventDefault()
        this.onWikiLinkClick(wikiLink.dataset.wikiLink || '')
        return
      }

      const tag = target.closest('.tag') as HTMLElement
      if (tag) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('hub-open-search', {
          detail: { query: `#${(tag.textContent || '').replace(/^#/, '')}` }
        }))
        return
      }

      const mention = target.closest('.mention') as HTMLElement
      if (mention) {
        e.preventDefault()
        const text = (mention.textContent || '').replace(/^@/, '')
        window.dispatchEvent(new CustomEvent('hub-open-search', { detail: { query: `@${text}` } }))
        this.onWikiLinkClick?.(text)
      }
    })
  }
}
