import { themes, Theme } from './themes'

export class ThemeManager {
  private currentTheme: Theme
  private activeKeys: Set<string> = new Set()

  constructor() {
    this.currentTheme = themes.dark // Default
    this.applyTheme()
  }

  setTheme(themeId: string): void {
    const theme = themes[themeId]
    if (!theme) {
      console.warn(`Theme ${themeId} not found, falling back to dark`)
      this.currentTheme = themes.dark
    } else {
      this.currentTheme = theme
    }

    this.applyTheme()
  }

  applyTheme(): void {
    const root = document.documentElement
    const colors = this.currentTheme.colors

    // Remove previously set theme variables
    this.activeKeys.forEach(key => {
      root.style.removeProperty(key)
    })
    this.activeKeys.clear()

    Object.entries(colors).forEach(([property, value]) => {
      if (value !== undefined) {
        root.style.setProperty(property, value)
        this.activeKeys.add(property)
      }
    })

    // Set a data-theme attribute on body for specific overrides if needed
    document.body.setAttribute('data-theme', this.currentTheme.id)
  }

  getCurrentThemeId(): string {
    return this.currentTheme.id
  }
}

export const themeManager = new ThemeManager()
