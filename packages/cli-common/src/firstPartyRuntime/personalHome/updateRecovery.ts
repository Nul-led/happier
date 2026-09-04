import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { replacePersonalHomeFileDurably, syncPersonalHomeParentDirectory } from './durableFile.js';
import { resolvePersonalHomeRuntimeArtifactPaths, type PersonalHomeRuntimeLayout } from './layout.js';
import { parsePersonalHomeAuthenticatedReadiness, type PersonalHomeAuthenticatedReadiness } from './readiness.js';
import { createPersonalHomePathProtection } from './protection.js';

const RUNTIME_BACKUP_PREFIX = '.relay-runtime-backup-';
const RESTORE_POINT_PREFIX = 'pre-upgrade-';

export type PersonalHomeUpdateRecoveryRecordV1 = Readonly<{
  version: 1;
  phase: 'prepared' | 'activated' | 'committed';
  expectedStartupNonce?: string;
  activation?: Readonly<{
    nonce: string;
    pid: number;
    host: string;
    port: number;
    readiness: PersonalHomeAuthenticatedReadiness;
  }> | null;
  priorRunning: boolean;
  previousServiceDefinitionExisted: boolean;
  runtimeBackup: Readonly<{
    directoryName: string;
    hasPayload: boolean;
    hasRestorableServerBinary: boolean;
    hasMigrations: boolean;
    previousEnvText: string | null;
    previousStateText: string | null;
  }>;
  restorePoint: Readonly<{
    fileName: string;
    homeServerIdentityId: string;
    schemaVersion: string;
  }>;
}>;

