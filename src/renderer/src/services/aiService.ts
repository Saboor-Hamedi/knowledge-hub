import { state } from '../core/state'
import { ragService } from '../knm/rag/ragService'
import { agentExecutor } from './agent/executor'
import type { TreeItem } from '../core/types'
import { aiProviderManager } from './ai/provider-manager'
import { AIMessage } from './ai/providers/base'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  feedback?: 'thumbs-up' | 'thumbs-down' | null
  messageId?: string // Unique ID for tracking
  citations?: NoteCitation[] // Notes used in this response
}

export interface EditorContext {
  getEditorContent: () => string | null
  getActiveNoteInfo: () => { title: string; id: string } | null
  getCursorPosition?: () => { line: number; ch: number } | null
}

export interface VaultNote {
  id: string
  title: string
  content: string
  path?: string
}

interface NoteMetadata {
  id: string
  title: string
  path?: string
}

interface ScoredNote extends VaultNote {
  score: number
  relevanceSnippets?: string[]
}

const IDE_AGENT_INSTRUCTIONS = `
# SYSTEM IDENTITY: KNOWLEDGE HUB EXPERT COLLABORATOR
You are a friendly, world-class software engineer. You act as a senior pair programmer and architectural guide. 

## 1. MANDATORY PROTOCOLS [CRITICAL]
- **PROTOCOL [A]: PASSIVE ANALYSIS ONLY (DEFAULT).** NEVER use [RUN: patch], [RUN: write], or [RUN: propose] unless the user explicitly orders you to "apply it", "fix this", "change that", or "save it". For all other requests (e.g. "what do you see?", "analyze this"), ONLY provide text analysis.
- **PROTOCOL [B]: BRAINSTORM FIRST.** Discuss problems and potential solutions with the user before jumping into code edits.
- **PROTOCOL [C]: HUMAN COMMUNICATION.** Talk like a human engineer. Be helpful and professional. Avoid being robotic, sterile, or curt. 
- **PROTOCOL [D]: ZERO DUPLEX-WRITING.** Never repeat code in chat that you put in a [RUN:] command.

## 2. SURGICAL COMMANDS
- **[RUN: read "path" "#L1-100"]**: Precise reading.
- **[RUN: patch-line "current" index "content"]**: Change exactly ONE line by index. Use this for 90% of simple logic fixes.
- **[RUN: patch "current" "search" "replace" "ctxBefore" "ctxAfter"]**: Multi-line block. Ensure "search" is distinct and includes sufficient context.
- **[RUN: write "path" "content"]**: Create NEW files.
- **[RUN: propose "current" "content"]**: Full file replace (ONLY for massive >70% rewrites).

## 3. FLOW
Provide a helpful, human explanation of your thoughts -> (If asked) Execute command -> STOP.
`

export interface NoteCitation {
  id: string
  title: string
  path?: string
}

export type ChatMode = 'balanced' | 'thinking' | 'creative' | 'precise' | 'code'

export interface ChatModeConfig {
  id: ChatMode
  label: string
  icon: string
  description: string
  temperature: number
  systemPrompt?: string
}

export const CHAT_MODES: ChatModeConfig[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    icon: '⚖️',
    description: 'General purpose responses',
    temperature: 0.7,
    systemPrompt:
      'You are Knowledge Hub AI. Follow the "Knowledge Hub" principle: Ultra-concise, high-density. No conversational filler. If responding to a [RUN:] Success message, just say "Done." and DO NOT repeat the code or summarize.'
  },
  {
    id: 'thinking',
    label: 'Thinking',
    icon: '🧠',
    description: 'Deep reasoning and analysis',
    temperature: 0.3,
    systemPrompt:
      'Use <thought> blocks for internal reasoning. If a task is successful, provide a one-sentence technical validation and DO NOT repeat the code.'
  },
  {
    id: 'creative',
    label: 'Creative',
    icon: '✨',
    description: 'More imaginative responses',
    temperature: 0.9,
    systemPrompt: 'Be creative and imaginative. Think outside the box.'
  },
  {
    id: 'precise',
    label: 'Precise',
    icon: '🎯',
    description: 'Factual and concise',
    temperature: 0.1,
    systemPrompt:
      'STRICT: Answer in 5-10 words MAX. If a command succeeded, respond only with a checkmark "✅". ZERO PROSE.'
  },
  {
    id: 'code',
    label: 'Code',
    icon: '💻',
    description: 'Optimized for coding tasks',
    temperature: 0.2,
    systemPrompt:
      'Expert developer. Provide code blocks OR [RUN:] commands. NEVER both if redundant. If responding to Success, just say "Done." and DO NOT repeat the code block.'
  }
]

