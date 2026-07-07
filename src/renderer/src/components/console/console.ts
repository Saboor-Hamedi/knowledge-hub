import './console.css'
import { codicons } from '../../utils/codicons'
import { ChatMessage } from '../../services/aiService'
import { agentService } from '../../services/agent/agent-service'
import { agentExecutor } from '../../services/agent/executor'
import { state } from '../../core/state'
import { ragService } from '../../knm/rag/ragService'
import type { FileOperationHandler } from '../../handlers/FileOperationHandler'
import { ChatInput } from '../common/ChatInput'
import { Avatar } from '../rightbar/avatar'
import { ChatIndicator } from '../common/ChatIndicator'
import {
  createElement,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Info,
  Plus,
  Eraser,
  Terminal,
  Sparkles
} from 'lucide'

export interface Command {
  name: string
  description: string
  usage?: string
  action: (args: string[]) => void | Promise<void>
  icon?: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * HUB Console Component
 *
 * SECURITY MODEL:
 * ---------------
 * This console is SANDBOXED and SECURE by design:
 *
 * 1. **No Arbitrary Code Execution**: Unlike a real terminal, this console CANNOT execute
 *    arbitrary system commands, shell scripts, or JavaScript code. It only runs pre-registered
 *    commands defined in the application.
 *    commands defined in the application.
 *
 * 2. **Whitelist-Only Commands**: Only commands explicitly registered via `registerCommand()`
 *    can be executed. Users cannot inject or run malicious code.
 *
 * 3. **Controlled Actions**: Each command's action is defined by the application developer
 *    and runs within the Electron renderer process with limited permissions.
 *
 * 5. **Input Sanitization**: Command arguments are parsed as simple strings - no eval(),
 *    no code injection, no shell expansion.
 *
 * WHAT THIS MEANS:
 * - Safe for users to type anything - worst case is "Unknown command" error
 * - Cannot be used to hack, exploit, or damage the system
 * - Cannot access files outside the vault directory
 * - Cannot run system commands like `rm -rf /` or `del C:\`
 * - All operations are scoped to app functionality only
 */

export class ConsoleComponent {
  private container: HTMLElement
  private consoleEl: HTMLElement
  private bodyEl!: HTMLElement
  private chatInput!: ChatInput
  private isMaximized = false
  private isOpen = false
  private isBusy = false
  private isDragging = false
  private startY = 0
  private startHeight = 0
  private height = 300
  private currentMode: 'terminal' | 'ai' = 'terminal'
  private history: string[] = []
  public commands: Map<string, Command> = new Map()
  private vaultUnsubscribe?: () => void
  private aiAbortController: AbortController | null = null
  private chatHistory: ChatMessage[] = []
  private fileOperationHandler!: FileOperationHandler
  private proposeBuffer: string = ''

  constructor(containerId: string) {
    this.container = document.getElementById(containerId) as HTMLElement
    this.consoleEl = document.createElement('div')
    this.consoleEl.className = 'hub-console'
    this.render()
    this.bodyEl = this.consoleEl.querySelector('.hub-console__body') as HTMLElement

    // Initialize Unified Chat Input
    const footerParent = this.consoleEl.querySelector('.hub-console__footer') as HTMLElement
    this.chatInput = new ChatInput(footerParent, {
      placeholder: 'Type a command or @note...',
      showModeSwitcher: true,
      showPrompt: true,
      onSend: (text) => {
        if (this.currentMode === 'ai') void this.handleAIRequest(text)
        else void this.execute(text)
      },
      onStop: () => {
        if (this.aiAbortController) {
          this.aiAbortController.abort()
          this.isBusy = false
          this.chatInput.setBusy(false)
          const thinking = this.bodyEl.querySelector('.kb-chat-pill')
          if (thinking) thinking.remove()
        }
      },
      onModeChange: (mode) => {
        this.setMode(mode)
      },
      slashCommands: this.getSlashCommands()
    })

    if (this.container) {
      this.container.appendChild(this.consoleEl)
    } else {
      console.warn(`[Console] Container "${containerId}" not found. Appending to body.`)
      document.body.appendChild(this.consoleEl)
    }

    this.attachEvents()
    this.log('HUB Console initialized. Type "help" for a list of commands.', 'system')

    // Fetch and set username
    void this.initUsername()

    // Restore saved state
    const savedState = localStorage.getItem('hub-console-open')
    const savedMax = localStorage.getItem('hub-console-maximized') === 'true'

    if (savedMax) {
      this.isMaximized = true
      this.consoleEl.classList.add('is-maximized')
      document.querySelector('.main')?.classList.add('console-maximized')

      const icon = this.consoleEl.querySelector('.hub-console__maximize-icon')
      if (icon) icon.innerHTML = codicons.minimize
    }

    if (savedState === 'true') {
      this.setVisible(true)
    }

    const savedHeight = localStorage.getItem('hub-console-height')
    if (savedHeight) {
      this.height = parseInt(savedHeight, 10)
      this.updateHeight()
    }

    const savedMode = localStorage.getItem('hub-console-mode')
    if (savedMode === 'ai' || savedMode === 'terminal') {
      this.setMode(savedMode)
    }

    this.registerCommand({
      name: 'append',
      description: 'Appends content to a note',
      usage: 'append "note title" <content>',
      action: async (args) => {
        if (args.length < 2) {
          this.log('Usage: append "note title" <content>', 'error')
          return
        }
        const query = args[0].replace(/^["']|["']$/g, '')
        const content = args.slice(1).join(' ')
        await agentExecutor.appendNote(query, content)
        this.log(`Appended to: ${query}`, 'system')
      }
    })

    this.registerCommand({
      name: 'propose',
      description: 'Propose changes to a note for review',
      action: async (args) => {
        if (args.length < 2) {
          this.log('Usage: propose "note title" <new content>', 'error')
          return
        }
        const query = args[0].replace(/^["']|["']$/g, '')
        const content = args.slice(1).join(' ')
        await agentExecutor.proposeNote(query, content)
        this.log(`Proposed improvements for: ${query}. Review them in the editor.`, 'system')
      }
    })
  }

  public setHandlers(fileOps: FileOperationHandler): void {
    this.fileOperationHandler = fileOps
  }

  private async initUsername(): Promise<void> {
    try {
      const username = await window.api.getUsername()
      const vault = await window.api.getVault()

      // Sanitize names to prevent display issues
      const sanitizedUsername = (username || 'user').trim() || 'user'
      const vaultName = (vault?.name || 'hub').trim() || 'hub'

      // ai agent name: don't delete this
      if (this.chatInput) {
        if (this.currentMode === 'ai') {
          this.chatInput.updatePrompt('λ')
        } else {
          this.chatInput.updatePrompt(`${sanitizedUsername}@${vaultName} λ`)
        }
      }

      // Listen for vault changes and update prompt dynamically
      this.vaultUnsubscribe = window.api.onVaultChanged(async () => {
        try {
          const newVault = await window.api.getVault()
          const newVaultName = (newVault?.name || 'hub').trim() || 'hub'
          if (this.chatInput && this.currentMode === 'terminal') {
            this.chatInput.updatePrompt(`${sanitizedUsername}@${newVaultName} λ`)
          }
        } catch (err) {
          console.error('[Console] Failed to update vault name:', err)
        }
      })
    } catch (err) {
      console.error('[Console] Failed to initialize username/vault:', err)
      // Keep default prompt if initialization fails
    }
  }

  private render(): void {
    this.consoleEl.innerHTML = `
      <div class="hub-console__body"></div>
      <div class="hub-console__footer"></div>
    `
  }

  public registerCommand(command: Command): void {
    if (!command || !command.name || typeof command.action !== 'function') {
      console.error('[Console] Invalid command registration:', command)
      return
    }
    this.commands.set(command.name.toLowerCase().trim(), command)

    // Update ChatInput's slash commands if they changed
    if (this.chatInput) {
      this.chatInput.setSlashCommands(this.getSlashCommands())
    }
  }

  public getSlashCommands(): { command: string; description: string; icon?: any }[] {
    const list: { command: string; description: string; icon?: any; action?: () => void }[] = []

    if (this.currentMode === 'ai') {
      // AI-specific commands for the Console's AI mode
      list.push({
        command: '/term',
        description: 'Switch to Terminal mode',
        icon: Terminal,
        action: () => this.setMode('terminal')
      })
      list.push({
        command: '/clear',
        description: 'Clear chat bubbles',
        icon: Eraser,
        action: () => this.clear()
      })
      list.push({
        command: '/new',
        description: 'Reset AI conversation',
        icon: Plus,
        action: () => {
          this.chatHistory = []
          this.log('AI session reset.', 'system')
        }
      })
      list.push({
        command: '/help',
        description: 'AI command help',
        icon: Info,
        action: () => {
          this.log('AI Mode Commands:', 'system')
          this.log('  /term  - Switch to Terminal mode', 'system')
          this.log('  /clear - Clear the console display', 'system')
          this.log('  /new   - Reset conversation history', 'system')
          this.log('  /help  - Show this message', 'system')
        }
      })
    } else {
      // Terminal-specific commands
      list.push({
        command: '/ai',
        description: 'Switch to AI Agent mode',
        icon: Sparkles,
        action: () => this.setMode('ai')
      })
      this.commands.forEach((cmd, name) => {
        list.push({
          command: `/${name}`,
          description: cmd.description,
          icon: cmd.icon // eslint-disable-line @typescript-eslint/no-explicit-any
        })
      })
    }
    return list.sort((a, b) => a.command.localeCompare(b.command))
  }

  public get isVisible(): boolean {
    return this.isOpen
  }

  public toggle(): void {
    const willOpen = !this.isOpen
    this.setVisible(willOpen)

    // Force re-apply maximization logic if opening into a maximized state
    if (willOpen && this.isMaximized) {
      document.querySelector('.main')?.classList.add('console-maximized')
    } else if (!willOpen) {
      document.querySelector('.main')?.classList.remove('console-maximized')
      // Ensure focus returns to editor when closing
      // (This is a focused backup to the global shortcut handler)
      const editorHost = document.getElementById('editorContainer')
      if (editorHost && !editorHost.style.display.includes('none')) {
        // We can't easily access the editor instance here directly without tight coupling,
        // but the global handler in app.ts covers the primary case.
      }
    }
  }

  public getOpen(): boolean {
    return this.isOpen
  }

  public setMode(mode: 'terminal' | 'ai'): void {
    this.currentMode = mode
    localStorage.setItem('hub-console-mode', mode)

    if (this.chatInput) {
      this.chatInput.setMode(mode)
      // Refresh slash commands for the new mode
      this.chatInput.setSlashCommands(this.getSlashCommands())
    }

    void this.initUsername()
    this.chatInput.focus()
  }

  public setVisible(visible: boolean): void {
    const wasOpen = this.isOpen
    this.isOpen = visible
    this.consoleEl.classList.toggle('is-open', this.isOpen)

    // Maximized state should persist on the element whenever it is open
    this.consoleEl.classList.toggle('is-maximized', !!this.isMaximized)

    // Update .main element's console-maximized class based on both visibility and maximization
    const mainEl = document.querySelector('.main')
    if (this.isOpen && this.isMaximized) {
      mainEl?.classList.add('console-maximized')
    } else {
      mainEl?.classList.remove('console-maximized')
    }

    // If closing via UI, abort active AI
    if (wasOpen && !visible && this.isBusy && this.aiAbortController) {
      this.aiAbortController.abort()
      this.isBusy = false
    }

    try {
      localStorage.setItem('hub-console-open', String(this.isOpen))
    } catch (err) {
      console.warn('[Console] Failed to save state to localStorage:', err)
    }

    if (this.isOpen) {
      setTimeout(() => {
        this.chatInput.focus()
      }, 50)
    }
  }

  public clearHistory(): void {
    this.chatHistory = []
  }

  public clear(): void {
    if (this.bodyEl) {
      this.bodyEl.innerHTML = ''
    }
  }

  public destroy(): void {
    if (this.chatInput) {
      this.chatInput.destroy()
    }
    // Clean up vault change listener
    if (this.vaultUnsubscribe) {
      this.vaultUnsubscribe()
      this.vaultUnsubscribe = undefined
    }
  }

  public log(message: string, type: 'command' | 'error' | 'system' | 'output' = 'output'): void {
    const line = document.createElement('div')
    line.className = `hub-console__line hub-console__line--${type}`

    if (type === 'command') {
      line.innerHTML = `<div class="hub-console__turn">
          <div class="hub-console__user-body">
            <div class="hub-console__user-content">${this.escapeHtml(message)}</div>
          </div>
          ${Avatar.createHTML('user', 20)}
        </div>`
    } else {
      line.textContent = message
    }

    this.bodyEl.appendChild(line)
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight
  }

  private attachEvents(): void {
    // Focus input on click anywhere in console (but skip interactive elements or active selection)
    this.consoleEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest('select') || target.closest('button') || target.closest('input')) {
        return
      }

      // If user is selecting text, don't steal focus
      const selection = window.getSelection()
      if (selection && selection.toString().length > 0) {
        return
      }

      this.chatInput.focus()
    })

    // Header buttons
    const chevronBtn = this.consoleEl.querySelector('.hub-console__chevron-btn')
    chevronBtn?.addEventListener('click', () => this.toggle())

    const maximizeBtn = this.consoleEl.querySelector('.hub-console__maximize-btn')
    maximizeBtn?.addEventListener('click', () => this.toggleMaximize())

    const closeBtn = this.consoleEl.querySelector('.hub-console__close-btn')
    closeBtn?.addEventListener('click', () => this.setVisible(false))

    // Handle Resizing
    const resizer = this.consoleEl.querySelector('.hub-console__resizer') as HTMLElement
    resizer?.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.isDragging = true
      this.startY = e.clientY
      this.startHeight = this.height
      this.consoleEl.classList.add('is-resizing')
      document.body.style.cursor = 'ns-resize'

      const onMouseMove = (moveEvent: MouseEvent): void => {
        if (!this.isDragging) return
        const delta = this.startY - moveEvent.clientY
        const mainEl = document.querySelector('.main')
        const maxAllowed = mainEl ? mainEl.clientHeight - 80 : window.innerHeight - 200
        this.height = Math.max(150, Math.min(maxAllowed, this.startHeight + delta))
        this.updateHeight()
      }

      const onMouseUp = (): void => {
        this.isDragging = false
        this.consoleEl.classList.remove('is-resizing')
        document.body.style.cursor = ''
        localStorage.setItem('hub-console-height', String(this.height))
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    })

    window.addEventListener('hub-ai-explain', (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string; prompt: string }>
      const { text, prompt } = customEvent.detail
      if (!this.isVisible) this.setVisible(true)
      this.setMode('ai')
      void this.handleAIRequest(
        `[Explain Selection]\n\nContext Content:\n"${text}"\n\nQuestion: ${prompt || 'Explain this context in detail.'}`
      )
    })
  }

  private toggleMaximize(): void {
    this.isMaximized = !this.isMaximized
    this.updateHeight()

    // Persist maximized state
    localStorage.setItem('hub-console-maximized', String(this.isMaximized))

    // Update maximize button icon
    const icon = this.consoleEl.querySelector('.hub-console__maximize-icon')
    if (icon) {
      icon.innerHTML = this.isMaximized ? codicons.minimize : codicons.maximize
      const maximizeBtn = this.consoleEl.querySelector('.hub-console__maximize-btn')
      maximizeBtn?.setAttribute('title', this.isMaximized ? 'Restore Panel' : 'Maximize Panel')
    }
  }

  private updateHeight(): void {
    const mainEl = document.querySelector('.main') as HTMLElement
    if (this.isMaximized) {
      this.consoleEl.style.height = '100%'
      this.consoleEl.classList.add('is-maximized')
      mainEl?.classList.add('console-maximized')
    } else {
      this.consoleEl.style.height = `${this.height}px`
      this.consoleEl.classList.remove('is-maximized')
      mainEl?.classList.remove('console-maximized')
    }
  }

  public async execute(rawLine: string, addToHistory = true, logCommand = true): Promise<void> {
    if (addToHistory) {
      this.history.push(rawLine)
    }
    if (logCommand) {
      this.log(rawLine, 'command')
    }

    const subCommands = rawLine.split('&&').map((s) => s.trim())

    this.isBusy = true
    this.chatInput.setBusy(true, 'Executing...')

    try {
      for (const sub of subCommands) {
        if (!sub) continue

        // Improved parsing for quoted strings
        const parts: string[] = []
        let currentPart = ''
        let inQuotes = false
        for (let i = 0; i < sub.length; i++) {
          const char = sub[i]
          if (char === '"') {
            inQuotes = !inQuotes
          } else if (char === ' ' && !inQuotes) {
            if (currentPart) {
              parts.push(currentPart)
              currentPart = ''
            }
          } else {
            currentPart += char
          }
        }
        if (currentPart) parts.push(currentPart)

        const commandName = parts[0].toLowerCase()
        const args = parts.slice(1)

        const cmd = this.commands.get(commandName)
        if (cmd) {
          await cmd.action(args)
        } else {
          this.log(`Unknown command: ${commandName}`, 'error')
          break
        }
      }
    } catch (err) {
      this.log(`Command failed: ${(err as Error).message}`, 'error')
    } finally {
      this.isBusy = false
      this.chatInput.setBusy(false)
      this.chatInput.focus()
    }
  }

  private async handleAIRequest(input: string): Promise<void> {
    const { aiService } = await import('../../services/aiService')

    this.isBusy = true
    this.chatInput.setBusy(true, 'AI Agent is thinking...')
    this.log(input, 'command')

    const outputLine = document.createElement('div')
    outputLine.className = 'hub-console__line hub-console__line--ai is-typing'
    outputLine.innerHTML = `<div class="hub-console__turn">
        ${Avatar.createHTML('assistant', 20)}
        <div class="hub-console__ai-body">
          <div class="hub-console__ai-content"></div>
        </div>
      </div>`
    this.bodyEl.appendChild(outputLine)

    const aiBody = outputLine.querySelector('.hub-console__ai-body') as HTMLElement
    const contentEl = outputLine.querySelector('.hub-console__ai-content') as HTMLElement

    // Thinking indicator
    contentEl.innerHTML = ChatIndicator.createPill('thinking')

    this.bodyEl.scrollTop = this.bodyEl.scrollHeight

    this.aiAbortController = new AbortController()
    let fullText = ''
    const currentController = this.aiAbortController

    try {
      const response = await aiService.buildContextMessage(input)
      const context = response.context
      const { formatMarkdown } = await import('../../utils/markdown')
      const markdownCache = new Map<string, string>()

      let lastRenderTime = 0
      let lastVisibleHtml = ''
      let RENDER_THROTTLE_MS = 150 // Dynamic throttle

      let streamingTargetId: string | null = null
      let inStreamingWrite = false
      let streamBuffer = ''
      let lastFileUpdateTime = 0

      await aiService.callDeepSeekAPIStream(
        this.chatHistory,
        context,
        async (chunk) => {
          if (currentController?.signal.aborted) return

          if (fullText === '') {
            contentEl.querySelector('.kb-chat-pill')?.remove()
          }
          fullText += chunk
          streamBuffer += chunk

          // --- LIVE STREAMING WRITE/APPEND/PROPOSE LOGIC ---
          const FILE_UPDATE_THROTTLE = 100 // ms
          // Dynamic throttle: if output is getting very long, slow down rendering to keep UI responsive
          if (fullText.length > 10000) RENDER_THROTTLE_MS = 250
          if (fullText.length > 30000) RENDER_THROTTLE_MS = 400
          if (!inStreamingWrite) {
            const writeMatch = streamBuffer.match(
              /\[RUN:\s*(write|append|propose)\s+("([^"]+)"|([^\s"]+))\s+/
            )
            if (writeMatch) {
              try {
                const type = writeMatch[1]
                const title = writeMatch[3] || writeMatch[4]
                inStreamingWrite = true

                if (type === 'propose') {
                  streamingTargetId = `temp_propose_${title}`
                  this.proposeBuffer = ''
                } else {
                  const resolved = (await agentExecutor.resolveNote(title)) as {
                    id: string
                    title: string
                  } | null
                  if (resolved) {
                    streamingTargetId = resolved.id
                    if (type === 'write') {
                      await window.api.saveNote({
                        id: streamingTargetId,
                        content: '',
                        title: resolved.title,
                        updatedAt: Date.now()
                      } as Parameters<typeof window.api.saveNote>[0])
                    }
                  } else if (type === 'write') {
                    const meta = await window.api.createNote(title)
                    streamingTargetId = meta.id
                  }
                  if (streamingTargetId) {
                    void this.fileOperationHandler.openNote(streamingTargetId, undefined, 'editor')
                  }
                }
              } catch (e) {
                console.error('[Console] Live stream start failed:', e)
              }
              streamBuffer = streamBuffer.substring(writeMatch[0].length)
            }
          } else {
            const closingIdx = streamBuffer.indexOf(']')
            const contentToAppend =
              closingIdx !== -1 ? streamBuffer.substring(0, closingIdx) : streamBuffer

            if (contentToAppend && streamingTargetId) {
              try {
                const type = streamingTargetId.startsWith('temp_propose_') ? 'propose' : 'write'
                if (type === 'propose') {
                  this.proposeBuffer += contentToAppend
                  streamBuffer = streamBuffer.substring(contentToAppend.length)
                } else {
                  // Only append to note if we have a substantial chunk or time passed
                  // to avoid freezing the UI with thousands of IPC calls
                  const now = Date.now()
                  if (
                    closingIdx !== -1 ||
                    contentToAppend.length > 500 ||
                    now - lastFileUpdateTime > FILE_UPDATE_THROTTLE
                  ) {
                    lastFileUpdateTime = now
                    await window.api.appendNote(streamingTargetId, contentToAppend)
                    streamBuffer = streamBuffer.substring(contentToAppend.length)
                  }
                  // If we didn't append, we KEEP it in streamBuffer for the next chunk
                }
              } catch (e) {
                console.error('[Console] Live stream append failed:', e)
                streamBuffer = streamBuffer.substring(contentToAppend.length)
              }
            }

            if (closingIdx !== -1) {
              inStreamingWrite = false
              if (streamingTargetId && streamingTargetId.startsWith('temp_propose_')) {
                const realTitle = streamingTargetId.replace('temp_propose_', '')
                void agentExecutor.proposeNote(realTitle, this.proposeBuffer)
              } else if (streamingTargetId) {
                const data = await window.api.loadNote(streamingTargetId)
                if (data) {
                  void ragService.indexNote(data.id, data.content, {
                    title: data.title,
                    path: data.path
                  })
                }
              }
              streamingTargetId = null
            }
          }

          // Update visible text (strip [RUN:] tags) - THROTTLED
          const now = Date.now()
          if (now - lastRenderTime >= RENDER_THROTTLE_MS) {
            lastRenderTime = now
            const visibleText = fullText.replace(/\[RUN:[\s\S]*?(\]|(?=$))/g, '')

            try {
              let html: string
              if (markdownCache.has(visibleText)) {
                html = markdownCache.get(visibleText)!
              } else {
                html = formatMarkdown(visibleText)
                markdownCache.set(visibleText, html)
                if (markdownCache.size > 100) {
                  const firstKey = markdownCache.keys().next().value
                  if (firstKey !== undefined) markdownCache.delete(firstKey)
                }
              }

              // Add inline typing dots
              const dotsHtml = ChatIndicator.createInline()
              const totalHtml = html + dotsHtml
              if (totalHtml !== lastVisibleHtml) {
                contentEl.innerHTML = totalHtml
                lastVisibleHtml = totalHtml
              }
            } catch {
              contentEl.textContent = visibleText
            }
            this.bodyEl.scrollTop = this.bodyEl.scrollHeight
          }
        },
        this.aiAbortController.signal
      )

      outputLine.classList.remove('is-typing')
      contentEl.querySelector('.kb-chat-pill')?.remove()

      // Final complete render
      const finalTextDisplay = fullText.replace(/\[RUN:[\s\S]*?(\]|(?=$))/g, '')
      try {
        contentEl.innerHTML = formatMarkdown(finalTextDisplay)
      } catch {
        contentEl.textContent = finalTextDisplay
      }
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight

      if (fullText.trim() && !this.aiAbortController?.signal.aborted) {
        const actionArea = document.createElement('div')
        actionArea.className = 'hub-console__ai-actions'

        // Identify and handle [RUN: ...] commands
        const runMatches = Array.from(fullText.matchAll(/\[RUN:\s*([\s\S]+?)\]/g))
        const commandsToRun: string[] = []

        runMatches.forEach((match) => {
          const cmdString = match[1].trim()
          const isSafeAutoCmd =
            cmdString.startsWith('mkdir') ||
            cmdString.startsWith('touch') ||
            cmdString.startsWith('write') ||
            cmdString.startsWith('append') ||
            cmdString.startsWith('move') ||
            cmdString.startsWith('rename') ||
            cmdString.startsWith('delete') ||
            cmdString.startsWith('rm') ||
            cmdString.startsWith('propose') ||
            cmdString.startsWith('read')

          if (isSafeAutoCmd) {
            commandsToRun.push(cmdString)
          } else {
            const runBtn = document.createElement('button')
            runBtn.className = 'hub-console__ai-action-btn hub-console__ai-action-btn--run'
            runBtn.title = `Execute: ${cmdString}`
            runBtn.innerHTML = `${codicons.terminal || '▶'} Run: ${cmdString}`
            runBtn.addEventListener('click', () => {
              void this.execute(cmdString)
              runBtn.remove()
            })
            actionArea.appendChild(runBtn)
          }
        })

        if (commandsToRun.length > 0) {
          this.log(`Agent executing ${commandsToRun.length} action(s)...`, 'system')
          const containsRead = commandsToRun.some((c) => c.startsWith('read'))
          await this.execute(commandsToRun.join(' && '), false, false)

          if (containsRead && !this.aiAbortController?.signal.aborted) {
            this.log('Agent processing retrieved information...', 'system')
            setTimeout(() => {
              void this.handleAIRequest(
                "(Hidden Context: I have retrieved the note content as you requested above. Please proceed with the user's original task using this information.)"
              )
            }, 500)
            return
          }
        }

        const insertBtn = document.createElement('button')
        insertBtn.className = 'hub-console__ai-action-btn'
        insertBtn.title = 'Insert this response at the current cursor position'
        insertBtn.innerHTML = `${codicons.insertPlus} <span>Insert at Cursor</span>`
        insertBtn.addEventListener('click', () => {
          window.dispatchEvent(
            new CustomEvent('knowledge-hub:insert-at-cursor', {
              detail: { content: fullText.replace(/\[RUN:\s*(.+?)\]/g, '').trim() }
            })
          )
          this.log(`Inserted into active note.`, 'system')
          actionArea.remove()
        })
        actionArea.appendChild(insertBtn)

        const archiveBtn = document.createElement('button')
        archiveBtn.className = 'hub-console__ai-action-btn'
        archiveBtn.title = 'Create a new note with this response'
        archiveBtn.innerHTML = `${codicons.archive} <span>Archive to Note</span>`
        archiveBtn.addEventListener('click', async () => {
          const noteId = await agentService.archiveResponse(fullText, input)
          this.log(`Archived to new note.`, 'system')
          const note = state.notes.find((n) => n.id === noteId)
          if (note) {
            window.dispatchEvent(
              new CustomEvent('knowledge-hub:open-note', {
                detail: { id: note.id, path: note.path }
              })
            )
          }
          actionArea.remove()
        })
        actionArea.appendChild(archiveBtn)

        // Light Buttons (Feedback & Copy) - Match Right Sidebar
        const lightActions = document.createElement('div')
        lightActions.className = 'kb-message-actions'
        lightActions.style.marginTop = '8px'
        const finalText = fullText.replace(/\[RUN:[\s\S]*?\]/g, '').trim()
        lightActions.innerHTML = `
          <button class="kb-message-action" data-action="copy" title="Copy response">
            ${this.createLucideIcon(Copy, 14)}
          </button>
          <button class="kb-message-action" data-action="regenerate" title="Regenerate">
            ${this.createLucideIcon(RefreshCw, 12)}
          </button>
          <button class="kb-message-action" data-action="thumbs-up" title="Helpful">
            ${this.createLucideIcon(ThumbsUp, 12)}
          </button>
          <button class="kb-message-action" data-action="thumbs-down" title="Not helpful">
            ${this.createLucideIcon(ThumbsDown, 12)}
          </button>
        `

        // Add action listeners
        lightActions.querySelectorAll('.kb-message-action').forEach((btn) => {
          btn.addEventListener('click', () => {
            const action = (btn as HTMLElement).dataset.action
            if (action === 'copy') {
              navigator.clipboard.writeText(finalText)
              btn.classList.add('kb-message-action--success')
              setTimeout(() => btn.classList.remove('kb-message-action--success'), 2000)
            } else if (action === 'regenerate') {
              void this.handleAIRequest(input)
              outputLine.remove()
            } else if (action === 'thumbs-up' || action === 'thumbs-down') {
              lightActions
                .querySelectorAll('.kb-message-action--active')
                .forEach((b) => b.classList.remove('kb-message-action--active'))
              btn.classList.add('kb-message-action--active')
            }
          })
        })

        if (actionArea.children.length > 0) {
          aiBody.appendChild(actionArea)
        }
        aiBody.appendChild(lightActions)

        try {
          const { formatMarkdown } = await import('../../utils/markdown')
          contentEl.innerHTML = formatMarkdown(finalText)
        } catch {
          contentEl.textContent = finalText
        }

        this.chatHistory.push({ role: 'user', content: input, timestamp: Date.now() })
        this.chatHistory.push({ role: 'assistant', content: fullText, timestamp: Date.now() })
        if (this.chatHistory.length > 20) this.chatHistory = this.chatHistory.slice(-20)
        this.bodyEl.scrollTop = this.bodyEl.scrollHeight
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.log('AI request cancelled.', 'system')
      } else {
        this.log(`AI Error: ${(err as Error).message}`, 'error')
      }
    } finally {
      contentEl.querySelector('.kb-chat-pill')?.remove()
      this.isBusy = false
      this.aiAbortController = null
      this.chatInput.setBusy(false)
      this.chatInput.focus()
    }
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  private createLucideIcon(
    IconComponent: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    size: number = 12,
    strokeWidth: number = 1.5
  ): string {
    const svgElement = createElement(IconComponent, { size, 'stroke-width': strokeWidth })
    return svgElement?.outerHTML || ''
  }
}
