import { state } from '../../core/state'
import { tabService } from '../../services/tabService'
import type { NoteMeta, FolderItem } from '../../core/types'
import { getFolderIcon, codicons } from '../../utils/codicons'
import { sortTreeItems } from '../../utils/tree-utils'
import { contextMenu } from '../contextmenu/contextmenu'
import getFileIcon from '../../utils/fileIconMappers'
import {
  FolderPlus,
  FilePlus,
  ChevronRight,
  ChevronDown,
  FileText,
  Trash2,
  Copy,
  ExternalLink,
  Folder,
  Replace,
  ReplaceAll,
  createElement,
  Pencil,
  ClipboardCopy,
  Files,
  RefreshCw,
  ListCollapse
} from 'lucide'
import { setTooltip } from '../tooltip/tooltip'
import './sidebar-tree.css'
import { gitService } from '../../services/git/gitService'

interface SearchOptions {
  matchCase: boolean
  wholeWord: boolean
  useRegex: boolean
}

export class SidebarTree {
  private container: HTMLElement
  private bodyEl: HTMLElement
  private searchEl: HTMLInputElement
  private headerEl: HTMLElement
  private onNoteSelect?: (
    id: string,
    path?: string,
    highlightOptions?: {
      query: string
      matchCase?: boolean
      wholeWord?: boolean
      useRegex?: boolean
    }
  ) => void
  private onSearchChange?: (query: string, options: SearchOptions) => void
  private onNoteCreate?: (path?: string) => void
  private onNoteDelete?: (id: string, path?: string) => void
  private onNoteMove?: (id: string, fromPath?: string, toPath?: string) => Promise<void>
  private onFolderMove?: (sourcePath: string, targetPath: string) => Promise<void>
  private onItemsDelete?: (items: { id: string; type: 'note' | 'folder'; path?: string }[]) => void
  private onFolderCreate?: (parentPath?: string) => void
  private onRefresh?: () => void
  private editingId: string | null = null
  // private draggedItem: { type: 'note' | 'folder'; id: string; path?: string } | null = null
  private selectedFolderPath: string | null = null
  private selectedId: string | null = null
  private lastSelectedId: string | null = null
  private currentMode: 'explorer' | 'search' = 'explorer'
  private onVisibilityChange?: (visible: boolean) => void
  private onGraphClick?: () => void

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.container.classList.add('sidebar')
    this.render()

    this.headerEl = this.container.querySelector('.sidebar__header') as HTMLElement
    this.bodyEl = this.container.querySelector('.sidebar__body') as HTMLElement
    this.searchEl = this.container.querySelector('#searchInput') as HTMLInputElement

    this.attachEvents()
    this.attachBackdropListener()

