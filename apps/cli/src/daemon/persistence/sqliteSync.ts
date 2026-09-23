import { createRequire } from 'node:module';
import { dirname, isAbsolute } from 'node:path';

import {
  ensureProtectedLocalStateDirectorySync,
  ensureProtectedLocalStateFileSync,
} from '@/utils/fs/protectedLocalState';

export type SqliteStatementSync = Readonly<{
  get: (...params: readonly unknown[]) => unknown;
  all: (...params: readonly unknown[]) => unknown[];
  iterate: (...params: readonly unknown[]) => Iterable<unknown>;
  run: (...params: readonly unknown[]) => unknown;
}>;

export type SqliteDatabaseSync = Readonly<{
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementSync;
  close: () => void;
}>;

// The lower host-parameter ceiling exposed by the daemon's supported SQLite
// providers: the shipped node:sqlite build reports 32,766 while Bun reports a
// higher ceiling. Query construction stays valid on either runtime.
const SQLITE_SUPPORTED_MAX_BOUND_PARAMETERS = 32_766;

export function resolveSqliteSupportedValueBatchSize(params: Readonly<{
  fixedParameterCount: number;
  parametersPerValue: number;
}>): number {
  const fixedParameterCount = Math.max(0, Math.trunc(params.fixedParameterCount));
  const parametersPerValue = Math.max(1, Math.trunc(params.parametersPerValue));
  const batchSize = Math.floor(
    (SQLITE_SUPPORTED_MAX_BOUND_PARAMETERS - fixedParameterCount) / parametersPerValue,
  );
  if (batchSize < 1) {
    throw new Error('SQLite query shape exceeds the supported bound-parameter boundary');
  }
  return batchSize;
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

export function openSqliteDatabaseSync(filePath: string): SqliteDatabaseSync {
  const require = createRequire(import.meta.url);
  // Keep the runtime-selected specifier opaque to pkgroll. A literal
  // `node:sqlite` branch is otherwise emitted as an eager external import and
  // prevents the Bun-compiled CLI from starting before this function runs.
  const moduleName = [isBunRuntime() ? 'bun' : 'node', 'sqlite'].join(':');

  const mod = require(moduleName) as unknown;
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Failed to load sqlite module: ${moduleName}`);
  }

  const ctor = (isBunRuntime()
    ? (mod as { Database?: unknown }).Database
    : (mod as { DatabaseSync?: unknown }).DatabaseSync) as unknown;

  if (typeof ctor !== 'function') {
    throw new Error(`Failed to resolve sqlite Database constructor from ${moduleName}`);
  }

  return new (ctor as new (path: string) => SqliteDatabaseSync)(filePath);
}

export function protectSqliteDatabaseFilesSync(filePath: string): void {
  if (!isAbsolute(filePath)) {
    throw new Error('Protected SQLite state requires an absolute file path');
  }
  const options = { authority: 'owned' as const };
  ensureProtectedLocalStateDirectorySync(dirname(filePath), options);
  ensureProtectedLocalStateFileSync(filePath, options);
  ensureProtectedLocalStateFileSync(`${filePath}-wal`, options);
  ensureProtectedLocalStateFileSync(`${filePath}-shm`, options);
}

/**
 * Opens an owner-managed plaintext SQLite database under the protected local
 * state contract. Callers that enable WAL then call
 * `protectSqliteDatabaseFilesSync` after connection setup and before writing
 * sensitive rows; later sidecar recreation inherits from the protected root.
 */
export function openProtectedSqliteDatabaseSync(filePath: string): SqliteDatabaseSync {
  protectSqliteDatabaseFilesSync(filePath);
  const db = openSqliteDatabaseSync(filePath);
  protectSqliteDatabaseFilesSync(filePath);
  return db;
}
