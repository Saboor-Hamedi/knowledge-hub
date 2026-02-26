export interface TooltipOptions {
  className?: string
  delay?: number
  interactive?: boolean
  ignoreSafeZone?: boolean
}

export class RichTooltip {
  private el: HTMLElement
  private visible = false
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private currentTarget: HTMLElement | null = null
  public options: TooltipOptions

  constructor(options: TooltipOptions = {}) {
    this.options = {
      delay: 100,
      interactive: true,
      ...options
    }

    this.el = document.createElement('div')
    this.el.className = `rich-tooltip ${this.options.className || ''}`
    document.body.appendChild(this.el)

    if (this.options.interactive) {
      this.el.classList.add('is-interactive')
      this.el.addEventListener('mouseenter', () => this.cancelHide())
      this.el.addEventListener('mouseleave', () => this.hide())
    }
  }

  public setCompact(compact: boolean): void {
    if (compact) this.el.classList.add('is-compact')
    else this.el.classList.remove('is-compact')
  }

  public setInteractive(interactive: boolean): void {
    this.options.interactive = interactive
    if (interactive) this.el.classList.add('is-interactive')
    else this.el.classList.remove('is-interactive')
  }

  public show(target: HTMLElement, content: string | HTMLElement): void {
    // If we are moving between items, reset immediately to prevent stretching
    if (this.currentTarget && this.currentTarget !== target) {
      this.hideImmediately()
    }

    this.cancelHide()
    this.currentTarget = target

    if (typeof content === 'string') {
      this.el.innerHTML = content
    } else {
      this.el.innerHTML = ''
      this.el.appendChild(content)
    }

    // Force reflow/reset before positioning
    this.el.classList.remove('is-discrete')

    const rect = target.getBoundingClientRect()
    this.position(rect)

    this.el.classList.add('is-visible')
    this.visible = true
  }

  public hide(): void {
    if (this.hideTimer) return

    this.hideTimer = setTimeout(() => {
      this.el.classList.remove('is-visible')
      this.visible = false
      this.hideTimer = null
      this.currentTarget = null
    }, this.options.delay)
  }

  private hideImmediately(): void {
    this.cancelHide()
    this.el.classList.add('is-discrete')
    this.el.classList.remove('is-visible')
    this.visible = false
    this.currentTarget = null
  }

  public update(content: string | HTMLElement): void {
    if (!this.visible) return

    if (typeof content === 'string') {
      this.el.innerHTML = content
    } else {
      this.el.innerHTML = ''
      this.el.appendChild(content)
    }
  }

  private cancelHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  private position(rect: DOMRect): void {
    // 1. Measure dimensions after content is updated
    this.el.style.display = 'flex' // Ensure it's measurable
    const tooltipRect = this.el.getBoundingClientRect()

    // 2. Center above the target
    const targetCenterX = rect.left + rect.width / 2
    const targetTopY = rect.top

    const left = targetCenterX - tooltipRect.width / 2

    // 3. Bound checks (Horizontal)
    const padding = 12
    const minLeft = padding
    const maxLeft = window.innerWidth - tooltipRect.width - padding

    // Activity bar safe zone (usually on the left)
    const activityBarWidth = this.options.ignoreSafeZone ? 0 : 64
    const finalMinLeft = Math.max(minLeft, activityBarWidth)

    const clampedLeft = Math.max(finalMinLeft, Math.min(maxLeft, left))

    // 4. Update element style
    this.el.style.left = `${clampedLeft}px`
    this.el.style.bottom = `${window.innerHeight - targetTopY + 8}px`
    this.el.style.right = 'auto'

    // 5. Update arrow offset relative to the tooltip
    let arrowOffset = targetCenterX - clampedLeft

    // Smoothly clamp the knob inside the tooltip bounds (with 15px safe zones for rounded corners)
    arrowOffset = Math.max(15, Math.min(tooltipRect.width - 15, arrowOffset))

    this.el.style.setProperty('--tooltip-arrow-offset', `${arrowOffset}px`)
  }

  public destroy(): void {
    this.cancelHide()
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el)
    }
  }
}
