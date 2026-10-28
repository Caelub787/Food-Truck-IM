import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { adminUrl, TEST_DB } from './config'

// Builds a fresh test database: the Supabase shim first, then every migration in order.
export default async function setup() {
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`drop database if exists ${TEST_DB} with (force)`)
  await admin.query(`create database ${TEST_DB}`)
  await admin.end()

  const client = new pg.Client({ connectionString: adminUrl.replace(/\/[^/]*$/, `/${TEST_DB}`) })
  await client.connect()
  try {
    await client.query(readFileSync(new URL('./supabase-shim.sql', import.meta.url), 'utf8'))
    const dir = new URL('../../supabase/migrations/', import.meta.url).pathname
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'))
      } catch (error) {
        // Printed here too, because Vitest sometimes hides errors thrown during setup.
        console.error(`Migration ${file} failed: ${(error as Error).message}`)
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error })
      }
    }
  } finally {
    await client.end()
  }
}
