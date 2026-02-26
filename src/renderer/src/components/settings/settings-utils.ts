import { createElement } from 'lucide'

export function createLucideIcon(IconComponent: any, size: number = 18): string {
  if (!IconComponent) return ''
  const svgElement = createElement(IconComponent, {
    size: size,
    'stroke-width': 1.5,
    stroke: 'currentColor',
    color: 'currentColor'
  })
  return svgElement?.outerHTML || ''
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function shorten(name: string, id: string): string {
  return id === 'dark' ? 'Dark' : id === 'light' ? 'Light' : name.split(' ')[0]
}