    // Listen for Git status changes
    window.addEventListener('git-status-changed', () => {
      if (this.currentMode === 'explorer') {
        this.renderTree(this.searchEl.value)
      }
    })
  }

  setGraphClickHandler(handler: () => void): void {
    this.onGraphClick = handler
  }

  private attachBackdropListener(): void {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (!shell) return

    shell.addEventListener('click', (e) => {
      // Check if we are in mobile mode
      const isMobile = window.matchMedia('(max-width: 900px)').matches
      if (!isMobile) return

      // Check if sidebar is open (not hidden)
      if (shell.classList.contains('sidebar-hidden')) return

      // Check if click target is the shell (which receives backdrop clicks)
      // and NOT inside the sidebar or activity bar
      const target = e.target as HTMLElement
      if (target.classList.contains('vscode-shell')) {
        this.hide()
      }
    })
  }

  setNoteSelectHandler(
    handler: (
      id: string,
      path?: string,
      highlight?: { query: string; matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean }
    ) => void
  ): void {
    this.onNoteSelect = (id, path, highlight) => {
      // Capture if we currently have focus in the list
      const hadFocus = this.bodyEl.contains(document.activeElement)

      this.selectedId = id
      this.updateSelection(id)

      if (hadFocus) {
        // Restore focus immediately to maintain keyboard flow
        this.scrollToActive(true)
      }

      handler(id, path, highlight)
    }
  }

  setNoteCreateHandler(handler: (path?: string) => void): void {
    this.onNoteCreate = handler
  }

  setNoteDeleteHandler(handler: (id: string, path?: string) => void): void {
    this.onNoteDelete = handler
  }

  setNoteMoveHandler(
    handler: (id: string, fromPath?: string, toPath?: string) => Promise<void>
  ): void {
    this.onNoteMove = handler
  }

  setFolderMoveHandler(handler: (sourcePath: string, targetPath: string) => Promise<void>): void {
    this.onFolderMove = handler
  }

  setItemsDeleteHandler(
    handler: (items: { id: string; type: 'note' | 'folder'; path?: string }[]) => void
  ): void {
    this.onItemsDelete = handler
  }

  setFolderCreateHandler(handler: (parentPath?: string) => void): void {
    this.onFolderCreate = handler
  }

  setRefreshHandler(handler: () => void): void {
    this.onRefresh = handler
  }

  setSearchHandler(handler: (query: string, options: SearchOptions) => void): void {
    this.onSearchChange = handler
  }

  setVisibilityChangeHandler(handler: (visible: boolean) => void): void {
    this.onVisibilityChange = handler
  }

  toggle(): void {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (!shell) return
    shell.classList.toggle('sidebar-hidden')
    this.onVisibilityChange?.(!shell.classList.contains('sidebar-hidden'))
  }

  hide(): void {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (!shell) return
    shell.classList.add('sidebar-hidden')
    this.onVisibilityChange?.(false)
  }

  show(): void {
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (!shell) return
    shell.classList.remove('sidebar-hidden')
    this.onVisibilityChange?.(true)
  }

  setSearchQuery(query: string): void {
    // We might need to switch to search mode first if we're not in it
    if (this.currentMode !== 'search') {
      this.setMode('search')
    }

    // Small delay to ensure the search input is rendered by setMode
    setTimeout(() => {
      const input = this.container.querySelector('#global-search-input') as HTMLInputElement
      if (input) {
        input.value = query
        input.dispatchEvent(new Event('input'))
        input.focus()
      }
    }, 50)
  }

  setVisible(visible: boolean): void {
    if (visible) this.show()
    else this.hide()
  }

  setMode(mode: 'explorer' | 'search'): void {
    this.currentMode = mode
    // Basic implementation of mode switching
    // Ideally we should have separate containers but for now we manipulate visibility

    // Update title
    const titleEl = this.container.querySelector('.sidebar__title-text')
    if (titleEl) {
      titleEl.textContent = mode === 'search' ? 'SEARCH' : 'EXPLORER'
    }

    // Toggle actions visibility
    const actionsEl = this.container.querySelector('.sidebar__actions') as HTMLElement
    if (actionsEl) {
      actionsEl.style.display = mode === 'search' ? 'none' : 'flex'
    }

    // Identify elements
    // The tree container is .sidebar__body in render(), NOT .note-list
    const treeBody = this.container.querySelector('.sidebar__body') as HTMLElement

    // The filter input container (for explorer)
    // It's the .sidebar__search that contains #searchInput
    const filterInput = this.container.querySelector('#searchInput')
    const filterContainer = filterInput
      ? (filterInput.closest('.sidebar__search') as HTMLElement)
      : null

    let searchBody = this.container.querySelector('.sidebar__search-container') as HTMLElement
    if (!searchBody && mode === 'search') {
      const replaceAllIcon = this.createLucideIcon(ReplaceAll, 14)
      const replaceNextIcon = this.createLucideIcon(Replace, 14)
      const chevronRightIcon = this.createLucideIcon(ChevronRight, 14)

      const searchMarkup = `
         <div class="sidebar__search-container">
            <div class="sidebar__search-layout">
              <button id="toggle-replace" class="sidebar__action toggle-replace-btn">
                ${chevronRightIcon}
              </button>
              <div class="sidebar__search-fields">
                <div class="sidebar__search-item">
                  <div class="sidebar__search-input-wrapper">
                      <div class="sidebar__actions-left">
                        <button class="sidebar__action search-option" data-option="matchCase" title="Match Case">Ab</button>
                        <button class="sidebar__action search-option" data-option="wholeWord" title="Match Whole Word">W</button>
                        <button class="sidebar__action search-option" data-option="useRegex" title="Use Regular Expression">.*</button>
                      </div>
                      <input type="text" placeholder="Search" id="global-search-input" autocomplete="off">
                  </div>
                </div>
                <div id="replace-container" class="sidebar__replace-container">
                  <div class="sidebar__search-input-wrapper replace-input-wrapper">
                      <div class="sidebar__actions-left">
                        <button id="replace-next-btn" class="sidebar__action replace-btn" title="Replace Next">
                          ${replaceNextIcon}
                        </button>
                        <button id="replace-all-btn" class="sidebar__action replace-btn" title="Replace All">
                          ${replaceAllIcon}
                        </button>
                      </div>
                      <input type="text" placeholder="Replace" id="global-replace-input" autocomplete="off">
                  </div>
                </div>
              </div>
            </div>
         </div>
      `
      this.container.querySelector('.sidebar__header')?.insertAdjacentHTML('afterend', searchMarkup)
      searchBody = this.container.querySelector('.sidebar__search-container') as HTMLElement

      this.setupSearch(searchBody, treeBody)
    }

    if (mode === 'search') {
      if (treeBody) {
        treeBody.style.display = 'block'
        treeBody.innerHTML = '' // Clear existing tree
      }
      if (filterContainer) filterContainer.style.display = 'none'
      if (searchBody) searchBody.style.display = 'flex'

      const input = searchBody.querySelector('#global-search-input') as HTMLInputElement
      if (input) {
        setTimeout(() => {
          input.focus()
          if (input.value) input.dispatchEvent(new Event('input'))
        }, 100)
      }
    } else {
      if (treeBody) {
        treeBody.style.display = 'block'
        // Re-render Explorer tree since search mode clears the body
        this.renderTree(this.searchEl.value)
      }
      if (filterContainer) filterContainer.style.display = 'block'
      if (searchBody) searchBody.style.display = 'none'

      // Clear editor highlights when leaving search mode
      if (this.onSearchChange) {
        this.onSearchChange('', { matchCase: false, wholeWord: false, useRegex: false })
      }
    }
  }

  private setupSearch(searchBody: HTMLElement, results: HTMLElement): void {
    const toggleBtn = searchBody.querySelector('#toggle-replace') as HTMLElement
    const replaceContainer = searchBody.querySelector('#replace-container') as HTMLElement
    const searchInput = searchBody.querySelector('#global-search-input') as HTMLInputElement
    const replaceInput = searchBody.querySelector('#global-replace-input') as HTMLInputElement
    const replaceAllBtn = searchBody.querySelector('#replace-all-btn') as HTMLElement
    const clearReplaceBtn = searchBody.querySelector('#clear-replace') as HTMLElement

    let isReplaceVisible = false
    let lastResults: (NoteMeta & { content: string })[] = []
    let searchRequestId = 0
    let searchTimeout: any = null

    const searchOptions: SearchOptions = {
      matchCase: false,
      wholeWord: false,
      useRegex: false
    }

    const performSearch = async (immediate = false): Promise<void> => {
      const query = searchInput.value.trim()
      if (!query) {
        results.innerHTML = ''
        lastResults = []
        if (this.onSearchChange) {
          this.onSearchChange('', { matchCase: false, wholeWord: false, useRegex: false })
        }
        return
      }

      const currentId = ++searchRequestId
      if (searchTimeout) window.clearTimeout(searchTimeout)

      const execute = async () => {
        try {
          const resultsData = (await window.api.searchNotes(query, searchOptions)) as (NoteMeta & {
            content: string
          })[]

          if (currentId !== searchRequestId) return

          lastResults = resultsData
          if (lastResults.length === 0) {
            results.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; color: var(--muted); text-align: center;">
                  <div style="font-size: 14px; margin-bottom: 8px;">No results found</div>
                  <div style="font-size: 12px; opacity: 0.7;">Try different keywords or check your search options.</div>
                </div>
              `
          } else {
            renderResults(lastResults, query)
          }
        } catch (err) {
          console.error('[Search] Error:', err)
          if (currentId === searchRequestId) {
            results.innerHTML = `<div style="text-align:center;margin-top:20px;color:var(--danger);">Search failed</div>`
          }
        }
      }

      if (immediate) {
        await execute()
      } else {
        searchTimeout = setTimeout(execute, 150)
      }

      // Live highlighting in the editor
      if (this.onSearchChange) {
        this.onSearchChange(query, searchOptions)
      }
    }

    const renderResults = (notes: (NoteMeta & { content: string })[], query: string): void => {
      const highlight = (text: string, q: string): string => {
        if (!q) return text
        try {
          let pattern = q
          if (!searchOptions.useRegex) {
            pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            if (searchOptions.wholeWord) pattern = `\\b${pattern}\\b`
          }
          const regex = new RegExp(pattern, searchOptions.matchCase ? 'g' : 'gi')
          return text.replace(
            regex,
            (m) =>
              `<mark style="background:#cc990060;color:inherit;padding:0 1px;border-radius:1px;border-bottom:1px solid #cc9900;">${m}</mark>`
          )
        } catch (err) {
          console.error('[Search] Highlight error:', err)
          return text
        }
      }

      results.innerHTML = `
          <div class="search-results-list">
            <div class="search-results-summary">
              ${notes.length} ${notes.length === 1 ? 'file' : 'files'} found
            </div>
            ${notes
              .map((n) => {
                const title = highlight(n.title || n.id, query)
                let snippet = n.content || ''

                let pattern = query
                if (!searchOptions.useRegex) {
                  pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                  if (searchOptions.wholeWord) pattern = `\\b${pattern}\\b`
                }
                const regex = new RegExp(pattern, searchOptions.matchCase ? '' : 'i')
                const matchIndex = snippet.search(regex)

                if (matchIndex !== -1) {
                  const start = Math.max(0, matchIndex - 40)
                  const end = Math.min(snippet.length, matchIndex + 80)
                  snippet =
                    (start > 0 ? '...' : '') +
                    highlight(snippet.slice(start, end), query) +
                    (end < snippet.length ? '...' : '')
                } else {
                  snippet = highlight(snippet.slice(0, 100), query)
                }

                return `
                <div class="search-file-group">
                   <header class="search-file-header" data-id="${n.id}">
                      <span class="search-file-icon">${getFileIcon(n.title || n.id, n.path || n.title)}</span>
                      <span class="search-file-title">${title}</span>
                      <span class="search-file-path">${n.path || ''}</span>
                   </header>
                   <div class="search-file-matches">
                      <div class="search-result-item" data-id="${n.id}" data-path="${n.path || ''}" tabindex="0">
                        <span class="search-result-snippet">${snippet}</span>
                      </div>
                   </div>
                </div>
              `
              })
              .join('')}
          </div>
        `

      results.querySelectorAll('.search-result-item').forEach((itemEl, idx) => {
        itemEl.addEventListener('click', () => {
          const note = notes[idx]
          if (this.onNoteSelect) {
            this.onNoteSelect(note.id, note.path, {
              query,
              matchCase: searchOptions.matchCase,
              wholeWord: searchOptions.wholeWord,
              useRegex: searchOptions.useRegex
            })
          }
        })

        itemEl.addEventListener('mouseenter', () => {
          ;(itemEl as HTMLElement).style.background = 'var(--hover)'
        })
        itemEl.addEventListener('mouseleave', () => {
          ;(itemEl as HTMLElement).style.background = 'transparent'
        })
      })
    }

    const performReplaceAll = async (): Promise<void> => {
      if (!searchInput.value || !lastResults.length) return

      try {
        let pattern = searchInput.value
        if (!searchOptions.useRegex) {
          pattern = searchInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          if (searchOptions.wholeWord) pattern = `\\b${pattern}\\b`
        }
        const regex = new RegExp(pattern, searchOptions.matchCase ? 'g' : 'gi')

        for (const note of lastResults) {
          const newContent = note.content.replace(regex, replaceInput.value)
          await window.api.saveNote({ ...note, content: newContent })

          // Live update if this note is active
          if (state.activeId === note.id && this.onNoteSelect) {
            this.onNoteSelect(note.id, note.path, {
              query: searchInput.value,
              matchCase: searchOptions.matchCase,
              wholeWord: searchOptions.wholeWord,
              useRegex: searchOptions.useRegex
            })
          }
        }
        await performSearch(true)
      } catch (err) {
        console.error('[ReplaceAll] Failed:', err)
      }
    }

    const performReplaceNext = async (): Promise<void> => {
      if (!searchInput.value || !lastResults.length) return

      try {
        // Find the first occurrence in the first note that has a match
        // Since lastResults contains notes that *have* matches, we just pick the first one.
        const note = lastResults[0]

        let pattern = searchInput.value
        if (!searchOptions.useRegex) {
          pattern = searchInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          if (searchOptions.wholeWord) pattern = `\\b${pattern}\\b`
        }

        // For distinct "one by one", we replace ONLY the first match in this file.
        // If we want to support "next match" across the same file, we'd need to track index.
        // For simplicity in this implementation: replace the first match found in the first file.
        // The user can keep clicking this to work through the file, then the next file.
        const regex = new RegExp(pattern, searchOptions.matchCase ? '' : 'i') // No global flag

        const newContent = note.content.replace(regex, replaceInput.value)
        note.content = newContent

        await window.api.saveNote({ ...note, content: newContent })

        if (state.activeId === note.id && this.onNoteSelect) {
          this.onNoteSelect(note.id, note.path, {
            query: searchInput.value,
            matchCase: searchOptions.matchCase,
            wholeWord: searchOptions.wholeWord,
            useRegex: searchOptions.useRegex
          })
        }

        await performSearch(true)
      } catch (err) {
        console.error('[ReplaceNext] Failed:', err)
      }
    }

    toggleBtn.addEventListener('click', () => {
      isReplaceVisible = !isReplaceVisible
      replaceContainer.style.display = isReplaceVisible ? 'flex' : 'none'

      if (!isReplaceVisible) {
        replaceInput.value = ''
      }

      const chevronRightIcon = this.createLucideIcon(ChevronRight, 14)
      const chevronDownIcon = this.createLucideIcon(ChevronDown, 14)
      toggleBtn.innerHTML = isReplaceVisible ? chevronDownIcon : chevronRightIcon
      if (isReplaceVisible) setTimeout(() => replaceInput.focus(), 50)
    })

    if (replaceAllBtn) {
      replaceAllBtn.addEventListener('click', () => void performReplaceAll())
    }

    const replaceNextBtn = searchBody.querySelector('#replace-next-btn') as HTMLElement
    if (replaceNextBtn) {
      replaceNextBtn.addEventListener('click', () => void performReplaceNext())
    }

    searchInput.addEventListener('input', () => {
      selectedIndex = 0
      void performSearch()
    })

    const handleSearchKeydown = (e: KeyboardEvent): void => {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
        results.dispatchEvent(new KeyboardEvent('keydown', e))
        e.preventDefault()
      }
      if (e.key === 'Escape') {
        const input = e.target as HTMLInputElement
        if (input.value) {
          input.value = ''
          input.dispatchEvent(new Event('input'))
          e.stopPropagation()
        }
      }
    }

    searchInput.addEventListener('keydown', handleSearchKeydown)
    replaceInput.addEventListener('keydown', handleSearchKeydown)

    replaceInput.addEventListener('input', () => {
      if (clearReplaceBtn) {
        clearReplaceBtn.style.display = replaceInput.value ? 'block' : 'none'
      }
    })

    if (clearReplaceBtn) {
      clearReplaceBtn.addEventListener('click', () => {
        replaceInput.value = ''
        clearReplaceBtn.style.display = 'none'
        replaceInput.focus()
      })
    }

    replaceAllBtn.addEventListener('click', () => {
      void performReplaceAll()
    })

    let selectedIndex = 0
    results?.addEventListener('keydown', (e) => {
      const items = Array.from(results.querySelectorAll('.search-result-item')) as HTMLElement[]
      if (items.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectedIndex = (selectedIndex + 1) % items.length
        items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex))
        items[selectedIndex].scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectedIndex = (selectedIndex - 1 + items.length) % items.length
        items.forEach((el, i) => el.classList.toggle('selected', i === selectedIndex))
        items[selectedIndex].scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[selectedIndex]
        if (item) {
          const id = item.dataset.id
          const path = item.dataset.path || undefined
          if (id && this.onNoteSelect) {
            this.onNoteSelect(id, path, {
              query: searchInput.value,
              matchCase: searchOptions.matchCase,
              wholeWord: searchOptions.wholeWord,
              useRegex: searchOptions.useRegex
            })
          }
        }
      }
    })

    searchBody.querySelectorAll('.search-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const option = (btn as HTMLElement).dataset.option as keyof typeof searchOptions
        searchOptions[option] = !searchOptions[option]
        btn.classList.toggle('active', searchOptions[option])
        ;(btn as HTMLElement).style.background = searchOptions[option]
          ? 'var(--selection)'
          : 'transparent'
        ;(btn as HTMLElement).style.color = searchOptions[option]
          ? 'var(--text-strong)'
          : 'var(--text-soft)'
        void performSearch()
      })
    })
  }

  isEditing(): boolean {
    return this.editingId !== null
  }

  private createLucideIcon(
    IconComponent: any,
    size: number = 16,
    strokeWidth: number = 1.5
  ): string {
    const svgElement = createElement(IconComponent, {
      size,
      'stroke-width': strokeWidth,
      stroke: 'currentColor',
      fill: 'none'
    })
    return svgElement.outerHTML
  }

  private render(): void {
    const newFileIcon = this.createLucideIcon(FilePlus, 15, 1.8)
    const newFolderIcon = this.createLucideIcon(FolderPlus, 15, 1.8)
    const refreshIcon = this.createLucideIcon(RefreshCw, 15, 1.8)
    const collapseIcon = this.createLucideIcon(ListCollapse, 15, 1.8)

    this.container.innerHTML = `
      <header class="sidebar__header">
        <div class="sidebar__title">
          <span class="sidebar__title-text">EXPLORER</span>
        </div>
        <div class="sidebar__actions">
          <button class="sidebar__action" data-tooltip="New Note (Ctrl+N)" data-action="new">
            ${newFileIcon}
          </button>
          <button class="sidebar__action" data-tooltip="New Folder" data-action="new-folder">
            ${newFolderIcon}
          </button>
          <button class="sidebar__action" data-tooltip="Refresh Vault" data-action="refresh">
            ${refreshIcon}
          </button>
          <button class="sidebar__action" data-tooltip="${state.expandedFolders.size > 0 ? 'Collapse All Folders' : 'Expand All Folders'}" data-action="collapse-all">
            ${collapseIcon}
          </button>
        </div>
      </header>

      <div class="sidebar__search">
        <input id="searchInput" type="search" placeholder="Search..." aria-label="Search notes" />
      </div>

      <div class="sidebar__body" tabindex="-1"></div>

      <footer class="sidebar__footer"></footer>
    `

    this.applyStyles()
  }

  public applyStyles(): void {
    const styles = state.settings?.sidebar
    if (styles) {
      if (styles.backgroundColor)
        this.container.style.setProperty('--sidebar-bg', styles.backgroundColor, 'important')
      else this.container.style.removeProperty('--sidebar-bg')

      if (styles.borderColor)
        this.container.style.setProperty('--sidebar-border', styles.borderColor, 'important')
      else this.container.style.removeProperty('--sidebar-border')

      if (styles.textColor)
        this.container.style.setProperty('--sidebar-text', styles.textColor, 'important')
      else this.container.style.removeProperty('--sidebar-text')

      if (styles.activeItemColor)
        this.container.style.setProperty('--sidebar-active-bg', styles.activeItemColor, 'important')
      else this.container.style.removeProperty('--sidebar-active-bg')

      if (styles.activeTextColor)
        this.container.style.setProperty(
          '--sidebar-active-text',
          styles.activeTextColor,
          'important'
        )
      else this.container.style.removeProperty('--sidebar-active-text')

      if (styles.fontSize)
        this.container.style.setProperty('--sidebar-font-size', `${styles.fontSize}px`, 'important')
      else this.container.style.removeProperty('--sidebar-font-size')
    } else {
      this.container.style.removeProperty('--sidebar-bg')
      this.container.style.removeProperty('--sidebar-border')
      this.container.style.removeProperty('--sidebar-text')
      this.container.style.removeProperty('--sidebar-active-bg')
      this.container.style.removeProperty('--sidebar-active-text')
      this.container.style.removeProperty('--sidebar-font-size')
    }
  }

  renderTree(filter = ''): void {
    this.applyStyles()
    // If we're in search mode, don't let the explorer tree overwrite our results.
    // We check both our internal state and the actual UI state for robustness.
    const isSearchActive =
      this.currentMode === 'search' ||
      document
        .querySelector('.activitybar__item[data-view="search"]')
        ?.classList.contains('is-active')

    if (isSearchActive) return

    const term = filter.trim().toLowerCase()

    this.bodyEl.innerHTML = ''

    // Create inner container for proper focus/scroll separation (VS Code style)
    const innerContainer = document.createElement('div')
    innerContainer.className = 'sidebar__body-inner'

    // Ensure state.tree is valid before processing
    if (!state.tree) {
      this.bodyEl.appendChild(innerContainer)
      return
    }

    const items = term.length ? this.filterTree(state.tree, term) : this.sortTree(state.tree)

    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sidebar__empty'
      empty.textContent = term.length ? 'No matches' : 'No notes or folders yet'
      innerContainer.appendChild(empty)
      this.bodyEl.appendChild(innerContainer)
      return
    }

    this.renderItems(items, innerContainer, 1)
    this.bodyEl.appendChild(innerContainer)

    const collapseBtn = this.headerEl?.querySelector('[data-action="collapse-all"]') as HTMLElement
    if (collapseBtn) {
      setTooltip(collapseBtn, state.expandedFolders.size > 0 ? 'Collapse All Folders' : 'Expand All Folders')
    }
  }

  private sortTree(items: (FolderItem | NoteMeta)[]): (FolderItem | NoteMeta)[] {
    return sortTreeItems(items)
  }

  private filterTree(items: (FolderItem | NoteMeta)[], term: string): (FolderItem | NoteMeta)[] {
    const result: (FolderItem | NoteMeta)[] = []

    for (const item of items) {
      if (item.type === 'folder') {
        // It's a folder
        const folder = item as FolderItem
        const matchesSelf = (folder.title || '').toLowerCase().includes(term)
        const children = folder.children || []
        const filteredChildren = this.filterTree(children, term)

        if (matchesSelf || filteredChildren.length > 0) {
          result.push({
            ...folder,
            children: filteredChildren
          })
        }
      } else {
        // It's a note
        if ((item.title || '').toLowerCase().includes(term)) {
          result.push(item)
        }
      }
    }

    return this.sortTree(result)
  }

  private renderItems(
    items: (FolderItem | NoteMeta)[],
    container: HTMLElement,
    depth: number
  ): void {
    for (const item of items) {
      if (item.type === 'folder') {
        this.renderFolder(item as FolderItem, container, depth)
      } else {
        this.renderNote(item as NoteMeta, container, depth)
      }
    }
  }

  private renderFolder(folder: FolderItem, container: HTMLElement, depth: number): void {
    const isFiltered = this.searchEl.value.trim().length > 0
    const isExpanded = isFiltered || state.expandedFolders.has(folder.id)
    const isActive = this.selectedId === folder.id
    const isSelected = state.selectedIds.has(folder.id)

    // Check for git status in this folder or its children
    const gitStatus = this.getFolderGitStatus(folder)

    const el = document.createElement('div')
    el.className = `tree-item tree-item--folder${isExpanded ? ' is-expanded' : ''}${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`
    if (gitStatus !== 'none') {
      el.classList.add(`git-status--${gitStatus}`)
      el.dataset.gitStatus = gitStatus
    }

    el.dataset.id = folder.id
    el.dataset.type = 'folder'
    if (folder.path) el.dataset.path = folder.path
    el.dataset.depth = String(depth)
    const fullFolderPath = state.vaultPath ? `${state.vaultPath}/${folder.id}` : folder.id
    if (fullFolderPath) {
      setTooltip(el, fullFolderPath.replace(/\\/g, '/'))
    }
    el.draggable = true
    el.tabIndex = 0

    // Add indentation guides
    for (let i = 0; i < depth; i++) {
      const guide = document.createElement('span')
      guide.className = 'tree-item__indent-guide'
      el.appendChild(guide)
    }

    const arrow = document.createElement('span')
    arrow.className = 'tree-item__expand sidebar__icon'
    arrow.innerHTML = isExpanded ? codicons.chevronDown : codicons.chevronRight

    const icon = document.createElement('span')
    icon.className = 'tree-item__icon sidebar__icon'
    icon.innerHTML = getFolderIcon(folder.title)
    // Add folder type for CSS styling
    const folderType = this.getFolderType(folder.title)
    if (folderType) {
      icon.dataset.folderType = folderType
      el.dataset.folderType = folderType
    }

    const label = document.createElement('span')
    label.className = 'tree-item__label'
    label.textContent = folder.title
    label.dataset.itemId = folder.id

    el.appendChild(arrow)
    el.appendChild(icon)
    el.appendChild(label)
    container.appendChild(el)

    if (isExpanded && folder.children) {
      this.renderItems(this.sortTree(folder.children), container, depth + 1)
    }
  }

  private renderNote(note: NoteMeta, container: HTMLElement, depth: number): void {
    const isActive = this.selectedId === note.id
    const isSelected = state.selectedIds.has(note.id)

    // Check for git status
    const gitStatus = gitService.getStatus(note.id)

    const el = document.createElement('div')
    el.className = `tree-item tree-item--note${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`
    if (gitStatus !== 'none') {
      el.classList.add(`git-status--${gitStatus}`)
      el.dataset.gitStatus = gitStatus
    }

    el.dataset.id = note.id
    el.dataset.type = 'note'
    if (note.path) el.dataset.path = note.path
    el.dataset.depth = String(depth)
    const relativePath = note.path || note.id
    const fullNotePath = state.vaultPath ? `${state.vaultPath}/${relativePath}` : relativePath
    if (fullNotePath) {
      setTooltip(el, fullNotePath.replace(/\\/g, '/'))
    }
    el.draggable = true
    el.tabIndex = 0

    // Add indentation guides
    for (let i = 0; i < depth; i++) {
      const guide = document.createElement('span')
      guide.className = 'tree-item__indent-guide'
      el.appendChild(guide)
    }

    const spacer = document.createElement('span')
    spacer.className = 'tree-item__expand sidebar__icon'

    const icon = document.createElement('span')
    icon.className = 'tree-item__icon sidebar__icon'
    const extension = note.title.split('.').pop() || 'markdown'
    icon.innerHTML = getFileIcon(note.title, extension)
    // Add note type for CSS styling
    const noteType = this.getNoteType(note.title)
    if (noteType) {
      icon.dataset.noteType = noteType
      el.dataset.noteType = noteType
    }

    const isDirty = state.isDirty && state.activeId === note.id

    const label = document.createElement('span')
    label.className = 'tree-item__label'
    label.textContent = (note.title || '').replace(/\.md$/i, '')
    label.dataset.noteId = note.id

    el.appendChild(spacer)
    el.appendChild(icon)
    el.appendChild(label)

    if (isDirty) {
      const dot = document.createElement('span')
      dot.className = 'tree-item__dirty-dot'
      el.appendChild(dot)
    }

    container.appendChild(el)
  }

  private attachEvents(): void {
    // Header actions
    this.headerEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const button = target.closest('.sidebar__action') as HTMLElement
      if (!button) return

      const action = button.dataset.action
      if (action === 'new') {
        this.onNoteCreate?.(this.getDefaultParentPath())
      } else if (action === 'new-folder') {
        this.onFolderCreate?.(this.getDefaultParentPath())
      } else if (action === 'refresh') {
        this.onRefresh?.()
      } else if (action === 'collapse-all') {
        this.toggleCollapseAll()
      } else if (action === 'reveal') {
        void window.api.revealVault(state.activeId || undefined)
      } else if (action === 'graph') {
        this.onGraphClick?.()
      }
    })

    // Search
    this.searchEl.addEventListener('input', () => {
      this.renderTree(this.searchEl.value)
    })

    this.searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.searchEl.value) {
          this.searchEl.value = ''
          this.renderTree('')
          e.stopPropagation()
        } else {
          this.searchEl.blur()
        }
      }
    })

    // Tree item click
    this.bodyEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const item = target.closest('.tree-item') as HTMLElement

      if (!item) {
        // Background click - Select Root
        this.selectedId = null
        this.selectedFolderPath = null
        state.selectedIds.clear()
        this.lastSelectedId = null
        this.updateSelectionStates()
        this.bodyEl.focus()
        return
      }

      // Expand/collapse on chevron click
      if (target.classList.contains('tree-item__expand') || target.closest('.tree-item__expand')) {
        event.stopPropagation()
        if (item.dataset.type === 'folder') {
          this.selectedId = item.dataset.id!
          this.selectedFolderPath = item.dataset.id!
          this.updateSelectionStates()
          this.toggleFolder(item.dataset.id!)
        }
        return
      }

      // Don't trigger if clicking on label while editing
      if (this.editingId === item.dataset.id && target.classList.contains('tree-item__label')) {
        event.stopPropagation()
        return
      }

      // Stop propagation for selection clicks too
      event.stopPropagation()

      const id = item.dataset.id!
      const isMultiSelect = event.ctrlKey || event.metaKey
      const isRangeSelect = event.shiftKey

      if (isRangeSelect && this.lastSelectedId) {
        // Range selection
        const items = Array.from(this.bodyEl.querySelectorAll('.tree-item')) as HTMLElement[]
        const startIdx = items.findIndex((el) => el.dataset.id === this.lastSelectedId)
        const endIdx = items.findIndex((el) => el.dataset.id === id)

        if (startIdx !== -1 && endIdx !== -1) {
          const [minIdx, maxIdx] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)]
          if (!isMultiSelect) state.selectedIds.clear()

          for (let i = minIdx; i <= maxIdx; i++) {
            const itemId = items[i].dataset.id
            if (itemId) state.selectedIds.add(itemId)
          }
        }
      } else if (isMultiSelect) {
        // Toggle individual item
        if (state.selectedIds.has(id)) {
          state.selectedIds.delete(id)
        } else {
          state.selectedIds.add(id)
        }
      } else {
        // Single selection
        state.selectedIds.clear()
        state.selectedIds.add(id)
      }

      this.lastSelectedId = id

      // Update visual selection regardless of modifiers
      if (item.dataset.type === 'note') {
        this.selectedId = id
        this.selectedFolderPath = item.dataset.path || null
        this.updateSelectionStates()
        if (!isMultiSelect && !isRangeSelect) {
          this.onNoteSelect?.(id, item.dataset.path || undefined)
        }
      } else if (item.dataset.type === 'folder') {
        this.selectedId = id
        this.selectedFolderPath = id
        this.updateSelectionStates()
        if (!isMultiSelect && !isRangeSelect) {
          // Toggle folder only on single click (or maybe double click is better? but current logic does it on single click)
          // Actually, the previous logic was: if folder, toggle.
          // Let's keep it for now but maybe it's annoying with multi-selection.
          this.toggleFolder(id)
        }
      }
    })

    // Background Context Menu
    this.bodyEl.addEventListener('contextmenu', (event) => {
      const target = event.target as HTMLElement
      const item = target.closest('.tree-item') as HTMLElement

      if (!item) {
        event.preventDefault()
        const newNoteIcon = this.createLucideIcon(FileText, 14, 1.5)
        const newFolderIcon = this.createLucideIcon(FolderPlus, 14, 1.5)
        const revealIcon = this.createLucideIcon(ExternalLink, 14, 1.5)

        contextMenu.show(event.clientX, event.clientY, [
          {
            label: 'New Note',
            icon: newNoteIcon,
            keybinding: 'Ctrl+N',
            onClick: () => this.onNoteCreate?.(this.getDefaultParentPath())
          },
          {
            label: 'New Folder',
            icon: newFolderIcon,
            onClick: () => this.onFolderCreate?.(this.getDefaultParentPath())
          },
          { separator: true },
          {
            label: 'Reveal in Explorer',
            icon: revealIcon,
            onClick: () => window.api.revealVault?.()
          }
        ])
        return
      }

      event.preventDefault()
      this.showContextMenu(event, item)
    })

    // Double-click to rename - now triggers Modal
    this.bodyEl.addEventListener('dblclick', (event) => {
      const target = event.target as HTMLElement
      const label = target.closest('.tree-item__label') as HTMLElement
      if (!label) return

      const item = target.closest('.tree-item') as HTMLElement
      const id = item?.dataset.id
      const type = item?.dataset.type as 'note' | 'folder'
      if (id && type) {
        window.dispatchEvent(
          new CustomEvent('knowledge-hub:rename-item', {
            detail: { id, type, title: label.textContent?.trim() }
          })
        )
      }
    })

    // Drag and drop events
    this.bodyEl.addEventListener('dragstart', this.handleDragStart.bind(this))
    this.bodyEl.addEventListener('dragover', this.handleDragOver.bind(this))
    this.bodyEl.addEventListener('dragleave', this.handleDragLeave.bind(this))
    this.bodyEl.addEventListener('drop', this.handleDrop.bind(this))
    this.bodyEl.addEventListener('dragend', this.handleDragEnd.bind(this))

    // Keyboard
    this.bodyEl.addEventListener('keydown', this.handleKeyboard.bind(this))

    // Inline rename handlers (blur/enter/escape)
    this.bodyEl.addEventListener(
      'blur',
      (event) => {
        const label = event.target as HTMLElement
        if (!label.classList.contains('tree-item__label')) return
        if (!label.contentEditable || label.contentEditable === 'false') return
        void this.finishRename(label)
      },
      true
    )

    this.bodyEl.addEventListener('keydown', (event) => {
      const label = event.target as HTMLElement
      if (!label.classList.contains('tree-item__label')) return
      if (!label.contentEditable || label.contentEditable === 'false') return

      if (event.key === 'Enter') {
        event.preventDefault()
        void this.finishRename(label)
        label.blur()
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        const itemId = label.dataset.itemId || label.dataset.noteId
        if (itemId) state.newlyCreatedIds.delete(itemId) // Clear priority on cancel too

        const original = label.dataset.originalTitle || ''
        label.textContent = original
        label.contentEditable = 'false'
        label.classList.remove('is-editing')
        this.editingId = null

        window.dispatchEvent(new CustomEvent('vault-changed'))
        label.blur()
      }
    })
  }

  private toggleFolder(id: string): void {
    if (state.expandedFolders.has(id)) {
      state.expandedFolders.delete(id)
    } else {
      state.expandedFolders.add(id)
    }
    this.renderTree(this.searchEl.value)

    // Save expanded folders state
    void window.api.updateSettings({
      expandedFolders: Array.from(state.expandedFolders)
    })

    // Restore focus to the toggled folder
    setTimeout(() => {
      const newItem = this.bodyEl.querySelector(`.tree-item[data-id="${id}"]`) as HTMLElement
      newItem?.focus()
    }, 0)
  }

  private toggleCollapseAll(): void {
    if (state.expandedFolders.size > 0) {
      state.expandedFolders.clear()
    } else {
      const collectFolderIds = (items: (FolderItem | NoteMeta)[]): void => {
        items.forEach((item) => {
          if (item.type === 'folder') {
            state.expandedFolders.add(item.id)
            if ((item as FolderItem).children) collectFolderIds((item as FolderItem).children!)
          }
        })
      }
      if (state.tree) collectFolderIds(state.tree)
    }
    void window.api.updateSettings({
      expandedFolders: Array.from(state.expandedFolders)
    })
    this.renderTree(this.searchEl.value)
  }

  private handleDragStart(event: DragEvent): void {
    const target = event.target as HTMLElement
    const item = target.closest('.tree-item') as HTMLElement
    if (!item) return

    const id = item.dataset.id!

    // If dragging an item not in selection, select it first
    if (!state.selectedIds.has(id)) {
      state.selectedIds.clear()
      state.selectedIds.add(id)
      this.selectedId = id
      this.updateSelectionStates()
    }

    const itemsToDrag: { id: string; type: 'note' | 'folder'; path?: string }[] = Array.from(
      state.selectedIds
    )
      .map((dragId) => {
        const el = this.bodyEl.querySelector(`.tree-item[data-id="${dragId}"]`) as HTMLElement
        return {
          id: dragId,
          type: el?.dataset.type as 'note' | 'folder',
          path: el?.dataset.path || undefined
        }
      })
      .filter((i) => i.type)

    if (itemsToDrag.length === 0)
      return // Store items in a global variable as backup since dataTransfer can be unreliable
    ;(window as any).dragItems = itemsToDrag

    const dragData = {
      items: itemsToDrag
    }

    event.dataTransfer!.effectAllowed = 'copyMove'
    event.dataTransfer!.setData('application/json', JSON.stringify(dragData))
    event.dataTransfer!.setData('from-sidebar', 'true')

    // Set a specialized mime type for internal drag
    event.dataTransfer!.setData('knowledge-hub/items', JSON.stringify(itemsToDrag))

    // Visual feedback for all dragged items
    state.selectedIds.forEach((dragId) => {
      const el = this.bodyEl.querySelector(`.tree-item[data-id="${dragId}"]`) as HTMLElement
      if (el) el.style.opacity = '0.5'
    })

    // Set drag image if multiple
    if (itemsToDrag.length > 1) {
      // Optional: create a drag image showing the count
    }
  }

  private handleDragOver(event: DragEvent): void {
    event.preventDefault()
    const target = event.target as HTMLElement
    const item = target.closest('.tree-item') as HTMLElement

    // Clear all drag-over states first
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'))

    // Check if we're over the root area (empty space in sidebar body)
    // This includes clicking on the body itself, the inner wrapper, or any empty space
    const isOverBody = this.bodyEl.contains(target) && !item
    const isBodyOrInner =
      target === this.bodyEl ||
      target.classList.contains('sidebar__body-inner') ||
      target.classList.contains('sidebar__body')

    if (isOverBody || isBodyOrInner) {
      event.dataTransfer!.dropEffect = 'move'
      this.bodyEl.classList.add('drag-over-root')
      return
    }

    // We're over an item, remove root drag-over
    this.bodyEl.classList.remove('drag-over-root')

    // Add drag-over to the specific item
    // Check if the dragged item is among the itemsToMove (from global state)
    const itemsToMove: { id: string; type: 'note' | 'folder'; path?: string }[] =
      (window as any).dragItems || []
    const draggedItem = itemsToMove.length > 0 ? itemsToMove[0] : null

    if (item && draggedItem && item.dataset.id !== draggedItem.id) {
      event.dataTransfer!.dropEffect = 'move'
      item.classList.add('drag-over')
    }
  }

  private handleDragLeave(event: DragEvent): void {
    const target = event.target as HTMLElement
    const relatedTarget = event.relatedTarget as HTMLElement

    // Only remove drag-over-root if we're actually leaving the sidebar body
    if (target === this.bodyEl && !this.bodyEl.contains(relatedTarget)) {
      this.bodyEl.classList.remove('drag-over-root')
    }

    // Remove item drag-over
    const item = target.closest('.tree-item') as HTMLElement
    if (item) {
      item.classList.remove('drag-over')
    }
  }

  private async handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()

    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'))
    this.bodyEl.classList.remove('drag-over-root')

    let itemsToMove: { type: 'note' | 'folder'; id: string; path?: string }[] = []

    // Try to get items from dataTransfer first
    const itemsJson = event.dataTransfer!.getData('knowledge-hub/items')
    if (itemsJson) {
      try {
        itemsToMove = JSON.parse(itemsJson)
      } catch {
        console.warn('Failed to parse drag data from dataTransfer')
      }
    }

    // Fallback to global variable if dataTransfer failed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (itemsToMove.length === 0 && (window as any).dragItems) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      itemsToMove = (window as any).dragItems
    }

    if (itemsToMove.length === 0) return

    const target = event.target as HTMLElement
    const folder = target.closest('.tree-item') as HTMLElement | null
    let targetPath = ''

    if (!folder) {
      // Check if we're dropping in the root area (same logic as dragOver)
      const isOverBody = this.bodyEl.contains(target)
      const isBodyOrInner =
        target === this.bodyEl ||
        target.classList.contains('sidebar__body-inner') ||
        target.classList.contains('sidebar__body')

      if (isOverBody || isBodyOrInner) {
        // Drop to root directory
        targetPath = ''
      } else {
        this.clearDragState()
        return
      }
    } else {
      // Dropping on an item (folder or note)
      // If target is a folder, move INTO it. If note, move into its parent.
      if (folder.dataset.type === 'folder') {
        targetPath = folder.dataset.id!
      } else {
        targetPath = folder.dataset.path || ''
      }
    }

    let hasChanges = false

    for (const item of itemsToMove) {
      if (item.id === targetPath) continue

      // Normalize both for comparison
      const sourceParent = (item.path || '').replace(/\\/g, '/')
      const targetParent = targetPath.replace(/\\/g, '/')

      if (sourceParent === targetParent) continue

      try {
        if (item.type === 'note') {
          if (this.onNoteMove) {
            await this.onNoteMove(item.id, item.path, targetPath || undefined)
          } else {
            await window.api.moveNote(item.id, item.path, targetPath || undefined)
          }
          hasChanges = true
        } else if (item.type === 'folder') {
          const sourcePath = item.id.replace(/\\/g, '/')
          const targetPathNorm = targetPath.replace(/\\/g, '/')

          if (targetPathNorm.startsWith(sourcePath + '/') || targetPathNorm === sourcePath) {
            console.warn('[Drag] Blocked: Cannot move folder into itself:', sourcePath)
            continue
          }

          if (this.onFolderMove) {
            await this.onFolderMove(sourcePath, targetPath)
          } else {
            await window.api.moveFolder(sourcePath, targetPath)
          }
          hasChanges = true
        }
      } catch (error) {
        console.error('Failed to move item:', item.id, error)
      }
    }

    if (hasChanges) {
      // Auto-expand the target folder so the user sees the dropped item
      if (targetPath) {
        state.expandedFolders.add(targetPath)
      }
      window.dispatchEvent(new CustomEvent('vault-changed'))
    }

    this.clearDragState()
  }

  private clearDragState(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).dragItems
    this.bodyEl.querySelectorAll('.tree-item').forEach((el) => {
      ;(el as HTMLElement).style.opacity = ''
    })
  }

  private handleDragEnd(_event: DragEvent): void {
    void _event // Suppress unused warning
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'))
    this.bodyEl.classList.remove('drag-over-root')

    this.clearDragState()
  }

  private handleKeyboard(event: KeyboardEvent): void {
    const target = event.target as HTMLElement
    const item = target.closest('.tree-item') as HTMLElement
    if (!item) return

    const key = event.key.toLowerCase()

    // Ctrl+R: Rename
    if ((event.ctrlKey || event.metaKey) && key === 'r') {
      event.preventDefault()
      const itemId = item.dataset.id
      if (itemId) {
        this.startRename(itemId)
      }
      return
    }

    // Ctrl+A: Select All
    if ((event.ctrlKey || event.metaKey) && key === 'a') {
      event.preventDefault()
      state.selectedIds.clear()
      this.bodyEl.querySelectorAll('.tree-item').forEach((el) => {
        const id = (el as HTMLElement).dataset.id
        if (id) state.selectedIds.add(id)
      })
      this.updateSelectionStates()
      return
    }

    // Delete or Ctrl+D
    if (key === 'delete' || ((event.ctrlKey || event.metaKey) && key === 'd')) {
      event.preventDefault()

      const idsToDelete =
        state.selectedIds.size > 0
          ? Array.from(state.selectedIds)
          : item.dataset.id
            ? [item.dataset.id]
            : []

      if (idsToDelete.length === 0) return

      const itemsToDelete = (
        idsToDelete.map((idToDel) => {
          const targetItem = this.bodyEl.querySelector(
            `.tree-item[data-id="${idToDel}"]`
          ) as HTMLElement
          return {
            id: idToDel,
            type: targetItem?.dataset.type as 'note' | 'folder',
            path: targetItem?.dataset.path || undefined
          }
        }) as { id: string; type: 'note' | 'folder'; path?: string }[]
      ).filter((i) => i.type)

      if (this.onItemsDelete) {
        this.onItemsDelete(itemsToDelete)
      } else {
        // Fallback to individual deletes if no bulk handler
        for (const it of itemsToDelete) {
          if (it.type === 'note') {
            this.onNoteDelete?.(it.id, it.path)
          } else {
            void this.deleteFolder(it.id)
          }
        }
      }

      state.selectedIds.clear()
      this.selectedId = null
      this.updateSelectionStates()

      // Force tab sync and view update after deletion
      tabService.syncTabs()
      window.dispatchEvent(new CustomEvent('knowledge-hub:tabs-changed'))
      return
    }

    // Arrow Left: Collapse or Jump to Parent
    if (key === 'arrowleft') {
      event.preventDefault()
      // If folder and expanded, collapse it
      if (item.dataset.type === 'folder' && state.expandedFolders.has(item.dataset.id!)) {
        this.toggleFolder(item.dataset.id!)
        return
      }

      // Logic to jump to parent (previous sibling with less indent)
      const guides = Array.from(item.querySelectorAll('.tree-item__indent-guide'))
      const depth = guides.length
      if (depth > 0) {
        let prev = item.previousElementSibling
        // Limit parent jump loop to avoid infinite loop
        let attempts = 0
        while (prev && attempts < 50) {
          attempts++
          const prevDepth = prev.querySelectorAll('.tree-item__indent-guide').length

          if (prevDepth < depth) {
            // Found the parent folder item
            const prevId = (prev as HTMLElement).dataset.id!
            if (prev.getAttribute('data-type') === 'folder') {
              this.selectedFolderPath = (prev as HTMLElement).dataset.path || null
            }
            // Just highlight parent, don't toggle
            this.updateSelection(prevId)
            break
          }
          prev = prev.previousElementSibling
        }
      }
      return
    }

    // Arrow Right: Expand Folder
    if (item.dataset.type === 'folder' && key === 'arrowright') {
      event.preventDefault()
      if (!state.expandedFolders.has(item.dataset.id!)) {
        this.toggleFolder(item.dataset.id!)
      }
      return
    }

    // Arrow Up/Down: Navigation
    if (key === 'arrowdown' || key === 'arrowup') {
      event.preventDefault()
      const items = Array.from(this.bodyEl.querySelectorAll('.tree-item')) as HTMLElement[]
      const currentIndex = items.indexOf(item)

      let nextIndex = currentIndex
      if (key === 'arrowdown') nextIndex = Math.min(currentIndex + 1, items.length - 1)
      if (key === 'arrowup') nextIndex = Math.max(currentIndex - 1, 0)

      const nextItem = items[nextIndex]
      if (nextItem && nextIndex !== currentIndex) {
        const nextId = nextItem.dataset.id!

        if (event.shiftKey) {
          // Extend selection
          if (!this.lastSelectedId) this.lastSelectedId = item.dataset.id!

          const startIdx = items.findIndex((el) => el.dataset.id === this.lastSelectedId)
          const endIdx = nextIndex

          const [minIdx, maxIdx] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)]
          state.selectedIds.clear()
          for (let i = minIdx; i <= maxIdx; i++) {
            const itemId = items[i].dataset.id
            if (itemId) state.selectedIds.add(itemId)
          }
          // In VS Code, Shift+Arrow moves the "focused" item but keeps the "active" item fixed?
          // Actually, the active item (selectedId) should probably move to the next item.
          this.selectedId = nextId
          this.updateSelectionStates()
        } else {
          // Regular navigation
          this.selectedId = nextId
          this.selectedFolderPath = nextItem.dataset.path || null
          state.selectedIds.clear()
          state.selectedIds.add(nextId)
          this.lastSelectedId = nextId
          this.updateSelectionStates()
        }
      }
      return
    }

    // Enter: Open note or toggle folder
    if (key === 'enter') {
      event.preventDefault()
      if (item.dataset.type === 'note' && item.dataset.id) {
        this.onNoteSelect?.(item.dataset.id, item.dataset.path || undefined)
      } else if (item.dataset.type === 'folder') {
        const folderId = item.dataset.id!
        this.toggleFolder(folderId)
      }
    }
  }

  private showContextMenu(event: MouseEvent, item: HTMLElement): void {
    const id = item.dataset.id!
    const isSelected = state.selectedIds.has(id)
    const itemPath = item.dataset.path
    const itemType = item.dataset.type as 'note' | 'folder'

    // If we right click an item that is NOT selected, we should select it (clearing others)
    if (!isSelected) {
      state.selectedIds.clear()
      state.selectedIds.add(id)
      this.selectedId = id
      this.updateSelectionStates()
    }

    const selectedCount = state.selectedIds.size

    // Helper to get full path
    const getFullPath = (noteId: string, notePath?: string): string => {
      if (notePath) {
        return `${notePath}/${noteId}`
      }
      return noteId
    }

    // Helper to copy to clipboard
    const copyToClipboard = (text: string): void => {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      })
    }

    // Icons for menu items
    const icons = {
      newNote: this.createLucideIcon(FileText, 14, 1.5),
      newFolder: this.createLucideIcon(FolderPlus, 14, 1.5),
      rename: this.createLucideIcon(Pencil, 14, 1.5),
      delete: this.createLucideIcon(Trash2, 14, 1.5),
      copy: this.createLucideIcon(Copy, 14, 1.5),
      copyPath: this.createLucideIcon(ClipboardCopy, 14, 1.5),
      reveal: this.createLucideIcon(ExternalLink, 14, 1.5),
      folder: this.createLucideIcon(Folder, 14, 1.5),
      files: this.createLucideIcon(Files, 14, 1.5)
    }

    if (selectedCount > 1) {
      contextMenu.show(event.clientX, event.clientY, [
        {
          label: `Delete ${selectedCount} items`,
          icon: icons.delete,
          keybinding: 'Del',
          danger: true,
          onClick: () => {
            const idsToDelete = Array.from(state.selectedIds)
            const itemsToDelete = idsToDelete
              .map((idToDel) => {
                const targetItem = this.bodyEl.querySelector(
                  `.tree-item[data-id="${idToDel}"]`
                ) as HTMLElement
                return {
                  id: idToDel,
                  type: targetItem?.dataset.type as 'note' | 'folder',
                  path: targetItem?.dataset.path || undefined
                }
              })
              .filter((i) => i.type)

            if (this.onItemsDelete) {
              this.onItemsDelete(itemsToDelete)
            } else {
              for (const it of itemsToDelete) {
                if (it.type === 'note') {
                  this.onNoteDelete?.(it.id, it.path)
                } else {
                  void this.deleteFolder(it.id)
                }
              }
            }
            state.selectedIds.clear()
            this.selectedId = null
            this.updateSelectionStates()
          }
        }
      ])
      return
    }

    if (itemType === 'folder') {
      const folderPath = id
      contextMenu.show(event.clientX, event.clientY, [
        {
          label: 'New Note',
          icon: icons.newNote,
          keybinding: 'Ctrl+N',
          onClick: () => this.onNoteCreate?.(id)
        },
        {
          label: 'New Folder',
          icon: icons.newFolder,
          onClick: () => this.onFolderCreate?.(id)
        },
        { separator: true },
        {
          label: 'Copy Name',
          icon: icons.copy,
          onClick: () => {
            const folderName = id.split('/').pop() || id
            copyToClipboard(folderName)
          }
        },
        {
          label: 'Copy Path',
          icon: icons.copyPath,
          onClick: () => copyToClipboard(folderPath)
        },
        { separator: true },
        {
          label: 'Reveal in Explorer',
          icon: icons.reveal,
          onClick: () => window.api.revealVault?.(id)
        },
        { separator: true },
        {
          label: 'Rename',
          icon: icons.rename,
          keybinding: 'F2',
          onClick: () => {
            const folderName = id.split('/').pop() || id
            window.dispatchEvent(
              new CustomEvent('knowledge-hub:rename-item', {
                detail: { id, type: 'folder', title: folderName }
              })
            )
          }
        },
        {
          label: 'Delete',
          icon: icons.delete,
          keybinding: 'Del',
          danger: true,
          onClick: () => {
            if (this.onItemsDelete) {
              this.onItemsDelete([{ id, type: 'folder' }])
            }
          }
        }
      ])
    } else {
      // Note context menu
      const fullPath = getFullPath(id, itemPath)
      const note = (state.notes as NoteMeta[]).find((n) => n.id === id)
      const noteName = note?.title || id

      contextMenu.show(event.clientX, event.clientY, [
        {
          label: 'Copy Name',
          icon: icons.copy,
          onClick: () => copyToClipboard(noteName)
        },
        {
          label: 'Copy Path',
          icon: icons.copyPath,
          onClick: () => copyToClipboard(fullPath)
        },
        {
          label: 'Copy as WikiLink',
          icon: icons.files,
          onClick: () => copyToClipboard(`[[${noteName}]]`)
        },
        { separator: true },
        {
          label: 'Reveal in Explorer',
          icon: icons.reveal,
          onClick: () => window.api.revealVault?.(id)
        },
        { separator: true },
        {
          label: 'Rename',
          icon: icons.rename,
          keybinding: 'F2',
          onClick: () => {
            window.dispatchEvent(
              new CustomEvent('knowledge-hub:rename-item', {
                detail: { id, type: 'note', title: noteName }
              })
            )
          }
        },
        {
          label: 'Delete',
          icon: icons.delete,
          keybinding: 'Del',
          danger: true,
          onClick: () => {
            if (this.onItemsDelete) {
              this.onItemsDelete([{ id, type: 'note', path: itemPath }])
            }
          }
        }
      ])
    }
  }

  public startRename(id: string): void {
    const item = this.bodyEl.querySelector(`.tree-item[data-id="${id}"]`) as HTMLElement
    const label = item?.querySelector('.tree-item__label') as HTMLElement
    if (id && label) {
      window.dispatchEvent(
        new CustomEvent('knowledge-hub:rename-item', {
          detail: {
            id,
            type: (item.dataset.type as 'note' | 'folder') || 'note',
            title: label.textContent?.trim()
          }
        })
      )
    }
  }

  private async finishRename(label: HTMLElement): Promise<void> {
    const itemId = label.dataset.itemId || label.dataset.noteId
    const itemType = label.closest('.tree-item')?.getAttribute('data-type') || 'note'
    if (!itemId) return

    const newTitle = label.textContent?.trim() || 'Untitled'
    const originalTitle = label.dataset.originalTitle || 'Untitled'

    label.contentEditable = 'false'
    label.classList.remove('is-editing')
    this.editingId = null

    // Clear priority once renaming is attempted (even if same name)
    state.newlyCreatedIds.delete(itemId)

    if (newTitle !== originalTitle) {
      window.dispatchEvent(
        new CustomEvent('item-rename', {
          detail: { id: itemId, type: itemType, newTitle, oldTitle: originalTitle }
        })
      )
    } else {
      // Refresh to move it from the top back to its alpha position
      window.dispatchEvent(new CustomEvent('vault-changed'))
    }
  }

  private getFolderType(folderName: string): string {
    const name = folderName.toLowerCase()
    if (name === 'root' || name === 'vault' || name === 'knowledgehub' || name === 'knowledge hub')
      return 'root'
    if (name === 'src' || name === 'source' || name === 'sources' || name === 'components')
      return 'src'
    if (name === 'config' || name === 'configs' || name === 'configuration') return 'config'
    if (name === 'settings' || name === 'setting') return 'settings'
    if (name === 'test' || name === 'tests' || name === 'testing') return 'test'
    if (name === 'public' || name === 'pages' || name === 'assets' || name === 'resources')
      return 'public'
    if (
      name === 'lib' ||
      name === 'libs' ||
      name === 'library' ||
      name === 'libraries' ||
      name === 'utils' ||
      name === 'utilities'
    )
      return 'lib'
    return ''
  }

  private getNoteType(noteName: string): string {
    const name = noteName.toLowerCase()

    // Check for special patterns in the title (these would be *.json.md, *.yaml.md, etc.)
    if (name.includes('.json')) return 'json'
    if (name.includes('.yaml') || name.includes('.yml')) return 'yaml'
    if (name.includes('.sql')) return 'sql'
    if (name.includes('.py')) return 'python'
    if (name.includes('.sh')) return 'shell'
    if (name.includes('.js')) return 'javascript'
    if (name.includes('.ts')) return 'typescript'
    if (name.includes('.html')) return 'html'
    if (name.includes('.css') || name.includes('.scss')) return 'css'

    return 'markdown'
  }

  private async deleteFolder(path: string): Promise<void> {
    if (!confirm(`Delete folder and all contents?`)) return
    try {
      await window.api.deleteFolder(path)
      window.dispatchEvent(new CustomEvent('vault-changed'))
    } catch (error) {
      console.error('Failed to delete', error)
    }
  }

  updateSelectionStates(): void {
    const isRoot = !this.selectedId && state.selectedIds.size === 0
    this.bodyEl.classList.toggle('is-root-selected', isRoot)

    this.bodyEl.querySelectorAll('.tree-item').forEach((el) => {
      const item = el as HTMLElement
      const id = item.dataset.id
      if (!id) return

      const isActive = this.selectedId === id
      const isSelected = state.selectedIds.has(id)

      item.classList.toggle('is-active', isActive)
      item.classList.toggle('is-selected', isSelected)
    })

    if (this.selectedId) {
      this.scrollToActive(true)
    }
  }

  updateSelection(id: string): void {
    this.selectedId = id
    if (!id) {
      this.selectedFolderPath = null
      state.selectedIds.clear()
      this.updateSelectionStates()
      return
    }
    if (!state.selectedIds.has(id)) {
      state.selectedIds.clear()
      state.selectedIds.add(id)
    }
    const note = (state.notes as NoteMeta[]).find((n) => n.id === id)
    if (note) {
      this.selectedFolderPath = note.path || null
      if (note.path) {
        const parts = note.path.replace(/\\/g, '/').split('/')
        let currentPath = ''
        let changed = false
        for (const part of parts) {
          if (!part) continue
          currentPath = currentPath ? `${currentPath}/${part}` : part
          if (!state.expandedFolders.has(currentPath)) {
            state.expandedFolders.add(currentPath)
            changed = true
          }
        }
        if (changed) {
          void window.api.updateSettings({
            expandedFolders: Array.from(state.expandedFolders)
          })
          this.renderTree(this.searchEl.value)
        }
      }
    } else {
      this.selectedFolderPath = id
    }
    this.updateSelectionStates()
  }

  scrollToActive(shouldFocus: boolean = true): void {
    const activeItem = this.bodyEl.querySelector('.tree-item.is-active') as HTMLElement
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'auto' })
      if (shouldFocus) activeItem.focus()
    }
  }

  updateDirtyState(): void {
    this.bodyEl.querySelectorAll('.tree-item--note').forEach((el) => {
      const item = el as HTMLElement
      const id = item.dataset.id
      if (!id) return

      const isDirty = state.isDirty && state.activeId === id

      let dot = item.querySelector('.tree-item__dirty-dot')
      if (isDirty) {
        if (!dot) {
          dot = document.createElement('span')
          dot.className = 'tree-item__dirty-dot'
          item.appendChild(dot)
        }
      } else {
        if (dot) {
          dot.remove()
        }
      }
    })
  }

  getSearchValue(): string {
    return this.searchEl.value
  }

  getSelectedFolderPath(): string | null {
    if (!this.selectedId && state.selectedIds.size === 0) {
      return null
    }

    if (this.selectedFolderPath !== null) return this.selectedFolderPath

    // Fallback: Use the folder of the active note
    if (state.activeId) {
      const activeTab = state.openTabs.find((t) => t.id === state.activeId)
      if (activeTab && activeTab.path) return activeTab.path

      const note = (state.notes as NoteMeta[]).find((n) => n.id === state.activeId)
      if (note && note.path) return note.path
    }

    return null
  }

  private getDefaultParentPath(): string | undefined {
    return this.getSelectedFolderPath() || undefined
  }

  /**
   * Find a path from a title (useful for manual commands)
   */
  public getItemPathByTitle(title: string): string | undefined {
    const q = title.toLowerCase().trim()
    const item = state.notes.find((n) => n.title.toLowerCase() === q)
    return item?.path
  }

  private getFolderGitStatus(folder: FolderItem): string {
    let status: string = 'none'

    const check = (item: FolderItem | NoteMeta): void => {
      if (item.type === 'note') {
        const s = gitService.getStatus(item.id)
        if (s !== 'none') {
          // Priority: modified > staged > untracked
          if (s === 'modified') status = 'modified'
          else if (s === 'staged' && status !== 'modified') status = 'staged'
          else if (status === 'none') status = s
        }
      } else {
        const f = item as FolderItem
        if (f.children) {
          f.children.forEach(check)
        }
      }
    }

    if (folder.children) {
      folder.children.forEach(check)
    }

    return status
  }
}
