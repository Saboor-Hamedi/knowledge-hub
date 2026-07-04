import './codewrapper.css'
import './mermaidwrapper.css'
import { checkIcon, copyIcon, imageIcon, failIcon, flashButton, copySvgAsImage } from './capture'

let loaded = false

export async function renderMermaid(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll('pre code.language-mermaid')
  if (!blocks.length) return

  const { default: mermaid } = await import('mermaid')

  if (!loaded) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      fontFamily: 'inherit'
    })
    loaded = true
  }

  for (const codeEl of blocks) {
    const pre = codeEl.parentElement
    if (!pre) continue

    const source = codeEl.textContent || ''
    const id = `m-${Math.random().toString(36).slice(2, 8)}`

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

    actions.appendChild(srcBtn)
    actions.appendChild(imgBtn)
    header.appendChild(actions)

    const body = document.createElement('div')
    body.className = 'mermaid'

    try {
      const { svg } = await mermaid.render(id, source)
      body.innerHTML = svg
    } catch (e) {
      body.textContent = `[Mermaid error: ${(e as Error).message}]`
      body.style.color = 'var(--danger)'
    }

    imgBtn.addEventListener('click', async () => {
      const svgEl = body.querySelector('svg')
      if (!svgEl) return
      try {
        await copySvgAsImage(svgEl)
        flashButton(imgBtn, checkIcon(), 'Copied image!')
      } catch {
        flashButton(imgBtn, failIcon, 'Failed')
      }
    })

    wrapper.appendChild(header)
    wrapper.appendChild(body)
    pre.replaceWith(wrapper)
  }
}
