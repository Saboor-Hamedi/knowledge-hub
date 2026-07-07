import { Pool, type PoolConfig, type QueryResultRow } from 'pg'
import type { DatabaseConfig } from './index'

let pool: Pool | null = null

export function createPool(config: DatabaseConfig): Pool {
  const cfg: PoolConfig = {
    host: config.host || 'localhost',
    port: config.port || 5432,
    database: config.database || 'knowledgehub',
    user: config.user || 'postgres',
    password: config.password || 'jan',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  }

  pool = new Pool(cfg)

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message)
  })

  return pool
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('[DB] PostgreSQL pool not initialized. Call createPool() first.')
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[DB] Pool closed.')
  }
}

export function isConnected(): boolean {
  return pool !== null
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = getPool()
  const result = await client.query<T>(sql, params)
  return result.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows.length > 0 ? rows[0] : null
}
