import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { replacePersonalHomeFileDurably, syncPersonalHomeParentDirectory } from './durableFile.js';
import { resolvePersonalHomeRuntimeArtifactPaths, type PersonalHomeRuntimeLayout } from './layout.js';
import { parsePersonalHomeAuthenticatedReadiness, type PersonalHomeAuthenticatedReadiness } from './readiness.js';
import { createPersonalHomePathProtection } from './protection.js';
import { parsePersonalHomeRuntimePurpose } from './personalHomeRuntimeSpec.js';

const RUNTIME_BACKUP_PREFIX = '.relay-runtime-backup-';
const RESTORE_POINT_PREFIX = 'pre-upgrade-';

export type PersonalHomeUpdateCandidateState = Readonly<{
  channel: 'stable' | 'preview' | 'publicdev';
  mode: 'user' | 'system';
  version: string | null;
  updatedAt: string;
  purpose: Readonly<{ kind: 'personal-home'; canonicalServerUrl: string }>;
  uiDeploymentDigest?: string;
  uiDeploymentId?: string;
}>;

export type PersonalHomeUpdateRecoveryRecordV1 = Readonly<{
  version: 1;
  phase: 'prepared' | 'activated' | 'committed';
  expectedStartupNonce?: string;
  /** Exact candidate selected durably before any incumbent payload, migration, or configuration mutation. */
  candidate?: Readonly<{
    envText: string;
    state: PersonalHomeUpdateCandidateState;
    /** Present for records created after exact payload staging moved ahead of the durable boundary. */
    payload?: Readonly<{ directoryName: 'candidate'; sha256: string }>;
  }>;
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
  const allowed = new Set(['version', 'phase', 'expectedStartupNonce', 'candidate', 'activation', 'priorRunning', 'previousServiceDefinitionExisted', 'runtimeBackup', 'restorePoint']);
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
  let candidate: PersonalHomeUpdateRecoveryRecordV1['candidate'];
  if (raw.candidate !== undefined) {
    if (!raw.candidate || typeof raw.candidate !== 'object' || Array.isArray(raw.candidate)) throw new Error('Personal Home update candidate is invalid');
    const value = raw.candidate as Record<string, unknown>;
    if (Object.keys(value).some((key) => !['envText', 'state', 'payload'].includes(key)) || typeof value.envText !== 'string'
      || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) throw new Error('Personal Home update candidate is invalid');
    const state = value.state as Record<string, unknown>;
    if (Object.keys(state).some((key) => !['channel', 'mode', 'version', 'updatedAt', 'purpose', 'uiDeploymentDigest', 'uiDeploymentId'].includes(key))
      || !['stable', 'preview', 'publicdev'].includes(String(state.channel)) || !['user', 'system'].includes(String(state.mode))
      || !(state.version === null || typeof state.version === 'string') || typeof state.updatedAt !== 'string'
      || (state.uiDeploymentDigest !== undefined && typeof state.uiDeploymentDigest !== 'string')
      || (state.uiDeploymentId !== undefined && typeof state.uiDeploymentId !== 'string')) throw new Error('Personal Home update candidate state is invalid');
    const purpose = parsePersonalHomeRuntimePurpose(state.purpose);
    let payload: NonNullable<PersonalHomeUpdateRecoveryRecordV1['candidate']>['payload'];
    if (value.payload !== undefined) {
      if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new Error('Personal Home update candidate payload is invalid');
      const rawPayload = value.payload as Record<string, unknown>;
      if (Object.keys(rawPayload).some((key) => !['directoryName', 'sha256'].includes(key))
        || rawPayload.directoryName !== 'candidate'
        || typeof rawPayload.sha256 !== 'string'
        || !/^sha256:[a-f0-9]{64}$/u.test(rawPayload.sha256)) throw new Error('Personal Home update candidate payload is invalid');
      payload = Object.freeze({ directoryName: 'candidate' as const, sha256: rawPayload.sha256 });
    }
    candidate = Object.freeze({ envText: value.envText, state: Object.freeze({
      channel: state.channel as PersonalHomeUpdateCandidateState['channel'],
      mode: state.mode as PersonalHomeUpdateCandidateState['mode'],
      version: state.version,
      updatedAt: state.updatedAt,
      purpose: { kind: 'personal-home' as const, canonicalServerUrl: purpose.canonicalServerUrl },
      ...(typeof state.uiDeploymentDigest === 'string' ? { uiDeploymentDigest: state.uiDeploymentDigest } : {}),
      ...(typeof state.uiDeploymentId === 'string' ? { uiDeploymentId: state.uiDeploymentId } : {}),
    }), ...(payload ? { payload } : {}) });
    if (!expectedStartupNonce) throw new Error('Personal Home update candidate is missing its startup nonce');
  }
  return Object.freeze({
    version: 1,
    phase: raw.phase as PersonalHomeUpdateRecoveryRecordV1['phase'],
    ...(expectedStartupNonce ? { expectedStartupNonce } : {}),
    ...(candidate ? { candidate } : {}),
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
  candidatePayloadDir: string | null;
  restorePointPath: string;
}> {
  const runtimeBackupRoot = join(dirname(params.layout.installRoot), params.record.runtimeBackup.directoryName);
  return Object.freeze({
    runtimeBackupRoot,
    payloadBackupDir: params.record.runtimeBackup.hasPayload ? join(runtimeBackupRoot, 'payload') : null,
    migrationsBackupDir: params.record.runtimeBackup.hasMigrations ? join(runtimeBackupRoot, 'migrations') : null,
    candidatePayloadDir: params.record.candidate?.payload ? join(runtimeBackupRoot, params.record.candidate.payload.directoryName) : null,
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
