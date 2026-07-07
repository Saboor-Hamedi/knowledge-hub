import { createPool, closePool, getPool, isConnected, query, queryOne } from './database'
import { runMigrationsSafe } from './migrations'
import * as queries from './queries'

export type DatabaseConfig = {
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

export { createPool, closePool, getPool, isConnected, query, queryOne, runMigrationsSafe, queries }