export function resolvePersonalHomeUpdateRecoveryPath(layout: PersonalHomeRuntimeLayout): string {
  return resolvePersonalHomeRuntimeArtifactPaths(layout).updateRecoveryPath;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Personal Home update recovery ${field} is invalid`);
  return value;
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new Error(`Personal Home update recovery ${field} is invalid`);
}

function parseOwnedName(value: unknown, prefix: string, suffix: string, field: string): string {
  if (typeof value !== 'string' || basename(value) !== value || !value.startsWith(prefix) || value.length <= prefix.length + suffix.length || !value.endsWith(suffix)) {
    throw new Error(`Personal Home update recovery ${field} is invalid`);
  }
  return value;
}

export function parsePersonalHomeUpdateRecoveryRecord(value: unknown): PersonalHomeUpdateRecoveryRecordV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Personal Home update recovery record is invalid');
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['version', 'phase', 'expectedStartupNonce', 'activation', 'priorRunning', 'previousServiceDefinitionExisted', 'runtimeBackup', 'restorePoint']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('Personal Home update recovery record has unknown fields');
  if (raw.version !== 1 || !['prepared', 'activated', 'committed'].includes(String(raw.phase))) throw new Error('Personal Home update recovery version or phase is invalid');
  if (!raw.runtimeBackup || typeof raw.runtimeBackup !== 'object' || Array.isArray(raw.runtimeBackup)) throw new Error('Personal Home update recovery runtime backup is invalid');
  if (!raw.restorePoint || typeof raw.restorePoint !== 'object' || Array.isArray(raw.restorePoint)) throw new Error('Personal Home update recovery restore point is invalid');
  const runtime = raw.runtimeBackup as Record<string, unknown>;
  const restore = raw.restorePoint as Record<string, unknown>;
  const runtimeAllowed = new Set(['directoryName', 'hasPayload', 'hasRestorableServerBinary', 'hasMigrations', 'previousEnvText', 'previousStateText']);
  const restoreAllowed = new Set(['fileName', 'homeServerIdentityId', 'schemaVersion']);
  if (Object.keys(runtime).some((key) => !runtimeAllowed.has(key)) || Object.keys(restore).some((key) => !restoreAllowed.has(key))) {
    throw new Error('Personal Home update recovery nested record has unknown fields');
  }
  const homeServerIdentityId = typeof restore.homeServerIdentityId === 'string' ? restore.homeServerIdentityId.trim() : '';
  const schemaVersion = typeof restore.schemaVersion === 'string' ? restore.schemaVersion.trim() : '';
  if (!homeServerIdentityId || !schemaVersion) throw new Error('Personal Home update recovery identity or schema is invalid');
  const expectedStartupNonce = typeof raw.expectedStartupNonce === 'string' ? raw.expectedStartupNonce.trim() : '';
  let activation: PersonalHomeUpdateRecoveryRecordV1['activation'] = null;
  if (raw.activation !== undefined && raw.activation !== null) {
    if (typeof raw.activation !== 'object' || Array.isArray(raw.activation)) throw new Error('Personal Home update recovery activation evidence is invalid');
    const value = raw.activation as Record<string, unknown>;
    if (Object.keys(value).some((key) => !['nonce', 'pid', 'host', 'port', 'readiness'].includes(key))) throw new Error('Personal Home update recovery activation evidence has unknown fields');
    const readiness = parsePersonalHomeAuthenticatedReadiness(value.readiness);
    const nonce = typeof value.nonce === 'string' ? value.nonce.trim() : '';
    const host = typeof value.host === 'string' ? value.host.trim().toLowerCase() : '';
    const pid = value.pid;
    const port = value.port;
    if (!nonce || host !== '127.0.0.1' || !Number.isSafeInteger(pid) || Number(pid) < 1 || !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535 || !readiness) {
      throw new Error('Personal Home update recovery activation evidence is invalid');
    }
    activation = Object.freeze({ nonce, pid: Number(pid), host, port: Number(port), readiness });
  }
  if (expectedStartupNonce && expectedStartupNonce.length > 256) throw new Error('Personal Home update recovery startup nonce is invalid');
  if (activation && expectedStartupNonce && activation.nonce !== expectedStartupNonce) throw new Error('Personal Home update recovery activation nonce does not match');
  if (activation && activation.readiness.homeServerIdentityId !== homeServerIdentityId) throw new Error('Personal Home update recovery activation identity does not match');
  if (raw.phase === 'activated' && (!activation || !expectedStartupNonce)) throw new Error('Personal Home activated update is missing exact activation evidence');
  return Object.freeze({
    version: 1,
    phase: raw.phase as PersonalHomeUpdateRecoveryRecordV1['phase'],
    ...(expectedStartupNonce ? { expectedStartupNonce } : {}),
    ...(raw.activation === undefined ? {} : { activation }),
    priorRunning: parseBoolean(raw.priorRunning, 'prior-running fact'),
    previousServiceDefinitionExisted: parseBoolean(raw.previousServiceDefinitionExisted, 'service-definition fact'),
    runtimeBackup: Object.freeze({
      directoryName: parseOwnedName(runtime.directoryName, RUNTIME_BACKUP_PREFIX, '', 'runtime backup name'),
      hasPayload: parseBoolean(runtime.hasPayload, 'payload fact'),
      hasRestorableServerBinary: parseBoolean(runtime.hasRestorableServerBinary, 'server-binary fact'),
      hasMigrations: parseBoolean(runtime.hasMigrations, 'migration fact'),
      previousEnvText: parseNullableString(runtime.previousEnvText, 'environment snapshot'),
      previousStateText: parseNullableString(runtime.previousStateText, 'state snapshot'),
    }),
    restorePoint: Object.freeze({
      fileName: parseOwnedName(restore.fileName, RESTORE_POINT_PREFIX, '.tar', 'restore-point name'),
      homeServerIdentityId,
      schemaVersion,
    }),
  });
}

export function resolvePersonalHomeUpdateRecoveryReferences(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  record: PersonalHomeUpdateRecoveryRecordV1;
}>): Readonly<{
  runtimeBackupRoot: string;
  payloadBackupDir: string | null;
  migrationsBackupDir: string | null;
  restorePointPath: string;
}> {
  const runtimeBackupRoot = join(dirname(params.layout.installRoot), params.record.runtimeBackup.directoryName);
  return Object.freeze({
    runtimeBackupRoot,
    payloadBackupDir: params.record.runtimeBackup.hasPayload ? join(runtimeBackupRoot, 'payload') : null,
    migrationsBackupDir: params.record.runtimeBackup.hasMigrations ? join(runtimeBackupRoot, 'migrations') : null,
    restorePointPath: join(params.layout.backupsDir, 'restore-points', params.record.restorePoint.fileName),
  });
}

export async function readPersonalHomeUpdateRecoveryRecord(layout: PersonalHomeRuntimeLayout): Promise<PersonalHomeUpdateRecoveryRecordV1 | null> {
  const path = resolvePersonalHomeUpdateRecoveryPath(layout);
  try {
    return parsePersonalHomeUpdateRecoveryRecord(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writePersonalHomeUpdateRecoveryRecord(
  layout: PersonalHomeRuntimeLayout,
  record: PersonalHomeUpdateRecoveryRecordV1,
): Promise<void> {
  const path = resolvePersonalHomeUpdateRecoveryPath(layout);
  const directory = dirname(path);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const protect = createPersonalHomePathProtection({ platform: layout.platform });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await protect(directory, 'directory');
  try {
    await writeFile(temporary, `${JSON.stringify(parsePersonalHomeUpdateRecoveryRecord(record))}\n`, { mode: 0o600 });
    await protect(temporary, 'file');
    await replacePersonalHomeFileDurably(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removePersonalHomeUpdateRecoveryRecord(layout: PersonalHomeRuntimeLayout): Promise<void> {
  const path = resolvePersonalHomeUpdateRecoveryPath(layout);
  await rm(path, { force: true });
  await syncPersonalHomeParentDirectory(path);
}
