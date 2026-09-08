import { open } from '@op-engineering/op-sqlite';
import type { DB, QueryResult } from '@op-engineering/op-sqlite';

export const DB_NAME = 'wall_e.db';
export const DB_VERSION = 2;

let dbInstance: DB | null = null;

export function migrateSchema(db: DB): void {
  db.executeSync(`
    CREATE TABLE IF NOT EXISTS wallpapers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      accent TEXT NOT NULL DEFAULT '#7C3AED',
      status TEXT NOT NULL DEFAULT 'Ready',
      duration TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      video_uri TEXT,
      image_uri TEXT,
      loop INTEGER NOT NULL DEFAULT 1,
      audio INTEGER NOT NULL DEFAULT 0,
      playback_duration INTEGER,
      rotation INTEGER NOT NULL DEFAULT 0
    );
  `);
  try {
    // v1→v2: user-imported videos keep their extracted poster frame URI so the
    // thumbnail survives restarts. ALTER is a no-op guard for fresh installs
    // where the column is already part of the CREATE above.
    db.executeSync('ALTER TABLE wallpapers ADD COLUMN poster_uri TEXT;');
  } catch {
    // Column already exists — ignore.
  }
  db.executeSync('CREATE INDEX IF NOT EXISTS idx_wallpapers_kind ON wallpapers(kind);');
  db.executeSync('CREATE INDEX IF NOT EXISTS idx_wallpapers_created ON wallpapers(created_at);');

  db.executeSync(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.executeSync(`
    CREATE TABLE IF NOT EXISTS video_files (
      digest TEXT PRIMARY KEY,
      uri TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      poster_uri TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.executeSync('CREATE INDEX IF NOT EXISTS idx_video_files_uri ON video_files(uri);');
}

export function getDB(): DB {
  if (!dbInstance) {
    dbInstance = open({ name: DB_NAME });
    migrateSchema(dbInstance);
    setMeta('schema_version', String(DB_VERSION)).catch(() => undefined);
  }
  return dbInstance;
}

export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

async function setMeta(key: string, value: string): Promise<void> {
  const db = getDB();
  await db.execute(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    [key, value],
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const db = getDB();
  const result = await db.execute('SELECT value FROM meta WHERE key = ?', [key]);
  if (result.rows.length === 0) return null;
  return String(result.rows[0].value);
}

/**
 * Synchronous meta helpers used for theme mode so the UI renders with the
 * correct palette before the first async frame. op-sqlite reads/writes are
 * synchronous, so these are safe to call during React render/effects.
 */
export function getMetaSync(key: string): string | null {
  const db = getDB();
  const result = db.executeSync('SELECT value FROM meta WHERE key = ?', [key]);
  if (result.rows.length === 0) return null;
  return String(result.rows[0].value);
}

export function setMetaSync(key: string, value: string): void {
  const db = getDB();
  db.executeSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Executes a write within a transaction via executeBatch-style helper. Most
 * caller writes are single-row upserts/deletes, so a single execute is used
 * directly with op-sqlite's async API.
 */
export function asRow(result: QueryResult): Record<string, unknown> | undefined {
  return result.rows[0] as Record<string, unknown> | undefined;
}

export function rowsAs(result: QueryResult): Array<Record<string, unknown>> {
  return result.rows as Array<Record<string, unknown>>;
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function toStr(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}