export class AIService {
  private apiKey: string | null = null
  private editorContext?: EditorContext
  private vaultCache: Map<string, VaultNote> = new Map()
  private vaultMetadataCache: Map<string, NoteMetadata> = new Map()
  private vaultCacheTime: number = 0
  private readonly CACHE_DURATION = 300000 // 5 minutes for performance
  private readonly MAX_CONTEXT_TOKENS = 64000
  private readonly MAX_NOTES_TO_LOAD = 50 // Limit notes loaded at once
  private readonly MAX_CONTENT_LENGTH = 100000 // Support large code files without truncation
  private currentMode: ChatMode = 'balanced'

  constructor() {
    // Load persisted mode from localStorage
    const savedMode = localStorage.getItem('ai-chat-mode') as ChatMode | null
    if (savedMode && CHAT_MODES.some((m) => m.id === savedMode)) {
      this.currentMode = savedMode
    }
  }

  setMode(mode: ChatMode): void {
    this.currentMode = mode
    // Persist mode to localStorage
    localStorage.setItem('ai-chat-mode', mode)
    // Also persist to app settings for cross-session persistence
    void window.api.updateSettings({ aiChatMode: mode })
  }

  getMode(): ChatMode {
    return this.currentMode
  }

  getModeConfig(): ChatModeConfig {
    return CHAT_MODES.find((m) => m.id === this.currentMode) || CHAT_MODES[0]
  }

  async loadApiKey(): Promise<void> {
    try {
      const settings = (await window.api.getSettings()) as Record<string, unknown>
      // We check for any valid configuration now
      const hasConfig =
        settings.deepseekApiKey ||
        settings.openaiApiKey ||
        settings.claudeApiKey ||
        settings.grokApiKey ||
        settings.aiProvider === 'ollama'

      this.apiKey = hasConfig ? 'configured' : null
      // Initialize RAG
      this.initRag()
    } catch (err) {
      console.error('[AIService] Failed to load settings:', err)
    }
  }

  /**
   * Clear all in-memory caches (called on vault switch)
   */
  public clearCache(): void {
    this.vaultCache.clear()
    this.vaultMetadataCache.clear()
    this.vaultCacheTime = 0
    console.log('[AIService] Caches cleared')
  }

  private async initRag(): Promise<void> {
    try {
      await ragService.configureProvider('local')
      await ragService.init()

      // Switch to vault-specific DB immediately
      const vault = await window.api.getVault()
      if (vault?.path) {
        this.clearCache() // Clear in-memory caches when switching vault
        await ragService.switchVault(vault.path)
      }
    } catch (err) {
      console.warn('[AIService] Failed to init RAG, falling back to TF-IDF:', err)
    }
  }

  setEditorContext(context: EditorContext): void {
    this.editorContext = context
  }

  getApiKey(): string | null {
    return this.apiKey
  }

