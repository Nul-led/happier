import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import {
  expandHomePath,
  resolveHomeDirFromEnvironment,
} from '@happier-dev/plugin-sdk/fs';

import {
  findCodexRolloutFileById,
} from '../../../../rollout/discovery/sessionFileSearch.js';
import { resolveConfiguredCodexHomePath } from '../../../../rollout/discovery/homeEntries.js';
import { readExactCodexVendorResumeId } from '../../home/sync/sessionFiles.js';
import { resolveCodexRuntimeHomeEnvironment } from './files.js';

const CODEX_STATE_DATABASE_FILE_NAME = 'state_5.sqlite';

type SqliteStatement = Readonly<{
  get(...params: readonly unknown[]): unknown;
  run(...params: readonly unknown[]): unknown;
}>;

type SqliteDatabase = Readonly<{
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}>;

function openSqliteDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
  const moduleName = isBunRuntime ? 'bun:sqlite' : 'node:sqlite';
  const loaded = require(moduleName) as unknown;
  if (!loaded || typeof loaded !== 'object') {
    throw new Error(`Failed to load SQLite module: ${moduleName}`);
  }
  const constructor = isBunRuntime
    ? (loaded as Readonly<{ Database?: unknown }>).Database
    : (loaded as Readonly<{ DatabaseSync?: unknown }>).DatabaseSync;
  if (typeof constructor !== 'function') {
    throw new Error(`Failed to resolve SQLite database constructor: ${moduleName}`);
  }
  return new (constructor as new (databasePath: string) => SqliteDatabase)(path);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function readRolloutPath(database: SqliteDatabase, vendorResumeId: string): string | null {
  const row = database
    .prepare('SELECT rollout_path FROM threads WHERE id = ?')
    .get(vendorResumeId);
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const rolloutPath = (row as Readonly<{ rollout_path?: unknown }>).rollout_path;
  return typeof rolloutPath === 'string' && rolloutPath.trim().length > 0
    ? rolloutPath.trim()
    : null;
}

/**
 * Repairs the one Codex-native index field needed by `thread/resume` after the
 * exact rollout has survived a Connected Account materialization replacement.
 *
 * The Codex plugin owns both the provider schema and this provider-operation
 * boundary. This is intentionally not a reindexer: it never creates a database,
 * table, or thread row, and it updates only a missing path through an exact
 * compare-and-set so a concurrent Codex write wins.
 */
export async function reconcileCodexResumeRolloutPath(params: Readonly<{
  processEnv: Readonly<Record<string, string | undefined>>;
  cwd: string;
  vendorResumeId: string;
}>): Promise<boolean> {
  const vendorResumeId = readExactCodexVendorResumeId(params.vendorResumeId);
  if (!vendorResumeId) return false;

  const rawCodexHome = params.processEnv.CODEX_HOME?.trim() ?? '';
  const rawSqliteHome = params.processEnv.CODEX_SQLITE_HOME?.trim() ?? '';
  if (!rawCodexHome || !rawSqliteHome) return true;

  const codexHome = resolve(resolveConfiguredCodexHomePath(params.processEnv));
  const homeDir = resolveHomeDirFromEnvironment(params.processEnv);
  const runtimeHome = resolveCodexRuntimeHomeEnvironment({
    env: params.processEnv,
    codexHome,
    cwd: params.cwd,
    expandHomePath: (rawPath) => expandHomePath(rawPath, homeDir),
  });
  const sqliteHome = resolve(runtimeHome.CODEX_SQLITE_HOME);
  if (codexHome === sqliteHome) return true;

  const resolvedRolloutPath = await findCodexRolloutFileById({
    sessionsRoot: join(codexHome, 'sessions'),
    vendorResumeId,
  });
  if (!resolvedRolloutPath) return false;

  const databasePath = join(sqliteHome, CODEX_STATE_DATABASE_FILE_NAME);
  if (!await isFile(databasePath)) return true;

  let database: SqliteDatabase | null = null;
  try {
    database = openSqliteDatabase(databasePath);
    database.exec('PRAGMA busy_timeout = 5000');
    const table = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .get();
    if (!table) return true;

    const indexedPath = readRolloutPath(database, vendorResumeId);
    if (!indexedPath || indexedPath === resolvedRolloutPath) return true;
    if (await isFile(indexedPath)) return true;

    database
      .prepare('UPDATE threads SET rollout_path = ? WHERE id = ? AND rollout_path = ?')
      .run(resolvedRolloutPath, vendorResumeId, indexedPath);

    const settledPath = readRolloutPath(database, vendorResumeId);
    if (settledPath === resolvedRolloutPath) return true;
    return settledPath !== null && await isFile(settledPath);
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
