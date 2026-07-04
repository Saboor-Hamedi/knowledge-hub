import { VectorDB } from './vector-db'
import { pipeline, env } from '@xenova/transformers'
import type { RagWorkerJob } from './rag.worker.types'

if (env) {
  ;(env as any).allowLocalModels = false
  ;(env as any).allowRemoteModels = true
  ;(env as any).useBrowserCache = false
  ;(env as any).remoteHost = 'https://huggingface.co'
  ;(env as any).remotePrefix = 'models/'
}

const db = new VectorDB()
let extractor: any = null
let initPromise: Promise<void> | null = null

// --- Priority Queue Logic ---
const highPriorityQueue: RagWorkerJob[] = []
const lowPriorityQueue: RagWorkerJob[] = []
let isProcessing = false

const HIGH_PRIORITY_TYPES = ['init', 'search', 'embed', 'switch-vault', 'delete', 'debug']

async function initModel(): Promise<void> {
  if (extractor) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    try {
      console.log('[RagWorker] Pipeline loading...')
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: false
      })
      console.log('[RagWorker] Pipeline ready')
    } catch (err: any) {
      console.error('[RagWorker] Init error:', err)
      initPromise = null
      throw err
    }
  })()

  return initPromise
}

async function computeHash(content: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function cosineSimilarity(
  vecA: Float32Array | number[],
  vecB: Float32Array | number[]
): number {
  if (vecA.length !== vecB.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

const ctx: Worker = self as any

ctx.addEventListener('message', (event: MessageEvent<RagWorkerJob>) => {
  const job = event.data
  if (HIGH_PRIORITY_TYPES.includes(job.type)) {
    highPriorityQueue.push(job)
  } else {
    lowPriorityQueue.push(job)
  }
  processQueue()
})

async function processQueue() {
  if (isProcessing) return
  isProcessing = true

  while (highPriorityQueue.length > 0 || lowPriorityQueue.length > 0) {
    const job = highPriorityQueue.shift() || lowPriorityQueue.shift()
    if (job) {
      await handleJob(job)
    }
  }

  isProcessing = false
}

async function handleJob(job: RagWorkerJob) {
  const { id, type, payload } = job
  try {
    let result: any

    switch (type) {
      case 'init':
        await db.connect()
        await initModel()
        result = { status: 'ready' }
        break

      case 'embed': {
        const { text } = payload
        if (!extractor) await initModel()
        const truncatedText = (text || '').slice(0, 2500)
        const output = await extractor(truncatedText, { pooling: 'mean', normalize: true })
        result = Array.from(output.data)
        break
      }

      case 'search': {
        let { queryVector, query, limit = 5 } = payload
        if (query && !queryVector) {
          if (!extractor) await initModel()
          const output = await extractor(query, { pooling: 'mean', normalize: true })
          queryVector = Array.from(output.data)
        }
        if (!queryVector) throw new Error('No search vector provided')
        const queryVec = new Float32Array(queryVector)

        // Fetch feedback for ranking adjustment
        const allFeedback = await db.getAllFeedback()
        const relevantFeedback = allFeedback.filter((f) => f.query === query)

        const candidates: { id: string; score: number; metadata: any }[] = []
        await db.iterate((record) => {
          let score = cosineSimilarity(queryVec, record.vector)

          // Apply feedback adjustments if query matches exactly
          // (In future we could use vector similarity for query feedback too)
          const noteFeedback = relevantFeedback.filter((f) => f.noteId === record.id)
          noteFeedback.forEach((f) => {
            if (f.score < 0) score *= 0.5 // Penalty
            if (f.score > 0) score *= 1.2 // Boost
          })

          if (score > 0.05) {
            candidates.push({ id: record.id, score, metadata: record.metadata })
          }
        })
        candidates.sort((a, b) => b.score - a.score)
        result = candidates.slice(0, limit)
        break
      }

      case 'add-feedback': {
        const { query, noteId, score } = payload
        await db.addFeedback({
          query,
          noteId,
          score,
          timestamp: Date.now()
        })
        result = { feedbackRecorded: true }
        break
      }

      case 'index': {
        const { id, vector, content, metadata } = payload
        let finalVector = vector
        let contentHash = payload.contentHash

        if (content && !finalVector) {
          if (!extractor) await initModel()
          const truncatedContent = content.slice(0, 2500)
          const output = await extractor(truncatedContent, { pooling: 'mean', normalize: true })
          finalVector = Array.from(output.data)
          if (!contentHash) {
            contentHash = await computeHash(content)
          }
        }

        if (!finalVector) throw new Error('No vector or content provided for indexing')
        await db.upsert({
          id,
          vector: new Float32Array(finalVector),
          contentHash,
          metadata: { ...metadata, path: metadata?.path || '' },
          updatedAt: payload.updatedAt || metadata?.updatedAt || Date.now()
        })
        result = { indexed: true, id, contentHash }
        break
      }

      case 'delete': {
        const { id } = payload
        await db.delete(id)
        result = { deleted: true, id }
        break
      }

      case 'update-metadata': {
        const { id, updatedAt, contentHash } = payload
        await db.updateMetadata(id, updatedAt, contentHash)
        result = { updated: true, id }
        break
      }

      case 'debug': {
        await db.connect()
        let lastError: string | undefined
        if (!extractor) {
          try {
            await initModel()
          } catch (e: any) {
            lastError = e.message || String(e)
          }
        }

        const count = await db.count()
        result = {
          count,
          modelLoaded: !!extractor,
          dbName: 'knowledge-hub-vectors',
          lastError
        }
        break
      }

      case 'get-all-metadata': {
        await db.connect()
        const meta = await db.getAllMetadata()
        result = Object.fromEntries(meta)
        break
      }

      case 'switch-vault': {
        const { dbName } = payload
        await db.disconnect()
        await db.connect(dbName)
        result = { status: 'switched', dbName }
        break
      }
      default:
        throw new Error(`Unknown job type: ${type}`)
    }

    ctx.postMessage({ id, success: true, payload: result })
  } catch (err: any) {
    ctx.postMessage({ id, success: false, error: err.message || 'Unknown worker error' })
  }
}