  /**
   * Load note metadata only (lightweight, fast)
   */
  private async loadVaultMetadata(): Promise<NoteMetadata[]> {
    const now = Date.now()

    // Return cached metadata if still valid
    if (this.vaultMetadataCache.size > 0 && now - this.vaultCacheTime < this.CACHE_DURATION) {
      return Array.from(this.vaultMetadataCache.values())
    }

    try {
      const notesTree = await window.api.listNotes()
      const metadata: NoteMetadata[] = []

      const flattenNotes = (items: TreeItem[], parentPath?: string): void => {
        for (const item of items) {
          if (item.type === 'note') {
            metadata.push({
              id: item.id,
              title: item.title,
              path: item.path || parentPath
            })
          } else if (item.type === 'folder' && item.children) {
            flattenNotes(item.children, item.path || parentPath)
          }
        }
      }

      flattenNotes(notesTree as TreeItem[])

      // Update metadata cache
      this.vaultMetadataCache.clear()
      metadata.forEach((meta) => {
        this.vaultMetadataCache.set(meta.id, meta)
      })
      this.vaultCacheTime = now

      return metadata
    } catch (error) {
      console.error('[AIService] Failed to load vault metadata:', error)
      return Array.from(this.vaultMetadataCache.values())
    }
  }

  /**
   * Load note content on-demand (lazy loading)
   */
  private async loadNoteContent(noteId: string, path?: string): Promise<string> {
    // Check cache first
    const cached = this.vaultCache.get(noteId)
    if (cached) {
      return cached.content
    }

    try {
      const noteData = await window.api.loadNote(noteId, path)
      const content = noteData?.content || ''

      // Cache it
      const metadata = this.vaultMetadataCache.get(noteId)
      if (metadata) {
        this.vaultCache.set(noteId, {
          id: noteId,
          title: metadata.title,
          content,
          path: metadata.path
        })
      }

      return content
    } catch (error) {
      console.warn(`[AIService] Failed to load note ${noteId}:`, error)
      return ''
    }
  }

