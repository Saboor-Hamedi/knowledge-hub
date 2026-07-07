import { state } from '../../core/state'
import { aiService, type ChatMessage } from '../../services/aiService'
import { agentService } from '../../services/agent/agent-service'
import { sessionStorageService, type ChatSession } from '../../services/sessionStorageService'
import { ragService } from '../../knm/rag/ragService'
import { SessionSidebar } from './session-sidebar'
import { AIMenu, type AIMenuItem } from './ai-menu'
import { AISettingsModal } from '../settings/ai-settings-modal'
import {
  createElement,
  Trash2,
  Info,
  Plus,
  Download,
  PanelRight,
  PanelLeft,
  Upload,
  Archive,
  Settings,
  Check,
  Copy
} from 'lucide'
import { copyConversationToClipboard } from './clipboardUtils'
import './rightbar.css'
import './ai-menu.css'

import { SessionManager, SessionManagerUI } from './SessionManager'
import { ChatRenderer, RendererState } from './ChatRenderer'
import { ConversationController, ConversationControllerUI } from './ConversationController'
import { ChatInput } from '../common/ChatInput'
import '../common/common.css'

// Lazy load highlight.js - load it once when first code block is encountered
let hljsPromise: Promise<unknown> | null = null

const initHighlightJS = (): Promise<unknown> => {
  if (!hljsPromise) {
    hljsPromise = (async () => {
      try {
        const hljsModule = await import('highlight.js')
        const hljs = hljsModule.default
        // Register common languages
        const javascript = await import('highlight.js/lib/languages/javascript')
        const typescript = await import('highlight.js/lib/languages/typescript')
        const json = await import('highlight.js/lib/languages/json')
        const css = await import('highlight.js/lib/languages/css')
        const xml = await import('highlight.js/lib/languages/xml')
        const python = await import('highlight.js/lib/languages/python')
        const bash = await import('highlight.js/lib/languages/bash')
        const yaml = await import('highlight.js/lib/languages/yaml')

        hljs.registerLanguage('javascript', javascript.default)
        hljs.registerLanguage('js', javascript.default)
        hljs.registerLanguage('typescript', typescript.default)
        hljs.registerLanguage('ts', typescript.default)
        hljs.registerLanguage('json', json.default)
        hljs.registerLanguage('css', css.default)
        hljs.registerLanguage('html', xml.default)
        hljs.registerLanguage('xml', xml.default)
        hljs.registerLanguage('python', python.default)
        hljs.registerLanguage('py', python.default)
        hljs.registerLanguage('bash', bash.default)
        hljs.registerLanguage('sh', bash.default)
        hljs.registerLanguage('yaml', yaml.default)
        hljs.registerLanguage('yml', yaml.default)

        // Configure highlighting to ignore unescaped HTML warnings
        // Safe as we sanitize with DOMPurify
        hljs.configure({ ignoreUnescapedHTML: true })

        // Load CSS
        await import('highlight.js/styles/github-dark.css')
        return hljs
      } catch (err) {
        console.warn('[RightBar] Failed to load highlight.js:', err)
        return null
      }
    })()
  }
  return hljsPromise
}

export class RightBar {
  private container: HTMLElement
  private chatContainer!: HTMLElement
  private chatInputArea!: ChatInput
  private slashCommands = [
    { command: '/clear', description: 'Clear current conversation', icon: Trash2 },
    { command: '/new', description: 'Start a new chat session', icon: Plus },
    { command: '/help', description: 'Show available commands', icon: Info },
    { command: '/export', description: 'Export conversation', icon: Download }
  ]
  private isResizing = false
  private startX = 0
  private startWidth = 0
  private currentSessionId: string | null = null
  private wasAtBottom = true
  private aiMenu!: AIMenu
  private sessionSidebar!: SessionSidebar
  private aiSettingsModal: AISettingsModal
  private sessionManager!: SessionManager
  private chatRenderer!: ChatRenderer
  private conversationController!: ConversationController
  private agentControlPanel!: HTMLElement
  private resolveConfirmation: ((val: boolean) => void) | null = null
  private onApplyCode?: (code: string) => void

