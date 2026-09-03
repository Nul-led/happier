import { createRequire } from 'node:module';

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
  const moduleName = isBunRuntime() ? 'bun:sqlite' : 'node:sqlite';

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
