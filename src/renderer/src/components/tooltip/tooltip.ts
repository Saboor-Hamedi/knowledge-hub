import './tooltip.css'

export class TooltipManager {
  private el: HTMLElement
  private timeout: ReturnType<typeof setTimeout> | null = null
  private currentTarget: HTMLElement | null = null

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'custom-tooltip'
    if (document.body) {
      document.body.appendChild(this.el)
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(this.el)
      })
    }
    this.attach()
  }

  private attach(): void {
    window.addEventListener('mouseover', (e) => {
      const target = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement
      if (target) {
        // If we move to a NEW target, hide the current tooltip first to prevent stretching
        if (this.currentTarget && this.currentTarget !== target) {
          this.hideImmediately()
        }

        const text = target.getAttribute('data-tooltip')
        if (text) {
          this.currentTarget = target
          this.show(text, target)
        }
      }
    })

    window.addEventListener('mouseout', (e) => {
      const target = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement
      const related = (e.relatedTarget as HTMLElement)?.closest('[data-tooltip]') as HTMLElement
      if (target && target !== related) {
        this.hide()
      }
    })
  }

  private show(text: string, target: HTMLElement): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      if (!document.body.contains(target)) {
        this.hide()
        return
      }

      this.el.textContent = text
      this.el.classList.add('is-visible')
      this.el.style.opacity = ''

      const rect = target.getBoundingClientRect()
      const tooltipRect = this.el.getBoundingClientRect()

      const sidebar = target.closest('.sidebar') || target.closest('#sidebar') || target.closest('.tree-item') || target.closest('.sidebar__tree-item')
      let top: number
      let clampedLeft: number
      let positionClass = 'pos-bottom'

      if (sidebar) {
        // Position side-by-side out of the sidebar, to the right over the editor
        positionClass = 'pos-right'
        const sidebarEl = target.closest('#sidebar') || target.closest('.sidebar') || document.getElementById('sidebar')
        const leftPos = Math.max(rect.right, sidebarEl ? sidebarEl.getBoundingClientRect().right : rect.right) + 8
        const maxLeft = window.innerWidth - tooltipRect.width - 10
        clampedLeft = Math.min(maxLeft, leftPos)

        top = rect.top + (rect.height - tooltipRect.height) / 2
        top = Math.max(10, Math.min(window.innerHeight - tooltipRect.height - 10, top))

        const arrowOffsetY = rect.top + rect.height / 2 - top
        this.el.style.setProperty('--tooltip-arrow-offset-y', `${Math.max(8, Math.min(tooltipRect.height - 8, arrowOffsetY))}px`)
      } else {
        top = rect.bottom + 6
        const left = rect.left + rect.width / 2 - tooltipRect.width / 2

        // Position logic: prefer bottom, switch to top if no space
        positionClass = 'pos-bottom'
        if (top + tooltipRect.height > window.innerHeight - 10) {
          top = rect.top - tooltipRect.height - 6
          positionClass = 'pos-top'
        }

        // Horizontal bounds
        const minLeft = 10
        const maxLeft = window.innerWidth - tooltipRect.width - 10
        clampedLeft = Math.max(minLeft, Math.min(maxLeft, left))

        // Calculate arrow offset relative to tooltip
        const targetCenter = rect.left + rect.width / 2
        const arrowOffset = targetCenter - clampedLeft
        this.el.style.setProperty('--tooltip-arrow-offset', `${arrowOffset}px`)
      }

      this.el.className = `custom-tooltip is-visible ${positionClass}`
      this.el.style.top = `${top}px`
      this.el.style.left = `${clampedLeft}px`
    }, 40)
  }

  public hide(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.el.classList.remove('is-visible')
    this.currentTarget = null
  }

  private hideImmediately(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.el.classList.remove('is-visible')
    this.el.style.opacity = '0' // Force hide
    this.currentTarget = null
  }
}

export const tooltipManager = new TooltipManager()

// Helper to set tooltip programmatically
export const setTooltip = (el: HTMLElement, text: string): void => {
  el.setAttribute('data-tooltip', text)
}
