export function svgIcon(path: string, stroke = 'currentColor'): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
}

export function checkIcon(): string {
  return svgIcon('<polyline points="20 6 9 17 4 12"/>', '#22c55e')
}

export const copyIcon = svgIcon('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')
export const imageIcon = svgIcon('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>')
export const failIcon = svgIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 'var(--danger)')

export function flashButton(btn: HTMLButtonElement, html: string, title: string): void {
  const prevIcon = btn.dataset.restoreIcon || btn.innerHTML
  const prevTitle = btn.dataset.restoreTitle || btn.title
  btn.innerHTML = html
  btn.title = title
  btn.classList.add('copied')
  setTimeout(() => {
    btn.innerHTML = prevIcon
    btn.title = prevTitle
    btn.classList.remove('copied')
  }, 2000)
}

function cssVars(): string {
  const root = document.documentElement
  const keys = [
    '--bg','--bg-accent','--panel','--panel-strong','--border','--border-subtle',
    '--muted','--text','--text-strong','--text-soft','--text-muted',
    '--primary','--primary-strong','--danger','--status',
    '--syntax-keyword','--syntax-string','--syntax-comment',
    '--syntax-number','--syntax-builtin','--syntax-type'
  ]
  return keys.map((k) => `${k}:${getComputedStyle(root).getPropertyValue(k)}`).join(';')
}

// ── SVG → PNG (used by mermaid) ────────────────────────────────────────

export async function copySvgAsImage(svgEl: SVGElement): Promise<void> {
  const rect = svgEl.getBoundingClientRect()
  let w = Math.round(rect.width)
  let h = Math.round(rect.height)
  if (!w || !h) { w = 800; h = 600 }

  const clone = svgEl.cloneNode(true) as SVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const defs = clone.querySelector('defs') || clone.insertBefore(
    document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clone.firstChild
  )
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = `:root{${cssVars()}}*{color:inherit}`
  defs.appendChild(style)

  const svgStr = new XMLSerializer().serializeToString(clone)
  const img = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`)
  await canvasToClip(img, w, h)
}

// ── Code block → PNG (render text directly on canvas) ──────────────────

export async function copyHtmlAsImage(element: HTMLElement): Promise<void> {
  const code = element.querySelector('code') || element

  const parentStyle = getComputedStyle(element)
  let bgVar = parentStyle.getPropertyValue('background-color') || ''
  if (!bgVar || bgVar === 'rgba(0, 0, 0, 0)') bgVar = '--panel-strong'
  const pad = parseFloat(parentStyle.getPropertyValue('padding')) || 16
  const family = (parentStyle.getPropertyValue('font-family') || 'Consolas, monospace').split(',')[0].replace(/['"]/g, '')
  const fontSize = 14
  const lineH = 1.45

  const root = document.documentElement
  const bg = bgVar.startsWith('var(') ? getComputedStyle(root).getPropertyValue(bgVar.slice(4, -1)) || '#1a1d27' : bgVar

  // Extract tokens from the DOM, preserving line structure
  const lines: { text: string; color: string }[][] = [[]]
  const baseColor = getComputedStyle(code).getPropertyValue('color') || '#e0e0e0'
  extractTokens(code, baseColor, lines)

  if (lines.length === 1 && lines[0].length === 0) return

  // Measure text dimensions
  const tmp = document.createElement('canvas')
  const ctx = tmp.getContext('2d')!
  ctx.font = `${fontSize}px ${family}`
  const maxW = Math.max(...lines.map((l) => l.reduce((a, t) => a + ctx.measureText(t.text).width, 0)))
  const charH = fontSize * lineH
  const vpW = Math.max(200, Math.min(1200, maxW + pad * 2))
  const vpH = Math.max(100, lines.length * charH + pad * 2)

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = vpW * scale
  canvas.height = vpH * scale
  const cx = canvas.getContext('2d')!
  cx.scale(scale, scale)

  cx.fillStyle = bg
  cx.fillRect(0, 0, vpW, vpH)

  cx.font = `${fontSize}px ${family}`
  cx.textBaseline = 'top'
  let y = pad
  for (const line of lines) {
    let x = pad
    for (const tok of line) {
      cx.fillStyle = tok.color
      cx.fillText(tok.text, x, y)
      x += ctx.measureText(tok.text).width
    }
    y += charH
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('toBlob failed')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

function extractTokens(el: Node, fallback: string, lines: { text: string; color: string }[][]): void {
  if (el.nodeType === 3) {
    const parts = (el.textContent || '').split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) lines[lines.length - 1].push({ text: parts[i], color: fallback })
      if (i < parts.length - 1) lines.push([])
    }
  } else if (el.nodeType === 1) {
    const elm = el as HTMLElement
    const color = getComputedStyle(elm).getPropertyValue('color') || fallback
    for (const child of elm.childNodes) {
      extractTokens(child, color, lines)
    }
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}

async function canvasToClip(img: HTMLImageElement, w: number, h: number): Promise<void> {
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('toBlob failed')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
