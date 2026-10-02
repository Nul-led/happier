import { dirname, isAbsolute } from 'node:path';
import { openSqliteDatabaseSync, type SqliteDatabaseSync } from '@happier-dev/plugin-sdk/fs';

import {
  ensureProtectedLocalStateDirectorySync,
  ensureProtectedLocalStateFileSync,
} from '@/utils/fs/protectedLocalState';

export { openSqliteDatabaseSync } from '@happier-dev/plugin-sdk/fs';
export type { SqliteDatabaseSync, SqliteStatementSync } from '@happier-dev/plugin-sdk/fs';

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