  /**
   * Extract keywords and expand query
   */
  private extractQueryTerms(query: string): string[] {
    const lowerQuery = query.toLowerCase()
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'what',
      'which',
      'who',
      'where',
      'when',
      'why',
      'how'
    ])
    const words = lowerQuery.split(/[\s\W]+/).filter((w) => w.length >= 3 && !stopWords.has(w))
    return Array.from(new Set(words))
  }

  /**
   * Generate multiple query variations to improve search recall
   */
  private generateMultiQueries(query: string): string[] {
    const terms = this.extractQueryTerms(query)
    const variations = [query]

    // 1. Term-only query
    if (terms.length > 0) {
      variations.push(terms.join(' '))
    }

    // 2. Focused query (first 3 terms)
    if (terms.length > 3) {
      variations.push(terms.slice(0, 3).join(' '))
    }

    // 3. Synonym-like expansion for code tasks
    if (query.toLowerCase().includes('fix') || query.toLowerCase().includes('bug')) {
      variations.push(`${query} error issue failure`)
    }
    if (query.toLowerCase().includes('how to') || query.toLowerCase().includes('implement')) {
      variations.push(`${query} example tutorial documentation`)
    }

    return Array.from(new Set(variations)).slice(0, 3)
  }

  /**
   * Calculate TF-IDF score for better relevance
   */
  private calculateRelevanceScore(
    queryTerms: string[],
    noteTitle: string,
    noteContent: string,
    allNotes: NoteMetadata[]
  ): number {
    const lowerTitle = noteTitle.toLowerCase()
    const lowerContent = noteContent.toLowerCase()
    let score = 0

    queryTerms.forEach((term) => {
      if (lowerTitle.includes(term)) {
        score += 20
      }
      if (lowerTitle.includes(queryTerms.join(' '))) {
        score += 30
      }
    })

    queryTerms.forEach((term) => {
      const titleMatches = (lowerTitle.match(new RegExp(term, 'g')) || []).length
      const contentMatches = (lowerContent.match(new RegExp(term, 'g')) || []).length
      const termFrequency = titleMatches * 3 + contentMatches
      const documentFrequency = allNotes.filter((n) => n.title.toLowerCase().includes(term)).length
      const idf = documentFrequency > 0 ? Math.log(allNotes.length / documentFrequency) : 1
      score += termFrequency * idf
    })

    const matchedTerms = queryTerms.filter(
      (term) => lowerTitle.includes(term) || lowerContent.includes(term)
    ).length
    score += matchedTerms * 5

    // Huge boost for exact title match (ignoring case)
    const fullQuery = queryTerms.join(' ')
    if (lowerTitle === fullQuery || lowerTitle === fullQuery.replace(/^@/, '')) {
      score += 500
    }

    return score
  }

  /**
   * Extract relevant snippets from note content
   */
  private extractRelevantSnippets(
    content: string,
    queryTerms: string[],
    maxLength: number = 300
  ): string[] {
    const sentences = content.split(/[.!?]\s+/)

    const scoredSentences = sentences.map((sentence) => {
      const lowerSentence = sentence.toLowerCase()
      let score = 0
      queryTerms.forEach((term) => {
        if (lowerSentence.includes(term)) {
          score += (lowerSentence.match(new RegExp(term, 'g')) || []).length
        }
      })
      return { sentence, score }
    })

    const topSentences = scoredSentences
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.sentence)

    if (topSentences.length > 0) {
      const combined = topSentences.join('. ')
      return [combined.length > maxLength ? combined.substring(0, maxLength) + '...' : combined]
    }

    return [content.substring(0, maxLength) + '...']
  }

  /**
   * Find relevant notes with smart scoring (lazy loading) - NEW VERSION
   */
  private async findRelevantNotes(userMessage: string, limit: number = 5): Promise<ScoredNote[]> {
    try {
      const allMetadata = await this.loadVaultMetadata()
      if (allMetadata.length === 0) return []

      const queryTerms = this.extractQueryTerms(userMessage)
      if (queryTerms.length === 0) return []

      const scoredMetadata = await Promise.all(
        allMetadata.map(async (meta) => {
          const lowerTitle = meta.title.toLowerCase()
          let quickScore = 0
          queryTerms.forEach((term) => {
            if (lowerTitle.includes(term)) quickScore += 10
          })
          return { meta, quickScore }
        })
      )

      const topCandidates = scoredMetadata
        .filter((item) => item.quickScore > 0)
        .sort((a, b) => b.quickScore - a.quickScore)
        .slice(0, Math.min(limit * 3, this.MAX_NOTES_TO_LOAD))
        .map((item) => item.meta)

      const scoredNotes: ScoredNote[] = []

      for (const meta of topCandidates) {
        try {
          const content = await this.loadNoteContent(meta.id, meta.path)
          if (content.length === 0) continue

          const score = this.calculateRelevanceScore(queryTerms, meta.title, content, allMetadata)
          if (score > 0) {
            const snippets = this.extractRelevantSnippets(content, queryTerms)
            scoredNotes.push({
              id: meta.id,
              title: meta.title,
              content,
              path: meta.path,
              score,
              relevanceSnippets: snippets
            })
          }
        } catch (error) {
          console.warn(`[AIService] Failed to score note ${meta.id}:`, error)
        }
      }

      // Higher threshold for relevance - filter out weak matches
      return scoredNotes
        .filter((n) => n.score > 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10) // Increased from 5 to 10
    } catch (error) {
      console.error('[AIService] Failed to find relevant notes:', error)
      return []
    }
  }

  /**
   * Hybrid search: Try RAG first, fall back to TF-IDF
   */
  private async findRelevantNotesHybrid(
    userMessage: string,
    limit: number = 5
  ): Promise<ScoredNote[]> {
    const scoredNotes: ScoredNote[] = []
    try {
      // 1. Try Vector RAG
      // Use the full message for embeddings as modern models handle context well
      const ragResults = await ragService.search(userMessage, limit)

      if (ragResults && ragResults.length > 0) {
        // Hydrate results with content
        for (const res of ragResults) {
          try {
            const content = await this.loadNoteContent(res.id, res.metadata?.path)
            if (content) {
              scoredNotes.push({
                id: res.id,
                title: res.metadata?.title || 'Unknown Note',
                content,
                path: res.metadata?.path,
                score: res.score * 100 // Scale cosine (0-1) to be comparable roughly
              })
            }
          } catch {
            // Ignore load error
          }
        }

        if (scoredNotes.length > 0) {
          console.log(`[AIService] Hydrated ${scoredNotes.length} RAG results`)
        }
      }
    } catch (err) {
      console.warn('[AIService] RAG search failed, falling back to TF-IDF:', err)
    }

    // 2. Fallback/Supplement with TF-IDF
    const tfidfResults = await this.findRelevantNotes(userMessage, limit)

    // Merge results, removing duplicates by ID
    const merged = [...scoredNotes]
    tfidfResults.forEach((tfidf) => {
      if (!merged.find((m) => m.id === tfidf.id)) {
        merged.push(tfidf)
      }
    })

    return merged.sort((a, b) => b.score - a.score).slice(0, limit + 2)
  }

  /**
   * Find relevant notes based on user message (OLD VERSION - kept for compatibility)
   */
  /**
   * Build context message with smart RAG (lightweight and robust)
   * Returns both the context string and citations of notes used
   */
  async buildContextMessage(
    userMessage: string
  ): Promise<{ context: string; citations: NoteCitation[] }> {
    // FIRST: Check if user is telling us to stop explaining or just wants direct help
    const stopPhrases =
      /\b(stop|don't explain|dont explain|just help|just fix|no explanation|skip the|enough|stop explaining|stop it|please stop)\b/i
    const isStopCommand = stopPhrases.test(userMessage)

    const trimmed = userMessage.trim().toLowerCase()
    const isAcknowledgment =
      /^(hi|hello|hey|ok|okay|thanks|good|cool|nice|👍|yep|yeah|yes)\W*$/i.test(trimmed)

    if (isStopCommand || isAcknowledgment) {
      return { context: userMessage, citations: [] }
    }

    let context = ''
    const citations: NoteCitation[] = []

    const loadedNoteIds = new Set<string>()

    // Get current note context (but keep it minimal)
    if (this.editorContext) {
      const noteInfo = this.editorContext.getActiveNoteInfo?.()
      const editorContent = this.editorContext.getEditorContent?.()

      if (noteInfo) {
        context += `Current note: "${noteInfo.title}"\n`
        citations.push({ id: noteInfo.id, title: noteInfo.title })
        loadedNoteIds.add(noteInfo.id)
      }

      const cursor = this.editorContext.getCursorPosition?.()
      if (cursor) {
        context += `Cursor position: Line ${cursor.line + 1}, Column ${cursor.ch + 1}\n`
      }

      // ALWAYS include the current note's content if it exists
      if (editorContent && editorContent.trim()) {
        const contentPreview =
          editorContent.length > this.MAX_CONTENT_LENGTH
            ? editorContent.substring(0, this.MAX_CONTENT_LENGTH) + '...'
            : editorContent
        context += `\nNote content:\n${contentPreview}\n\n`
      }
    }

    // Proactive Vault Access: Always check the vault unless it's a very short greeting/ack.
    const isGreeting = /^(hello|hi|hey|greetings|hiya|yo|ok|okay|thanks)\W*$/i.test(trimmed)
    const needsVault = !isGreeting && trimmed.length > 5

    if (!needsVault) {
      return { context: context + userMessage, citations }
    }

    try {
      // PHASE 2: Augmented Retrieval - Multi-Query Expansion with Timeout for Hybrid Mode
      const queries = this.generateMultiQueries(userMessage)
      const allRelevantNotes: ScoredNote[] = []

      // Hybrid Search Timeout: If RAG takes too long (e.g. busy indexing),
      // we fall back to what we already have (active file + file tree).
      const MAX_SEARCH_TIME = 2000 // 2 seconds

      for (const q of queries) {
        try {
          // Use Promise.race to ensure we don't hang the chat if RAG is busy
          const results = await Promise.race([
            this.findRelevantNotesHybrid(q, 3),
            new Promise<ScoredNote[]>((_, reject) =>
              setTimeout(() => reject(new Error('Search timeout')), MAX_SEARCH_TIME)
            )
          ])

          results.forEach((res) => {
            if (!allRelevantNotes.find((n) => n.id === res.id)) {
              allRelevantNotes.push(res)
            }
          })
        } catch (err) {
          console.warn(`[AIService] Search for query "${q}" timed out or failed:`, err)
          // Continue to next query or finish with what we have
        }
      }

      // Re-sort by score and limit
      let relevantNotes = allRelevantNotes.sort((a, b) => b.score - a.score).slice(0, 7)

      // DE-DUPLICATE: Filter out notes already loaded via Editor Context
      relevantNotes = relevantNotes.filter((n) => !loadedNoteIds.has(n.id))

      if (relevantNotes.length > 0) {
        context += `\nRelevant notes from vault (${relevantNotes.length} most relevant):\n`

        let totalLength = 0
        for (const note of relevantNotes) {
          // Use snippets if available, otherwise truncate
          const contentToShow =
            note.relevanceSnippets && note.relevanceSnippets.length > 0
              ? note.relevanceSnippets.join(' ')
              : note.content.length > this.MAX_CONTENT_LENGTH
                ? note.content.substring(0, this.MAX_CONTENT_LENGTH) + '...'
                : note.content

          const path = note.path ? ` [${note.path}]` : ''
          const noteContext = `\n"${note.title}"${path}:\n${contentToShow}\n`

          // Estimate tokens (rough: 1 token ≈ 4 chars)
          const estimatedTokens = noteContext.length / 4

          // Don't exceed context window
          if (totalLength + estimatedTokens > this.MAX_CONTEXT_TOKENS * 0.6) {
            context += `\n... and ${relevantNotes.length - relevantNotes.indexOf(note)} more relevant notes.\n`
            break
          }

          context += noteContext
          totalLength += estimatedTokens

          // Add to citations
          if (!citations.find((c) => c.id === note.id)) {
            citations.push({ id: note.id, title: note.title, path: note.path })
          }
        }
      } else {
        context += `\nNo relevant notes found in vault matching your query.\n`
      }

      context += `\nYou can reference any note by its title. When the user asks about their vault or notes, you have full context.\n`
    } catch (error) {
      console.error('[AIService] Failed to load vault for context:', error)
      context +=
        '\nNote: Unable to load vault at this time. You can still help with the current note.\n'
    }

    context += `\n\n=== USER QUESTION ===\n${userMessage}`

    return { context, citations }
  }

  async callDeepSeekAPI(
    messages: ChatMessage[],
    contextMessage: string | { context: string; citations: NoteCitation[] }
  ): Promise<string> {
    const context = typeof contextMessage === 'string' ? contextMessage : contextMessage.context
    const modeConfig = this.getModeConfig()

    try {
      const messagesForAPI = this.prepareMessages(modeConfig, context, messages)

      return await aiProviderManager.sendMessage(messagesForAPI, {
        temperature: modeConfig.temperature
      })
    } catch (err: unknown) {
      throw this.handleAIError(err)
    }
  }

  private handleAIError(err: unknown): Error {
    const error = err as Error
    const provider = (state.settings?.aiProvider || 'deepseek') as string

    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      if (provider === 'ollama') {
        const url = state.settings?.ollamaBaseUrl || 'http://localhost:11434'
        let hint = ''

        // Detect common typo: localhost/11434 instead of localhost:11434
        if (url.includes('localhost/') && /\d{4,5}$/.test(url)) {
          const suggested = url.replace('localhost/', 'localhost:')
          hint = `\n\n💡 **Typo detected?** It looks like you might have used a slash instead of a colon. Try using \`${suggested}\` in settings.`
        }

        return new Error(
          `🔴 **Local Ollama connection failed**\n\nEnsure your Ollama server is running at [\`${url}\`](${url}).\n\nYou can start it by running \`ollama serve\` in your terminal.${hint}`
        )
      }
      return new Error(
        `🔴 **Network error**\n\nUnable to connect to ${provider}. Please check your internet connection and API configuration.`
      )
    }
    return error
  }

  /**
   * Call DeepSeek API with streaming support
   * @param messages - Chat messages array
   * @param contextMessage - Context-aware user message
   * @param onChunk - Callback for each chunk received
   * @param signal - Optional AbortSignal for cancellation
   * @returns Full response text
   */
  async callDeepSeekAPIStream(
    messages: ChatMessage[],
    contextMessage: string | { context: string; citations: NoteCitation[] },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    // Handle both old string format and new object format for backward compatibility
    const context = typeof contextMessage === 'string' ? contextMessage : contextMessage.context
    const modeConfig = this.getModeConfig()

    try {
      const messagesForAPI = this.prepareMessages(modeConfig, context, messages)

      let fullText = ''
      const stream = aiProviderManager.streamResponse(messagesForAPI, {
        temperature: modeConfig.temperature,
        signal
      })

      for await (const chunk of stream) {
        if (signal?.aborted) break
        fullText += chunk
        onChunk(chunk)
      }

      return fullText
    } catch (err: unknown) {
      const error = err as Error
      if (error.name === 'AbortError') {
        // User cancelled the request - this is expected, not an error
        return ''
      }
      throw this.handleAIError(err)
    }
  }

  /**
   * Internal helper to build the messages array with identity awareness
   */
  private prepareMessages(
    modeConfig: ChatModeConfig,
    context: string,
    messages: ChatMessage[]
  ): AIMessage[] {
    const provider = state.settings?.aiProvider || 'deepseek'
    const model = state.settings?.aiModel || 'default-recommended'
    // Auto-inject tree from state
    const workspaceTree = agentExecutor.formatTree(state.tree, '', 50) // limit to 50 items for speed
    const treeContext = workspaceTree ? `\n\nCURRENT WORKSPACE STRUCTURE:\n${workspaceTree}\n` : ''

    // Identity injection: We tell the AI who it is and what it's running on
    const identityPrompt =
      `You are Knowledge Hub AI. Powered by ${provider.toUpperCase()} (${model}).\n` +
      IDE_AGENT_INSTRUCTIONS +
      `\n\nWORKSPACE CONTEXT:\n` +
      `- Trust the CURRENT WORKSPACE STRUCTURE provided below for paths.\n` +
      `- Use EXACT path matches from the structure for "mkdir", "write", "patch", etc.\n` +
      `- TRUST THE PROVIDED NOTE CONTENT IN CONTEXT AS THE ABSOLUTE SOURCE OF TRUTH.`

    const messagesForAPI: AIMessage[] = []

    // 1. Add System Prompt (Identity + Mode behavior)
    const basePrompt = modeConfig.systemPrompt || 'You are a helpful assistant.'
    messagesForAPI.push({
      role: 'system',
      content: `${identityPrompt}${treeContext}\n\n${basePrompt}`
    })

    // 2. Add History
    const history: AIMessage[] = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

    // Remove the last message if it's from user, because we will re-add it (potentially enhanced) as 'context'
    if (history.length > 0 && history[history.length - 1].role === 'user') {
      history.pop()
    }

    messagesForAPI.push(...history)

    // 3. Add Final Context-Aware Prompt
    messagesForAPI.push({ role: 'user', content: context })

    return messagesForAPI
  }
}

export const aiService = new AIService()
