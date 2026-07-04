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

// Pre-register common languages at module load
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'

// Register common languages immediately
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

// Configure highlighting to ignore unescaped HTML warnings
// Safe as we sanitize with DOMPurify
hljs.configure({ ignoreUnescapedHTML: true })

// Helper for tag/mention matching
const isIdentifierChar = (code: number): boolean => {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f || // _
    code === 0x2d // -
  )
}

export class PreviewComponent {
  private container: HTMLElement
  private md: MarkdownIt
  private onWikiLinkClick?: (target: string) => void
  private currentFilePath: string | null = null

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    if (!this.container) {
      throw new Error(`Preview container with id "${containerId}" not found`)
    }

    // Initialize MarkdownIt with plugins
    this.md = new MarkdownIt({
      html: true, // Enable HTML tags in source
      linkify: true, // Autoconvert URL-like text to links
      breaks: false, // Don't convert '\n' in paragraphs into <br> (standard markdown)
      typographer: true // Enable some language-neutral replacement + quotes beautification
    })

    // Add custom rule for wiki links [[note-name]]
    this.md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
      const max = state.posMax
      const start = state.pos

      if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false
      if (state.src.charCodeAt(start + 1) !== 0x5b /* [ */) return false

      let pos = start + 2
      const labelStart = pos
      let labelEnd = -1

      // Find the closing ]]
      while (pos < max) {
        if (state.src.charCodeAt(pos) === 0x5d /* ] */) {
          if (state.src.charCodeAt(pos + 1) === 0x5d /* ] */) {
            labelEnd = pos
            pos += 2
            break
          }
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

    // Render wiki links
    this.md.renderer.rules.wiki_link = (tokens, idx) => {
      const token = tokens[idx]
      const label = token.content
      return `<a href="#" class="wiki-link" data-wiki-link="${this.md.utils.escapeHtml(label)}">${this.md.utils.escapeHtml(label)}</a>`
    }

    // Add custom rule for tags #tag
    this.md.inline.ruler.after('wiki_link', 'tag', (state, silent) => {
      const start = state.pos
      if (state.src.charCodeAt(start) !== 0x23 /* # */) return false

      const max = state.posMax
      let pos = start + 1

      if (pos >= max) return false

      if (!isIdentifierChar(state.src.charCodeAt(pos))) return false

      while (pos < max) {
        if (!isIdentifierChar(state.src.charCodeAt(pos))) break
        pos++
      }

      if (pos === start + 1) return false

      if (!silent) {
        const token = state.push('tag', 'span', 0)
        token.content = state.src.slice(start + 1, pos)
        token.markup = '#'
      }

      state.pos = pos
      return true
    })

    // Add custom rule for mentions @mention
    this.md.inline.ruler.after('tag', 'mention', (state, silent) => {
      const start = state.pos
      if (state.src.charCodeAt(start) !== 0x40 /* @ */) return false

      const max = state.posMax
      let pos = start + 1

      if (pos >= max) return false

      if (!isIdentifierChar(state.src.charCodeAt(pos))) return false

      while (pos < max) {
        if (!isIdentifierChar(state.src.charCodeAt(pos))) break
        pos++
      }

      if (pos === start + 1) return false

      if (!silent) {
        const token = state.push('mention', 'span', 0)
        token.content = state.src.slice(start + 1, pos)
        token.markup = '@'
      }

      state.pos = pos
      return true
    })

    this.md.renderer.rules.tag = (tokens, idx) => {
      const label = tokens[idx].content
      return `<span class="tag">#${this.md.utils.escapeHtml(label)}</span>`
    }

    this.md.renderer.rules.mention = (tokens, idx) => {
      const label = tokens[idx].content
      return `<span class="mention">@${this.md.utils.escapeHtml(label)}</span>`
    }

    this.render()
    this.attachEvents()

    this.boundUpdateFontSize = () => this.updateFontSize()
    window.addEventListener('knowledge-hub:settings-updated', this.boundUpdateFontSize)
  }

  setWikiLinkHandler(handler: (target: string) => void): void {
    this.onWikiLinkClick = handler
  }

  private resolveImagePath(src: string): string {
    // If it's already an absolute URL (http/https/file), return as-is
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('file://')) {
      return src
    }

    // If it's a relative path and we have vault path, convert to file:// URL
    const vaultPath = state.vaultPath
    if (vaultPath && !src.startsWith('/')) {
      // Normalize path separators and join
      const vaultPathNormalized = vaultPath.replace(/\\/g, '/')
      const srcNormalized = src.replace(/\\/g, '/')

      // Remove leading slash from src if present
      const cleanSrc = srcNormalized.startsWith('/') ? srcNormalized.slice(1) : srcNormalized

      // Join paths
      const fullPath = `${vaultPathNormalized}/${cleanSrc}`

      // Convert to file:// URL (Windows needs 3 slashes, Unix needs 2)
      // On Windows, paths like C:\ need to become file:///C:/
      if (fullPath.match(/^[A-Za-z]:/)) {
        // Windows absolute path
        return `file:///${fullPath.replace(/\\/g, '/')}`
      } else {
        // Unix path
        return `file://${fullPath}`
      }
    }

    // Fallback: return as-is
    return src
  }

