import { query } from './database'

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_create_extension_vector',
    sql: `CREATE EXTENSION IF NOT EXISTS vector`
  },
  {
    name: '002_create_documents_table',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vault_path    TEXT NOT NULL,
        file_name     TEXT NOT NULL,
        file_type     TEXT NOT NULL,
        file_size     BIGINT,
        metadata      JSONB DEFAULT '{}',
        content_hash  TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(vault_path)
      )
    `
  },
  {
    name: '003_rename_or_create_chunks_table',
    sql: `
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'document_chunks') AND NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'embedding_documents') THEN
          ALTER TABLE document_chunks RENAME TO embedding_documents;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS embedding_documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index   INT NOT NULL,
        content       TEXT NOT NULL,
        embedding     VECTOR(384),
        token_count   INT,
        UNIQUE(document_id, chunk_index)
      );
      
      -- If document_chunks was accidentally recreated by a previous buggy migration run, drop it.
      DROP TABLE IF EXISTS document_chunks CASCADE;
    `
  },
  {
    name: '004_create_feedback_table',
    sql: `
      CREATE TABLE IF NOT EXISTS search_feedback (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        query_text    TEXT NOT NULL,
        chunk_id      UUID REFERENCES embedding_documents(id) ON DELETE SET NULL,
        document_id   UUID REFERENCES documents(id) ON DELETE SET NULL,
        score         INT NOT NULL CHECK (score IN (-1, 1)),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `
  },
  {
    name: '005_create_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_documents_type    ON documents(file_type);
      CREATE INDEX IF NOT EXISTS idx_documents_hash    ON documents(content_hash);
      CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chunks_document   ON embedding_documents(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_index      ON embedding_documents(document_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding
        ON embedding_documents
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    `
  },
  {
    name: '006_schema_refactor',
    sql: `
      ALTER TABLE documents DROP COLUMN IF EXISTS content;
    `
  }
]

export async function runMigrations(): Promise<void> {
  console.log('[DB] Running migrations...')

  for (const migration of MIGRATIONS) {
    try {
      await query(migration.sql)
      console.log(`[DB]  ✓ ${migration.name}`)
    } catch (err) {
      console.error(`[DB]  ✗ ${migration.name}: ${(err as Error).message}`)
      throw err
    }
  }

  console.log('[DB] All migrations complete.')
}

export async function runMigrationsSafe(): Promise<void> {
  try {
    await runMigrations()
  } catch (err) {
    console.error('[DB] Migration failed — continuing without DB:', (err as Error).message)
  }
}
