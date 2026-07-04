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

function collectCSSVars(): string {
  const root = document.documentElement
  const vars = [
    '--bg', '--bg-accent', '--panel', '--panel-strong', '--border',
    '--muted', '--text', '--text-strong', '--text-soft', '--text-muted',
    '--primary', '--primary-strong', '--danger', '--status',
    '--syntax-keyword', '--syntax-string', '--syntax-comment',
    '--syntax-number', '--syntax-builtin', '--syntax-type'
  ]
  return vars.map((v) => `${v}: ${getComputedStyle(root).getPropertyValue(v)}`).join(';')
}

function svgWithVars(w: number, h: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><style>:root{${collectCSSVars()}}*{color:inherit}</style></defs>
    ${inner}
  </svg>`
}

function inlineStyles(src: HTMLElement, dst: HTMLElement): void {
  const srcStyle = getComputedStyle(src)
  const props = [
    'color', 'background', 'background-color', 'font-family', 'font-size',
    'font-weight', 'font-style', 'line-height', 'text-align', 'padding',
    'margin', 'border', 'border-radius', 'white-space', 'overflow',
    'display', 'opacity', 'text-transform', 'letter-spacing'
  ]
  for (const p of props) {
    const val = srcStyle.getPropertyValue(p)
    if (val) dst.style.setProperty(p, val)
  }
  for (let i = 0; i < src.children.length; i++) {
    inlineStyles(src.children[i] as HTMLElement, dst.children[i] as HTMLElement)
  }
}

async function canvasToClip(canvas: HTMLCanvasElement): Promise<void> {
  const pngBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  )
  if (!pngBlob) throw new Error('Canvas toBlob failed')
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': pngBlob })
  ])
}

export async function copySvgAsImage(svgEl: SVGElement): Promise<void> {
  const rect = svgEl.getBoundingClientRect()
  let w = Math.round(rect.width)
  let h = Math.round(rect.height)
  if (!w || !h) { w = 800; h = 600 }

  const clone = svgEl.cloneNode(true) as SVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const defs = clone.querySelector('defs') || clone.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clone.firstChild)
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = `:root{${collectCSSVars()}}*{color:inherit}`
  defs.appendChild(style)

  const svgString = new XMLSerializer().serializeToString(clone)
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`)
  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  await canvasToClip(canvas)
}

export async function copyHtmlAsImage(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect()
  let w = Math.round(rect.width)
  let h = Math.round(rect.height)
  if (!w || !h) { w = 800; h = 600 }

  const clone = element.cloneNode(true) as HTMLElement
  inlineStyles(element, clone)

  const fo = `<foreignObject x="0" y="0" width="${w}" height="${h}">${new XMLSerializer().serializeToString(clone)}</foreignObject>`
  const svgString = svgWithVars(w, h, fo)
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`)

  const canvas = document.createElement('canvas')
  const scale = 2
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  await canvasToClip(canvas)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}