  private render(): void {
    this.container.innerHTML = '<div class="preview-content"></div>'
    this.updateFontSize()
  }

  private attachEvents(): void {
    // Handle wikilink hover preview in preview mode
    this.container.addEventListener('mouseover', (e) => {
      const wikiLink = (e.target as HTMLElement).closest('.wiki-link') as HTMLElement
      if (wikiLink && wikiLink.dataset.wikiLink) {
        const target = wikiLink.dataset.wikiLink
        void wikiLinkPreviewModal.show(
          target,
          wikiLink.getBoundingClientRect(),
          async (id) => {
            try {
              const note = state.notes.find(
                (n) =>
                  n.id.toLowerCase() === id.toLowerCase() ||
                  (n.title && n.title.toLowerCase() === id.toLowerCase()) ||
                  (n.path && `${n.path}/${n.id}`.toLowerCase() === id.toLowerCase())
              )
              if (!note) return null
              const res = await window.api.loadNote(note.id, note.path)
              return res?.content || null
            } catch {
              return null
            }
          }
        )
      }
    })
    this.container.addEventListener('mouseout', (e) => {
      const wikiLink = (e.target as HTMLElement).closest('.wiki-link') as HTMLElement
      if (wikiLink) {
        wikiLinkPreviewModal.hide(150)
      }
    })

    // Handle click delegation
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement

      // 1. Handle Wiki Links
      const wikiLink = target.closest('.wiki-link') as HTMLElement
      if (wikiLink && this.onWikiLinkClick) {
        e.preventDefault()
        const linkTarget = wikiLink.dataset.wikiLink
        if (linkTarget) {
          this.onWikiLinkClick(linkTarget)
        }
        return
      }

      // 2. Handle Tags
      const tagElement = target.closest('.tag') as HTMLElement
      if (tagElement) {
        e.preventDefault()
        const tagText = tagElement.textContent?.replace(/^#/, '') || ''
        if (tagText) {
          // Open search with tag
          window.dispatchEvent(
            new CustomEvent('hub-open-search', {
              detail: { query: `#${tagText}` }
            })
          )
        }
        return
      }

      // 3. Handle Mentions
      const mentionElement = target.closest('.mention') as HTMLElement
      if (mentionElement) {
        e.preventDefault()
        const mentionText = mentionElement.textContent?.replace(/^@/, '') || ''
        if (mentionText) {
          // Open search with mention
          window.dispatchEvent(
            new CustomEvent('hub-open-search', {
              detail: { query: `@${mentionText}` }
            })
          )
          // Also try to find a note with that name directly
          if (this.onWikiLinkClick) {
            this.onWikiLinkClick(mentionText)
          }
        }
        return
      }
    })
  }

  private lastContent: string | null = null
  private renderPending = false
  private boundUpdateFontSize: () => void

  /**
   * Detects if a file is a code file (not markdown) based on extension
   */
  private isCodeFile(filePath: string): boolean {
    const lower = filePath.toLowerCase()
    // Markdown extensions
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      return false
    }
    // Code file extensions
    const codeExtensions = [
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.json',
      '.py',
      '.rb',
      '.php',
      '.java',
      '.c',
      '.cpp',
      '.cs',
      '.go',
      '.rs',
      '.html',
      '.css',
      '.scss',
      '.sass',
      '.less',
      '.sql',
      '.sh',
      '.bash',
      '.yaml',
      '.yml',
      '.xml',
      '.toml',
      '.swift',
      '.kt',
      '.dart',
      '.lua',
      '.r',
      '.m',
      '.h'
    ]
    return codeExtensions.some((ext) => lower.endsWith(ext))
  }

  /**
   * Maps file extension to language identifier for syntax highlighting
   */
  private getLanguageFromPath(filePath: string): string {
    const lower = filePath.toLowerCase()
    const extMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.py': 'python',
      '.rb': 'ruby',
      '.php': 'php',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.sql': 'sql',
      '.sh': 'bash',
      '.bash': 'bash',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.xml': 'xml',
      '.toml': 'toml',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.dart': 'dart',
      '.lua': 'lua',
      '.r': 'r',
      '.m': 'objective-c',
      '.h': 'c'
    }

    for (const [ext, lang] of Object.entries(extMap)) {
      if (lower.endsWith(ext)) {
        return lang
      }
    }
    return 'plaintext'
  }

  update(content: string, filePath?: string): void {
    // Update file path if provided
    if (filePath !== undefined) {
      this.currentFilePath = filePath
    }

    if (this.lastContent === content) return
    this.lastContent = content

    if (this.renderPending) return
    this.renderPending = true

    requestAnimationFrame(() => {
      if (this.lastContent !== null) {
        this.performRender(this.lastContent)
      }
      this.renderPending = false
    })
  }

  private updateFontSize(): void {
    const previewContent = this.container.querySelector('.preview-content') as HTMLElement
    if (previewContent) {
      previewContent.style.fontSize = `${state.settings?.fontSize ?? 14}px`
    }
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?\n---\n?/, '')
  }

  private performRender(content: string): void {
    const previewContent = this.container.querySelector('.preview-content') as HTMLElement
    if (!previewContent) return

    this.updateFontSize()

    // Save scroll position
    const scrollTop = this.container.scrollTop

    // Strip YAML/TOML frontmatter
    content = this.stripFrontmatter(content)

    // Determine if we need to wrap content in code fence
    let renderContent = content
    const isCode = this.currentFilePath && this.isCodeFile(this.currentFilePath)

    if (isCode) {
      previewContent.classList.add('is-full-file')
      const language = this.getLanguageFromPath(this.currentFilePath!)
      // Wrap entire content in code fence for syntax highlighting
      renderContent = `\`\`\`${language}\n${content}\n\`\`\``
    } else {
      previewContent.classList.remove('is-full-file')
    }

    // Normalize image markdown syntax (fix spaces after !)
    // Fix cases like ![ Logo.png] to ![Logo.png]
    const normalizedContent = renderContent.replace(/!\[\s+([^\]]+)\]/g, '![$1]')

    // Render markdown to HTML
    const rawHtml = this.md.render(normalizedContent)

    // Sanitize HTML but allow necessary attributes for styling and functionality
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['class', 'data-wiki-link', 'src', 'alt', 'title'],
      ADD_TAGS: ['pre', 'code', 'img'],
      ALLOW_DATA_ATTR: true,
      KEEP_CONTENT: true,
      ALLOW_UNKNOWN_PROTOCOLS: false
    })

    previewContent.innerHTML = cleanHtml

    // Restore scroll position
    this.container.scrollTop = scrollTop

    // Resolve image paths to file:// URLs
    previewContent.querySelectorAll('img').forEach((img) => {
      const imgElement = img as HTMLImageElement
      const src = imgElement.getAttribute('src')
      if (
        src &&
        !src.startsWith('http://') &&
        !src.startsWith('https://') &&
        !src.startsWith('file://')
      ) {
        const resolvedPath = this.resolveImagePath(src)
        imgElement.src = resolvedPath
        // Handle image load errors
        imgElement.onerror = () => {
          console.warn('[Preview] Failed to load image:', resolvedPath, 'Original src:', src)
          imgElement.alt = `Failed to load: ${src}`
          imgElement.style.border = '2px dashed var(--danger)'
        }
      }
    })

    // Render mermaid diagrams before code wrapping
    renderMermaid(previewContent)

    // Wrap code blocks with header and add copy buttons
    previewContent.querySelectorAll('pre').forEach((pre) => {
      const preElement = pre as HTMLElement

      // Check if already wrapped
      if (preElement.parentElement?.classList.contains('code-block-wrapper')) return

      // Get language from code element
      const codeElement = preElement.querySelector('code')
      const language = codeElement?.className?.replace('language-', '') || ''
      if (language === 'mermaid') return // already handled by renderMermaid
      const languageName = language || 'code'

      // Create wrapper
      const wrapper = document.createElement('div')
      wrapper.className = 'code-block-wrapper'

      // Create header
      const header = document.createElement('div')
      header.className = 'code-block-header'

      // Language label
      const languageLabel = document.createElement('span')
      languageLabel.className = 'code-block-language'
      languageLabel.textContent = languageName
      header.appendChild(languageLabel)

      const actions = document.createElement('div')
      actions.style.display = 'flex'
      actions.style.gap = '4px'

      const copyBtn = document.createElement('button')
      copyBtn.className = 'code-copy-button'
      copyBtn.title = 'Copy code'
      copyBtn.dataset.restoreIcon = copyIcon
      copyBtn.dataset.restoreTitle = 'Copy code'
      copyBtn.innerHTML = copyIcon
      copyBtn.addEventListener('click', async () => {
        const code = preElement.querySelector('code')
        if (code) {
          try {
            await navigator.clipboard.writeText(code.textContent || '')
            flashButton(copyBtn, checkIcon(), 'Copied!')
          } catch { /* ignore */ }
        }
      })

      const imgBtn = document.createElement('button')
      imgBtn.className = 'code-copy-button'
      imgBtn.title = 'Copy as image'
      imgBtn.dataset.restoreIcon = imageIcon
      imgBtn.dataset.restoreTitle = 'Copy as image'
      imgBtn.innerHTML = imageIcon
      imgBtn.addEventListener('click', async () => {
        try {
          await copyHtmlAsImage(preElement)
          flashButton(imgBtn, checkIcon(), 'Copied image!')
        } catch {
          flashButton(imgBtn, failIcon, 'Failed')
        }
      })

      actions.appendChild(copyBtn)
      actions.appendChild(imgBtn)
      header.appendChild(actions)

      // Wrap the pre element
      preElement.parentNode?.insertBefore(wrapper, preElement)
      wrapper.appendChild(header)
      wrapper.appendChild(preElement)
    })

    // Re-highlight code blocks (DOMPurify might have stripped some attributes)
    previewContent.querySelectorAll('pre code').forEach((block) => {
      const codeElement = block as HTMLElement
      const lang = codeElement.className.match(/language-(\w+)/)?.[1] || ''
      if (lang && hljs.getLanguage(lang)) {
        try {
          hljs.highlightElement(codeElement as HTMLElement)
        } catch {
          // Ignore highlighting errors
        }
      }
    })
  }

  clear(): void {
    const previewContent = this.container.querySelector('.preview-content') as HTMLElement
    if (previewContent) {
      previewContent.innerHTML = ''
    }
    this.lastContent = null
  }

  destroy(): void {
    window.removeEventListener('knowledge-hub:settings-updated', this.boundUpdateFontSize)
    this.clear()
    this.container.innerHTML = ''
  }
}
