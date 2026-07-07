export interface VectorRecord {
  id: string
  vector: Float32Array // efficient storage
  contentHash?: string // for change detection
  metadata: {
    title: string
    path: string
    [key: string]: any
  }
  updatedAt: number
}

export interface FeedbackRecord {
  query: string
  noteId: string
  score: number // +1 for positive, -1 for negative
  timestamp: number
}

export class VectorDB {
  private dbName = 'knowledgehub-rag'
  private version = 2 // Updated version for feedback store
  private storeName = 'vectors'
  private feedbackStore = 'feedback'
  private db: IDBDatabase | null = null

  async connect(name?: string): Promise<void> {
    if (name) this.dbName = name
    if (this.db) return

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = (): void => {
        console.error('[VectorDB] Database error:', request.error)
        reject(request.error)
      }

      request.onupgradeneeded = (event): void => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(this.feedbackStore)) {
          const store = db.createObjectStore(this.feedbackStore, {
            keyPath: 'id',
            autoIncrement: true
          })
          store.createIndex('query', 'query', { unique: false })
          store.createIndex('noteId', 'noteId', { unique: false })
        }
      }

      request.onsuccess = (event): void => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve()
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  async upsert(record: VectorRecord): Promise<void> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put(record)

      request.onsuccess = (): void => resolve()
      request.onerror = (): void => {
        console.error('[VectorDB] Upsert error:', request.error)
        reject(request.error)
      }
    })
  }

  async delete(id: string): Promise<void> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.delete(id)

      request.onsuccess = (): void => resolve()
      request.onerror = (): void => reject(request.error)
    })
  }

  async get(id: string): Promise<VectorRecord | undefined> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.get(id)

      request.onsuccess = (): void => resolve(request.result)
      request.onerror = (): void => reject(request.error)
    })
  }

  async updateMetadata(id: string, updatedAt: number, contentHash?: string): Promise<void> {
    const record = await this.get(id)
    if (record) {
      record.updatedAt = updatedAt
      if (contentHash) record.contentHash = contentHash
      await this.upsert(record)
    }
  }

  async count(): Promise<number> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.count()

      request.onsuccess = (): void => resolve(request.result)
      request.onerror = (): void => reject(request.error)
    })
  }

  /**
   * Opens a cursor to iterate over all vectors.
   * This is memory efficient for searching large datasets.
   */
  async iterate(callback: (record: VectorRecord) => void): Promise<void> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.openCursor()

      request.onsuccess = (event): void => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          callback(cursor.value)
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = (): void => reject(request.error)
    })
  }

  /**
   * Returns all record IDs and their metadata for change detection.
   */
  async getAllMetadata(): Promise<Map<string, { updatedAt: number; contentHash?: string }>> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.openCursor()
      const metadata = new Map<string, { updatedAt: number; contentHash?: string }>()

      request.onsuccess = (event): void => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          metadata.set(cursor.value.id, {
            updatedAt: cursor.value.updatedAt,
            contentHash: cursor.value.contentHash
          })
          cursor.continue()
        } else {
          resolve(metadata)
        }
      }

      request.onerror = (): void => reject(request.error)
    })
  }

  async addFeedback(record: FeedbackRecord): Promise<void> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.feedbackStore], 'readwrite')
      const store = transaction.objectStore(this.feedbackStore)
      const request = store.add(record)

      request.onsuccess = (): void => resolve()
      request.onerror = (): void => reject(request.error)
    })
  }

  async getAllFeedback(): Promise<FeedbackRecord[]> {
    await this.ensureConnection()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.feedbackStore], 'readonly')
      const store = transaction.objectStore(this.feedbackStore)
      const request = store.getAll()

      request.onsuccess = (): void => resolve(request.result)
      request.onerror = (): void => reject(request.error)
    })
  }

  private async ensureConnection(): Promise<void> {
    if (!this.db) {
      await this.connect()
    }
  }
}