  constructor(containerId: string, aiSettingsModal: AISettingsModal) {
    this.aiSettingsModal = aiSettingsModal
    this.container = document.getElementById(containerId) as HTMLElement

    // Initialize highlight.js in background
    void initHighlightJS()
    void aiService.loadApiKey()

    const conversationUI: ConversationControllerUI = {
      onStateChange: () => {
        this.renderMessages()
      },
      onMessageAdded: () => {
        this.updateMenuItems()
      },
      onNewSessionRequired: async () => {
        if (!this.currentSessionId) {
          await this.startNewSession()
        }
      },
      onAutoSaveRequired: async () => {
        await this.autoSaveSession()
      },
      onMenuItemsUpdateRequired: () => this.updateMenuItems()
    }

    this.conversationController = new ConversationController(conversationUI)

    this.render()
    this.chatRenderer = new ChatRenderer(this.chatContainer)

    const ui: SessionManagerUI = {
      onSessionLoaded: (session) => {
        this.currentSessionId = session.id
        this.conversationController.setMessages(session.messages)
        const feedback = new Map<number, 'thumbs-up' | 'thumbs-down'>()
        session.messages.forEach((msg, idx) => {
          if (msg.feedback) feedback.set(idx, msg.feedback as 'thumbs-up' | 'thumbs-down')
        })
        this.conversationController.setFeedback(feedback)
      },
      onSessionCreated: (session) => {
        if (this.currentSessionId !== session.id) {
          this.currentSessionId = session.id
          this.conversationController.setMessages(session.messages)
          this.conversationController.clearFeedback()
        }
      },
      onNewSessionStarted: () => {
        this.conversationController.setMessages([])
        this.conversationController.clearFeedback()
      },
      onMenuItemsUpdated: () => this.updateMenuItems(),
      onSessionArchived: () => {
        void this.startNewSession()
      }
    }
    this.sessionManager = new SessionManager(this.sessionSidebar, ui)

    // Set up agent confirmation handler
    agentService.setConfirmHandler(async (command: string) => {
      const { agentExecutor } = await import('../../services/agent/executor')

      const actionMatch = command.match(/^(\w+)/)
      const action = (actionMatch ? actionMatch[1].toLowerCase() : 'command') as string

      const isDelete = action === 'delete' || action === 'rm'
      const actionLabel = isDelete ? 'DELETE' : 'APPLY'

      let detailsHtml = `Execute <strong>${action}</strong>?`

      if (isDelete) {
        const parts = command.split(/\s+/)
        const target = parts[1]?.replace(/^["']|["']$/g, '') || ''
        const folderPath = agentExecutor.resolveFolder(target)
        const note = !folderPath ? agentExecutor.resolveNote(target) : null

        if (folderPath) {
          detailsHtml = `Delete folder <code>${folderPath}</code>?`
        } else if (note) {
          detailsHtml = `Delete note <code>${note.id}</code>?`
        }
      } else if (action === 'write' || action === 'propose' || action === 'patch') {
        const parts = command.match(/^(?:\w+)\s+"?(.+?)"?\s+/)
        const path = parts ? parts[1] : ''
        detailsHtml = `${action.toUpperCase()} <code>${path}</code>?`
      }

      return new Promise((resolve) => {
        this.resolveConfirmation = resolve
        this.renderAgentControl(detailsHtml, actionLabel, isDelete)
      })
    })

    this.attachEvents()
    void this.sessionManager.initialize()
  }

  /**
   * Get current session
   */
  async getCurrentSession(): Promise<ChatSession | null> {
    return await this.sessionManager.getSessionMetadata()
  }

  /**
   * Start a new session
   */
  async startNewSession(): Promise<void> {
    await this.sessionManager.createNewSession([])
  }

  /**
   * Auto-save current session
   */
  private async autoSaveSession(): Promise<void> {
    const messages = this.conversationController.getState().messages
    await this.sessionManager.autoSave(messages)
  }

  /**
   * Load a session by ID
   */
  async loadSession(sessionId: string): Promise<void> {
    await this.sessionManager.loadSession(sessionId)
  }

  setEditorContext(
    getEditorContent: () => string | null,
    getActiveNoteInfo: () => { title: string; id: string } | null,
    getCursorPosition?: () => { line: number; ch: number } | null
  ): void {
    const context = { getEditorContent, getActiveNoteInfo, getCursorPosition }
    aiService.setEditorContext(context)
    agentService.setEditorContext(context)
  }

  setApplyCodeHandler(handler: (code: string) => void): void {
    this.onApplyCode = handler
  }

  public focusInput(): void {
    if (this.chatInputArea) {
      this.chatInputArea.focus()
    }
  }

  private render(): void {
    const sessionIcon = createElement(PanelRight, {
      size: 16,
      'stroke-width': 2
    }).outerHTML

    this.container.innerHTML = `
      <div class="rightbar">
        <div class="rightbar__resize-handle" id="rightbar-resize-handle"></div>
        <div class="rightbar__header">
          <button class="rightbar__header-sessions" id="rightbar-header-sessions" title="Sessions" aria-label="Toggle sessions">
            ${sessionIcon}
          </button>
          <h3 class="rightbar__title"></h3>
          <div class="rightbar__header-actions">
            <div id="rightbar-model-badge" class="rightbar__model-badge"></div>
            <button class="rightbar__header-ai-menu" id="rightbar-header-ai-menu" title="More options" aria-label="AI chat menu"></button>
          </div>
        </div>
        <div class="rightbar__chat-container" id="rightbar-chat-container">
          <div class="rightbar__chat-messages" id="rightbar-chat-messages"></div>
        </div>
        <div class="rightbar__chat-input-wrapper" id="rightbar-chat-input-wrapper">
          <div id="agent-control-host"></div>
        </div>
      </div>
    `
    const rightbarElement = this.container.querySelector('.rightbar') as HTMLElement

    this.chatContainer = this.container.querySelector('#rightbar-chat-messages') as HTMLElement
    const inputWrapper = this.container.querySelector('#rightbar-chat-input-wrapper') as HTMLElement
    this.agentControlPanel = this.container.querySelector('#agent-control-host') as HTMLElement

    this.chatInputArea = new ChatInput(inputWrapper, {
      placeholder: 'Ask anything... @note to mention',
      showModeSwitcher: false,
      showPrompt: false,
      onSend: (text) => this.sendMessage(text),
      onStop: () => this.stopGeneration(),
      onCapabilityChange: () => {
        this.updateMenuItems()
      },
      slashCommands: this.slashCommands
    })
    this.chatInputArea.setMode('ai')

    // Initialize session sidebar - append to the rightbar element
    if (rightbarElement) {
      this.sessionSidebar = new SessionSidebar(rightbarElement)
      this.sessionSidebar.setOnSessionSelect((sessionId) => {
        void this.loadSession(sessionId)
      })
      this.sessionSidebar.setOnNewSession(() => {
        void this.startNewSession()
      })
      this.sessionSidebar.setOnSessionDelete((sessionId) => {
        console.log(`[RightBar] Session deleted: ${sessionId}, current: ${this.currentSessionId}`)
        if (this.currentSessionId === sessionId) {
          // If we deleted the active session, clear everything and start fresh
          void this.startNewSession()
        }
      })

      // Event listeners are handled in attachEvents()

      // Initialize AI Menu
      this.aiMenu = new AIMenu(this.container)
      this.aiMenu.render('rightbar-header-ai-menu')
      this.aiMenu.setOnItemClick((itemId) => {
        void this.handleMenuAction(itemId)
      })
      this.updateMenuItems()
    }

    // Initial model badge
    this.updateModelBadge()

    // Listen for model changes
    window.addEventListener('knowledge-hub:settings-updated', () => {
      this.updateModelBadge()
    })
  }

  private updateModelBadge(): void {
    const badge = this.container.querySelector('#rightbar-model-badge') as HTMLElement
    if (!badge) return

    const provider = state.settings?.aiProvider || 'deepseek'
    let model = state.settings?.aiModel

    // Robust fallback if no model is selected
    if (!model || model === 'default') {
      if (provider === 'ollama') model = 'llama3'
      else if (provider === 'deepseek') model = 'deepseek-chat'
      else if (provider === 'openai') model = 'gpt-4o'
      else if (provider === 'claude') model = 'claude-3-5-sonnet-20240620'
      else if (provider === 'grok') model = 'grok-beta'
      else model = 'default'
    }

    const providerName =
      {
        ollama: 'Local',
        deepseek: 'DeepSeek',
        openai: 'OpenAI',
        claude: 'Claude',
        grok: 'Grok'
      }[provider] || provider

    const checkIcon = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#22c55e" style="margin-left: 4px;">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
    `

    badge.innerHTML = `${model}${checkIcon}`
    badge.title = `Current Provider: ${providerName}\nModel: ${model} (${provider})`
  }

  private attachEvents(): void {
    const resizeHandle = this.container.querySelector('#rightbar-resize-handle') as HTMLElement
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', (e) => this.handleResizeStart(e))
    }

    // Header sessions toggle
    const sessionToggle = this.container.querySelector(
      '#rightbar-header-sessions'
    ) as HTMLButtonElement
    sessionToggle?.addEventListener('click', (e) => {
      console.log('[RightBar] Sessions toggle clicked')
      e.preventDefault()
      e.stopPropagation()
      if (this.sessionSidebar) {
        this.sessionSidebar.toggle()
        this.updateSessionToggleButtonIcon(sessionToggle)
      }
    })

    // Scroll listener to track if user is at bottom
    this.chatContainer.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.chatContainer
      // We are at bottom if we're within 50px of the actual bottom
      this.wasAtBottom = scrollHeight - scrollTop - clientHeight < 50
    })

    this.chatContainer.addEventListener('click', async (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]')
      if (!target) return
      const action = (target as HTMLElement).dataset.action
      const btn = target as HTMLButtonElement
      const state = this.conversationController.getState()

      if (action === 'copy') {
        const messageIndex = parseInt(btn.dataset.messageIndex || '0', 10)
        const message = state.messages[messageIndex]
        if (message) {
          // If the message is a system action, we might want to copy its full content
          // If it's an assistant message that follows rationale -> action, we want the rationale.
          
          let textToCopy = message.content

          // Handle system messages (agent actions) differently
          if (message.role === 'system') {
            const lines = textToCopy.split('\n')
            // If it's a multi-line system message, usually line 0 is the command and the rest is the output
            if (lines.length > 1) {
              const output = lines.slice(1).join('\n').trim()
              if (output && !output.toLowerCase().includes('status: ok')) {
                textToCopy = output
              }
            }
          }

          const cleanText = textToCopy
            .replace(/\[(?:RUN|DONE|FILE|TX):\s*[\s\S]*?\]/g, '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()

          // CRITICAL: If cleaning removed everything or left a generic status, 
          // and this message had a previous rationale (rare in indexed state but possible),
          // or if the user simply wants the original content.
          const isGenericStatus = cleanText.toLowerCase() === 'status: ok' || cleanText === 'ok'
          const finalSelection = (isGenericStatus || !cleanText) ? message.content.trim() : cleanText

          navigator.clipboard
            .writeText(finalSelection)
            .then(() => {
              this.showCopyFeedback(btn)
            })
            .catch(() => {
              // Fallback
              const textarea = document.createElement('textarea')
              textarea.value = finalSelection
              textarea.style.position = 'fixed'
              textarea.style.left = '-9999px'
              textarea.style.top = '0'
              document.body.appendChild(textarea)
              textarea.focus()
              textarea.select()
              try {
                document.execCommand('copy')
                this.showCopyFeedback(btn)
              } catch (err) {
                console.error('Fallback copy failed', err)
              }
              document.body.removeChild(textarea)
            })
        }
      } else if (action === 'thumbs-up' || action === 'thumbs-down') {
        const messageIndex = parseInt(btn.dataset.messageIndex || '0', 10)
        const message = state.messages[messageIndex]
        if (!message) return

        const currentFeedback = state.messageFeedback.get(messageIndex)
        const messageElement = btn.closest('.rightbar__message')

        // Get both buttons for this message
        const thumbsUpBtn = messageElement?.querySelector(
          '[data-action="thumbs-up"]'
        ) as HTMLButtonElement
        const thumbsDownBtn = messageElement?.querySelector(
          '[data-action="thumbs-down"]'
        ) as HTMLButtonElement

        let newFeedback: 'thumbs-up' | 'thumbs-down' | null = null

        if (action === 'thumbs-up') {
          if (currentFeedback === 'thumbs-up') {
            // Toggle off
            const newFeedbackMap = new Map(state.messageFeedback)
            newFeedbackMap.delete(messageIndex)
            this.conversationController.setFeedback(newFeedbackMap)
            thumbsUpBtn?.classList.remove('rightbar__message-action--active')
            newFeedback = null
          } else {
            // Set thumbs up, remove thumbs down
            const newFeedbackMap = new Map(state.messageFeedback)
            newFeedbackMap.set(messageIndex, 'thumbs-up')
            this.conversationController.setFeedback(newFeedbackMap)
            thumbsUpBtn?.classList.add('rightbar__message-action--active')
            thumbsDownBtn?.classList.remove('rightbar__message-action--active')
            newFeedback = 'thumbs-up'
          }
        } else if (action === 'thumbs-down') {
          if (currentFeedback === 'thumbs-down') {
            // Toggle off
            const newFeedbackMap = new Map(state.messageFeedback)
            newFeedbackMap.delete(messageIndex)
            this.conversationController.setFeedback(newFeedbackMap)
            thumbsDownBtn?.classList.remove('rightbar__message-action--active')
            newFeedback = null
          } else {
            // Set thumbs down, remove thumbs up
            const newFeedbackMap = new Map(state.messageFeedback)
            newFeedbackMap.set(messageIndex, 'thumbs-down')
            this.conversationController.setFeedback(newFeedbackMap)
            thumbsDownBtn?.classList.add('rightbar__message-action--active')
            thumbsUpBtn?.classList.remove('rightbar__message-action--active')
            newFeedback = 'thumbs-down'
          }
        }

        // Update message feedback and persist
        message.feedback = newFeedback
        void this.autoSaveSession()

        // Deep RAG Refinement: Record feedback for each citation
        if (newFeedback && message.citations && message.citations.length > 0) {
          // Find the user query that prompted this message
          let userQuery = ''
          for (let i = messageIndex - 1; i >= 0; i--) {
            if (state.messages[i].role === 'user') {
              userQuery = state.messages[i].content
              break
            }
          }

          if (userQuery) {
            const score = newFeedback === 'thumbs-up' ? 1 : -1
            message.citations.forEach((citation) => {
              void ragService.recordFeedback(userQuery, citation.id, score)
            })
          }
        }
      } else if (action === 'retry' && state.lastFailedMessage) {
        const toSend = state.lastFailedMessage
        void this.conversationController.sendMessage(toSend)
      } else if (action === 'regenerate') {
        const messageIndex = parseInt(btn.dataset.messageIndex || '0', 10)
        void this.conversationController.regenerateMessage(messageIndex)
      } else if (action === 'edit') {
        const messageIndex = parseInt(btn.dataset.messageIndex || '0', 10)
        this.editMessage(messageIndex)
      } else if (action === 'citations-toggle') {
        // Find the following buttons and toggle their visibility
        const container = btn.closest('.rightbar__message-citations')
        if (container) {
          const chips = container.querySelectorAll('.rightbar__message-citation')
          const firstChip = chips[0] as HTMLElement | undefined
          const isHidden = firstChip?.style.display === 'none'
          chips.forEach((chip) => {
            ;(chip as HTMLElement).style.display = isHidden ? 'inline-flex' : 'none'
          })
          btn.classList.toggle('is-collapsed', !isHidden)
        }
      } else if (action === 'copy-code') {
        const pre = btn.closest('.rightbar__code-block')?.querySelector('pre')
        const codeEl = pre?.querySelector('code')
        if (codeEl) {
          const codeToCopy = codeEl.dataset.code || codeEl.textContent || ''
          navigator.clipboard
            .writeText(codeToCopy)
            .then(() => this.showCopyFeedback(btn))
            .catch(() => {
              const textarea = document.createElement('textarea')
              textarea.value = codeToCopy
              textarea.style.position = 'fixed'
              textarea.style.left = '-9999px'
              textarea.style.top = '0'
              document.body.appendChild(textarea)
              textarea.focus()
              textarea.select()
              try {
                document.execCommand('copy')
                this.showCopyFeedback(btn)
              } catch (err) {
                console.error('Fallback copy failed', err)
              }
              document.body.removeChild(textarea)
            })
        }
      } else if (action === 'apply-code') {
        const pre = btn.closest('.rightbar__code-block')?.querySelector('pre')
        const codeEl = pre?.querySelector('code')
        const code = codeEl?.dataset.code || codeEl?.textContent
        if (code && this.onApplyCode) {
          this.onApplyCode(code)
          this.showCopyFeedback(btn)
        }
      } else if (action === 'open-file') {
        const path = btn.dataset.path
        if (path) {
          const { agentExecutor } = await import('../../services/agent/executor')
          const note = agentExecutor.resolveNote(path)
          if (note) {
            window.dispatchEvent(
              new CustomEvent('knowledge-hub:open-note', {
                detail: { id: note.id, path: note.path || undefined }
              })
            )
          }
        }
      } else if (btn.classList.contains('rightbar__message-mention')) {
        // Mention click (@note or [[note]])
        const name = btn.dataset.name
        if (name) {
          const { agentExecutor } = await import('../../services/agent/executor')
          const note = agentExecutor.resolveNote(name)
          if (note) {
            window.dispatchEvent(
              new CustomEvent('knowledge-hub:open-note', {
                detail: { id: note.id, path: note.path || undefined }
              })
            )
          }
        }
      }
    })
  }

  /**
   * Update menu items based on current state
   */
  private updateMenuItems(): void {
    const messages = this.conversationController.getState().messages
    const hasMessages = messages.length > 0
    const hasSession = this.currentSessionId !== null

    const items: AIMenuItem[] = [
      {
        id: 'export',
        label: 'Export Session',
        icon: Download,
        onClick: () => {},
        disabled: !hasMessages,
        shortcut: 'Ctrl+E'
      },
      {
        id: 'copy-conversation',
        label: 'Copy Conversation',
        icon: Copy,
        onClick: () => {},
        disabled: !hasMessages
      },
      {
        id: 'import',
        label: 'Import Session',
        icon: Upload,
        onClick: () => {},
        shortcut: 'Ctrl+I'
      },
      { separator: true },
      {
        id: 'clear',
        label: 'Clear Conversation',
        icon: Trash2,
        onClick: () => {},
        disabled: !hasMessages
      },
      {
        id: 'info',
        label: 'Session Info',
        icon: Info,
        onClick: () => {},
        disabled: !hasSession
      },
      {
        id: 'archive',
        label: 'Archive Session',
        icon: Archive,
        onClick: () => {},
        disabled: !hasSession
      },
      { separator: true },
      {
        id: 'settings',
        label: 'AI Settings',
        icon: Settings,
        onClick: () => {}
      }
    ]

    this.aiMenu.setItems(items)
  }

  /**
   * Handle menu action
   */
  private async handleMenuAction(itemId: string): Promise<void> {
    switch (itemId) {
      case 'settings':
        this.aiSettingsModal.open()
        break
      case 'export':
        await this.exportSession()
        break
      case 'copy-conversation':
        await copyConversationToClipboard(this.conversationController.getState().messages)
        break
      case 'import':
        await this.importSession()
        break
      case 'clear':
        await this.clearConversation()
        break
      case 'info':
        await this.showSessionInfo()
        break
      case 'archive':
        await this.archiveSession()
        break
    }
  }

  /**
   * Export current session to Markdown or JSON
   */
  private async exportSession(): Promise<void> {
    const session = await this.getCurrentSession()
    const messages = this.conversationController.getState().messages
    await this.sessionManager.exportToMarkdown(messages, session?.title)
  }

  /**
   * Import session from file
   */
  private async importSession(): Promise<void> {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.json'
      input.style.display = 'none'
      document.body.appendChild(input)

      input.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) {
          document.body.removeChild(input)
          return
        }

        try {
          const text = await file.text()
          const lines = text.split('\n')
          let title = file.name.replace(/\.(md|json)$/i, '')
          const messages: ChatMessage[] = []
          let currentRole: 'user' | 'assistant' | null = null
          let currentContent: string[] = []

          // Enhanced Regex to match exported headers robustly
          const headerRegex = /^### \*\*(You|AI)\*\* \((.+?)\)/i

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (trimmedLine.startsWith('# ')) {
              title = trimmedLine.slice(2).trim()
              continue
            }

            const headerMatch = trimmedLine.match(headerRegex)
            if (headerMatch) {
              if (currentRole && currentContent.length > 0) {
                messages.push({
                  role: currentRole as 'user' | 'assistant',
                  content: currentContent.join('\n').trim(),
                  timestamp: Date.now()
                })
              }
              currentRole = headerMatch[1].toLowerCase() === 'you' ? 'user' : 'assistant'
              currentContent = []
              continue
            }

            if (
              currentRole &&
              !trimmedLine.startsWith('---') &&
              !trimmedLine.startsWith('*Exported')
            ) {
              currentContent.push(line)
            }
          }

          if (currentRole && currentContent.length > 0) {
            messages.push({
              role: currentRole,
              content: currentContent.join('\n').trim(),
              timestamp: Date.now()
            })
          }

          if (messages.length > 0) {
            await this.sessionManager.createNewSession(messages, title)
          }
        } catch (error) {
          console.error('[RightBar] Failed to import session:', error)
        }
        document.body.removeChild(input)
      })
      input.click()
    } catch (error) {
      console.error('[RightBar] Failed to import session:', error)
    }
  }

  /**
   * Clear current conversation
   */
  private async clearConversation(): Promise<void> {
    if (this.conversationController.getState().messages.length === 0) return

    const { modalManager } = await import('../modal/modal')
    modalManager.open({
      title: 'Clear Conversation',
      content: 'Are you sure you want to clear this conversation? This action cannot be undone.',
      size: 'sm',
      buttons: [
        {
          label: 'Clear',
          variant: 'danger',
          onClick: async (m) => {
            m.close()
            await this.startNewSession()
          }
        },
        { label: 'Cancel', variant: 'ghost', onClick: (m) => m.close() }
      ]
    })
  }

  /**
   * Show session information
   */
  private async showSessionInfo(): Promise<void> {
    if (!this.currentSessionId) return

    try {
      const session = await sessionStorageService.getSession(this.currentSessionId)
      if (!session) return

      const createdDate = new Date(session.metadata.created_at).toLocaleString()
      const updatedDate = new Date(session.metadata.updated_at).toLocaleString()
      const messageCount = session.messages.length
      const userMessages = session.messages.filter((m) => m.role === 'user').length
      const assistantMessages = session.messages.filter((m) => m.role === 'assistant').length

      const { modalManager } = await import('../modal/modal')

      // Build custom content element to avoid HTML escaping
      const infoContent = document.createElement('div')
      infoContent.style.fontSize = '12px'
      infoContent.style.lineHeight = '1.6'

      const items = [
        { label: 'Title', value: session.title },
        { label: 'Created', value: createdDate },
        { label: 'Last Updated', value: updatedDate },
        { label: 'Total Messages', value: String(messageCount) },
        { label: 'User Messages', value: String(userMessages) },
        { label: 'AI Messages', value: String(assistantMessages) }
      ]

      if (session.metadata.note_references && session.metadata.note_references.length > 0) {
        items.push({
          label: 'Referenced Notes',
          value: String(session.metadata.note_references.length)
        })
      }

      items.forEach((item) => {
        const p = document.createElement('p')
        p.style.margin = '8px 0'
        const strong = document.createElement('strong')
        strong.textContent = `${item.label}: `
        p.appendChild(strong)
        p.appendChild(document.createTextNode(item.value))
        infoContent.appendChild(p)
      })

      modalManager.open({
        title: 'Session Information',
        customContent: infoContent,
        size: 'sm',
        buttons: [{ label: 'Close', variant: 'primary', onClick: (m) => m.close() }]
      })
    } catch (error) {
      console.error('[RightBar] Failed to show session info:', error)
    }
  }

  /**
   * Archive current session
   */
  private async archiveSession(): Promise<void> {
    if (!this.currentSessionId) return

    try {
      const { modalManager } = await import('../modal/modal')
      modalManager.open({
        title: 'Archive Session',
        content:
          'Are you sure you want to archive this session? You can restore it later from the sessions list.',
        size: 'sm',
        buttons: [
          {
            label: 'Archive',
            variant: 'primary',
            onClick: async (m) => {
              m.close()
              await this.sessionManager.archiveCurrent()
            }
          },
          { label: 'Cancel', variant: 'ghost', onClick: (m) => m.close() }
        ]
      })
    } catch (error) {
      console.error('[RightBar] Failed to archive session:', error)
    }
  }

  private editMessage(index: number): void {
    const state = this.conversationController.getState()
    const message = state.messages[index]
    if (message && message.role === 'user') {
      this.chatInputArea.setValue(message.content)
      this.chatInputArea.focus()
    }
  }

  private handleResizeStart(e: MouseEvent): void {
    e.preventDefault()
    this.isResizing = true
    this.startX = e.clientX
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (shell) {
      const currentWidth = parseInt(
        getComputedStyle(shell).getPropertyValue('--right-panel-width') || '270',
        10
      )
      this.startWidth = currentWidth
    }
    document.addEventListener('mousemove', this.handleResizeMove)
    document.addEventListener('mouseup', this.handleResizeEnd)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  private handleResizeMove = (e: MouseEvent): void => {
    if (!this.isResizing) return
    const deltaX = this.startX - e.clientX
    const newWidth = Math.max(200, Math.min(800, this.startWidth + deltaX))
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (shell) shell.style.setProperty('--right-panel-width', `${newWidth}px`)
  }

  private handleResizeEnd = (): void => {
    if (!this.isResizing) return
    this.isResizing = false
    document.removeEventListener('mousemove', this.handleResizeMove)
    document.removeEventListener('mouseup', this.handleResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    const shell = document.querySelector('.vscode-shell') as HTMLElement
    if (shell) {
      const w = parseInt(
        getComputedStyle(shell).getPropertyValue('--right-panel-width') || '270',
        10
      )
      if (w > 0) void window.api.updateSettings({ rightPanelWidth: w })
    }
  }

  private stopGeneration(): void {
    this.conversationController.stopGeneration()
  }

  private updateGenerationUI(loading: boolean): void {
    if (this.chatInputArea) {
      this.chatInputArea.setBusy(loading, loading ? 'Thinking...' : undefined)
    }
  }

  private async sendMessage(text?: string): Promise<void> {
    const finalSelection = text || this.chatInputArea.getPlainText().trim()
    if (!finalSelection) return

    // Handle slash commands
    if (finalSelection.startsWith('/')) {
      const parts = finalSelection.split(' ')
      const command = parts[0].toLowerCase()
      const isKnownCommand = this.slashCommands.some((c) => c.command === command)

      if (isKnownCommand) {
        switch (command) {
          case '/clear':
            this.chatInputArea.clear()
            await this.clearConversation()
            return
          case '/new':
            this.chatInputArea.clear()
            await this.startNewSession()
            return
          case '/help':
            await this.conversationController.addMessage(
              'assistant',
              `**Available Commands:**\n\n` +
                this.slashCommands.map((c) => `- \`${c.command}\`: ${c.description}`).join('\n')
            )
            this.chatInputArea.clear()
            return
          case '/export':
            this.chatInputArea.clear()
            await this.exportSession()
            return
        }
      }
    }

    // Clear and send
    this.chatInputArea.clear()
    await this.conversationController.sendMessage(finalSelection)
  }

  private updateSessionToggleButtonIcon(btn: HTMLButtonElement): void {
    if (!this.sessionSidebar) return
    const isOpen = this.sessionSidebar.isVisible()
    const icon = createElement(isOpen ? PanelLeft : PanelRight, {
      size: 16,
      'stroke-width': 2
    })
    btn.innerHTML = ''
    btn.appendChild(icon)
  }

  private showCopyFeedback(button: HTMLElement): void {
    const originalHTML = button.innerHTML
    const isSmall = button.classList.contains('rightbar__message-action')
    // Use 'any' for Lucide icon components to avoid type errors since we don't have the type exported
    const iconComponent = Check as Parameters<typeof createElement>[0]
    const size = isSmall ? 12 : 14
    const stroke = isSmall ? 2 : 1.5
    const colorValue = isSmall ? '#22c55e' : undefined

    button.innerHTML = createElement(iconComponent, {
      size,
      'stroke-width': stroke,
      ...(colorValue ? { color: colorValue } : {})
    }).outerHTML
    button.classList.add(
      isSmall ? 'rightbar__message-action--copied' : 'rightbar__code-copy--copied'
    )
    const originalTitle = button.title
    button.title = 'Copied!'

    setTimeout(() => {
      button.innerHTML = originalHTML
      button.classList.remove(
        isSmall ? 'rightbar__message-action--copied' : 'rightbar__code-copy--copied'
      )
      button.title = originalTitle
    }, 2000)
  }

  private renderAgentControl(html: string, actionLabel: string, isDanger: boolean): void {
    const variantClass = isDanger ? 'is-danger' : 'is-primary'
    this.agentControlPanel.innerHTML = `
      <div class="rightbar__agent-control ${variantClass}">
        <div class="rightbar__agent-control-content">
          <span class="rightbar__agent-control-icon">🤖</span>
          <span class="rightbar__agent-control-text">${html}</span>
        </div>
        <div class="rightbar__agent-control-actions">
          <button class="rightbar__agent-control-btn is-cancel" title="Reject (Esc)">REJECT</button>
          <button class="rightbar__agent-control-btn is-confirm" title="Approve (Enter)">${actionLabel}</button>
        </div>
      </div>
    `
    this.agentControlPanel.classList.add('visible')
    this.container.querySelector('.rightbar')?.classList.add('has-agent-control')

    const confirmBtn = this.agentControlPanel.querySelector('.is-confirm') as HTMLElement
    const cancelBtn = this.agentControlPanel.querySelector('.is-cancel') as HTMLElement

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmBtn.click()
        document.removeEventListener('keydown', handleKeyDown)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelBtn.click()
        document.removeEventListener('keydown', handleKeyDown)
      }
    }

    confirmBtn.onclick = () => {
      this.resolveConfirmation?.(true)
      this.clearAgentControl()
      document.removeEventListener('keydown', handleKeyDown)
    }

    cancelBtn.onclick = () => {
      this.resolveConfirmation?.(false)
      this.clearAgentControl()
      document.removeEventListener('keydown', handleKeyDown)
    }

    document.addEventListener('keydown', handleKeyDown)
  }

  private clearAgentControl(): void {
    this.agentControlPanel.classList.remove('visible')
    this.container.querySelector('.rightbar')?.classList.remove('has-agent-control')
    setTimeout(() => {
      this.agentControlPanel.innerHTML = ''
    }, 200)
    this.resolveConfirmation = null
  }

  private renderMessages(): void {
    const convState = this.conversationController.getState()
    const state: RendererState = {
      messages: convState.messages,
      isLoading: convState.isLoading,
      isExecutingCommand: convState.isExecutingCommand,
      streamingMessageIndex: convState.streamingMessageIndex,
      messageFeedback: convState.messageFeedback,
      lastFailedMessage: convState.lastFailedMessage
    }
    this.chatRenderer.render(state, this.wasAtBottom)
    this.updateGenerationUI(convState.isLoading || convState.isExecutingCommand)

    // Trigger highlighting
    if (convState.messages.length > 0) {
      void this.chatRenderer.highlightAll(() => initHighlightJS(), !convState.isLoading)
    }
  }

  async refreshApiKey(): Promise<void> {
    await aiService.loadApiKey()

    const wasEmpty = this.conversationController.getState().messages.length === 0
    this.render()
    this.attachEvents()
    if (wasEmpty && !aiService.getApiKey()) {
      void this.conversationController.addMessage(
        'assistant',
        '👋 **Welcome!** Add your DeepSeek API key in **Settings → Behavior → DeepSeek API Key**. Get it at [platform.deepseek.com](https://platform.deepseek.com)'
      )
    }
  }
}
