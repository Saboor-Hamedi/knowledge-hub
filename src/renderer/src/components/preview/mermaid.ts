import './codewrapper.css'
import './mermaidwrapper.css'
import { checkIcon, copyIcon, imageIcon, failIcon, flashButton, copySvgAsImage } from './capture'

let loaded = false
const svgCache = new Map<string, string>()
const CACHE_MAX = 50

function buildMermaidWrapper(source: string, svgHtml: string): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'code-block-wrapper'

  const header = document.createElement('div')
  header.className = 'code-block-header'

  const label = document.createElement('span')
  label.className = 'code-block-language'
  label.textContent = 'mermaid'
  header.appendChild(label)

  const actions = document.createElement('div')
  actions.style.display = 'flex'
  actions.style.gap = '4px'

  const srcBtn = document.createElement('button')
  srcBtn.className = 'code-copy-button'
  srcBtn.title = 'Copy source'
  srcBtn.dataset.restoreIcon = copyIcon
  srcBtn.dataset.restoreTitle = 'Copy source'
  srcBtn.innerHTML = copyIcon
  srcBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source)
      flashButton(srcBtn, checkIcon(), 'Copied!')
    } catch { /* ignore */ }
  })

  const imgBtn = document.createElement('button')
  imgBtn.className = 'code-copy-button'
  imgBtn.title = 'Copy as image'
  imgBtn.dataset.restoreIcon = imageIcon
  imgBtn.dataset.restoreTitle = 'Copy as image'
  imgBtn.innerHTML = imageIcon
  imgBtn.addEventListener('click', async () => {
    const svgEl = wrapper.querySelector<SVGElement>('.mermaid svg')
    if (!svgEl) return
    try {
      await copySvgAsImage(svgEl)
      flashButton(imgBtn, checkIcon(), 'Copied image!')
    } catch {
      flashButton(imgBtn, failIcon, 'Failed')
    }
  })

  actions.appendChild(srcBtn)
  actions.appendChild(imgBtn)
  header.appendChild(actions)

  const body = document.createElement('div')
  body.className = 'mermaid'
  body.innerHTML = svgHtml

  wrapper.appendChild(header)
  wrapper.appendChild(body)
  return wrapper
}

const MERMAID_KEYWORDS = [
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'erDiagram', 'journey', 'gantt', 'pie', 'gitGraph', 'mindmap', 'timeline',
  'xychart', 'block', 'packet', 'architecture', 'requirementDiagram', 'C4Context',
  'quadrantChart', 'sankey-beta', 'zenuml'
]

function isCompleteMermaidSource(source: string): boolean {
  const firstLine = source.trimStart().split('\n')[0].trim().toLowerCase()
  return MERMAID_KEYWORDS.some((kw) => firstLine.startsWith(kw.toLowerCase()))
}

export async function renderMermaid(container: HTMLElement, savedSvgs?: Map<string, string>): Promise<void> {
  const blocks = container.querySelectorAll('pre code.language-mermaid')
  if (!blocks.length) return

  // Phase 1 — restore saved SVGs synchronously (no blink)
  const pending: { pre: HTMLElement; source: string }[] = []

  for (const codeEl of blocks) {
    const pre = codeEl.parentElement
    if (!pre) continue

    const source = codeEl.textContent || ''

    // Skip incomplete/mid-type blocks that don't yet have a diagram type keyword
    if (!isCompleteMermaidSource(source)) continue

    const cached = svgCache.get(source) || savedSvgs?.get(source)
    if (cached) {
      pre.replaceWith(buildMermaidWrapper(source, cached))
    } else {
      pending.push({ pre, source })
    }
  }

  if (!pending.length) return

  // Phase 2 — render uncached diagrams asynchronously
  const { default: mermaid } = await import('mermaid')

  if (!loaded) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      fontFamily: 'inherit'
    })
    loaded = true
  }

  for (const { pre, source } of pending) {
    try {
      const id = `m-${Math.random().toString(36).slice(2, 8)}`
      const { svg } = await mermaid.render(id, source)
      if (svgCache.size >= CACHE_MAX) {
        const first = svgCache.keys().next().value
        if (first) svgCache.delete(first)
      }
      svgCache.set(source, svg)
      pre.replaceWith(buildMermaidWrapper(source, svg))
    } catch (e) {
      pre.replaceWith(buildMermaidWrapper(source, `[Mermaid error: ${(e as Error).message}]`))
    }
  }
}
