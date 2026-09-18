import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, readFile, readdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';

import {
  createWindowsProtectedAclBoundary,
  type WindowsProtectedAclBoundary,
} from '@happier-dev/cli-common/fs/windowsProtectedAcl';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';

// Retired engine schema marker is intentionally local: the replacement must not import
// the deleted replication implementation.
const WORKSPACE_REPLICATION_SCHEMA_VERSION = 1;

const LEGACY_DIRECTORY_NAME = 'workspace-replication';
const RETIRED_DIRECTORY_PREFIX = 'workspace-replication.retired-v1-';
// Exact plan-owned quarantine shape: <prefix><detectedAtMs>-<randomSuffix>.
const RETIRED_QUARANTINE_NAME_PATTERN = /^workspace-replication\.retired-v1-(\d{10,16})-([A-Za-z0-9_-]{1,64})$/u;
const INVENTORY_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const RETIREMENT_MARKER_NAME = 'retirement.json';
// Exact immediate children the released engine (cli-v0.2.11) creates below
// the state root: the paths owner creates cas/jobs/relationships/staging, the
// source-offer store creates `offers`, and the scope-lease owner creates
// `scope-leases`. The root carries nothing else: every released writer keeps
// temporary artifacts inside its own store directory, so a root-level file is
// impossible and must fail closed. Every entry must be a real, non-symlink
// directory.
const LEGACY_CHILD_DIRECTORIES = new Set([
  'cas',
  'jobs',
  'relationships',
  'staging',
  'offers',
  'scope-leases',
]);
// Released record locations and their minimal stable discriminators, derived
// from the cli-v0.2.11 owners themselves: relationship records at
// `relationships/rel_*/relationship.json` (strict record, schemaVersion 1),
// job records at `jobs/<jobId>.json` (disk records always carry schemaVersion
// 1 plus a jobId), scope-lease records at
// `scope-leases/<rel>__<dir>/lease/lease.json` (ownerId plus lease timestamps,
// never schema-tagged), and streaming source offers at `offers/offer_*.txt`
// whose first line is the released stream magic. Traversal is limited to the
// explicitly enumerated released locations; anything else proves nothing.
const RETIRED_RELATIONSHIP_DIRECTORY_PATTERN = /^rel_[A-Za-z0-9_-]+$/u;
const RETIRED_DIRECTION_DIRECTORY_PATTERN = /^dir_[A-Za-z0-9_-]+$/u;
const RETIRED_SCOPE_LEASE_DIRECTORY_PATTERN = /^rel_[A-Za-z0-9_-]+__dir_[A-Za-z0-9_-]+$/u;
const RETIRED_JOB_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const RETIRED_JOB_RECORD_FILE_PATTERN = /^[A-Za-z0-9._-]+\.json$/u;
const RETIRED_OFFER_FILE_PATTERN = /^offer_[A-Za-z0-9_-]+\.txt$/u;
const RETIRED_SOURCE_OFFER_MAGIC = 'HAPPIER_WORKSPACE_REPLICATION_SOURCE_OFFER_V1';
const RETIRED_CAS_SHARD_DIRECTORY_NAME = 'sha256';
const RETIRED_CAS_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const RETIRED_CAS_PREFIX_PATTERN = /^[a-f0-9]{2}$/u;
const RETIRED_BASELINE_DIRECTORY_NAME = 'directionalBaselines';
const RETIRED_BASELINE_RECORD_NAME = 'baseline.json';
const RETIRED_RELATIONSHIP_RECORD_NAME = 'relationship.json';
const RETIRED_LEASE_DIRECTORY_NAME = 'lease';
const RETIRED_LEASE_RECORD_NAME = 'lease.json';
// Enumerated leftovers the released writers themselves emit INSIDE store
// directories (never at the state root): `writeJsonAtomic` temps
// (`.tmp-<pid>-<ms>-<random>.json`), lease-record temps
// (`lease.<uuid>.tmp`), lease-acquisition temp dirs
// (`lease.tmp-<uuid>`) and CAS partial blob writes (`<uuid>.part`).
const RETIRED_ATOMIC_TEMPORARY_FILE_PATTERN = /^\.tmp-\d+-\d+-[0-9a-f]+\.json$/u;
const RETIRED_LEASE_TEMPORARY_FILE_PATTERN = /^lease\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u;
const RETIRED_LEASE_TEMPORARY_DIRECTORY_PATTERN = /^lease\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const RETIRED_CAS_PARTIAL_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/u;
const RETIRED_STAGING_BLOB_PACKS_DIRECTORY_NAME = 'blob-packs';
const RETIRED_STAGING_PACK_PARTIAL_FILE_PATTERN = /^[a-f0-9]{64}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/u;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_SCAN_ENTRIES = 2_000;
const MAX_INSTALLATION_ID_LENGTH = 256;

export type WorkspaceSyncLegacyStateInspection = Readonly<
  | { status: 'absent'; path: string }
  | { status: 'legacy_workspace_sync_state_unknown'; path: string; reason: string }
  | {
      status: 'legacy_workspace_sync_state_unsupported';
      classification: 'retired_v1';
      path: string;
      quarantinePath: string;
      schemaVersion: 1;
      inventoryHash: string;
    }
>;

export type InspectRetiredWorkspaceReplicationStateInput = Readonly<{
  activeServerDir: string;
  installationId?: string;
  nowMs?: number;
  randomSuffix?: string;
  platform?: NodeJS.Platform;
  windowsAclBoundary?: WindowsProtectedAclBoundary;
  setPosixPrivatePermissions?: (path: string) => Promise<void>;
  readLinuxMountInfo?: () => Promise<string>;
}>;

type InventoryEntry = Readonly<{ name: string; size: number }>;

/**
 * Shared bound for the one full traversal of the retired state root. Every
 * enumerated entry and every inspected directory claims from the same budget;
 * exhaustion before completion fails the whole classification closed.
 */
type TraversalBound = { remaining: number };

function unknown(path: string, reason: string): WorkspaceSyncLegacyStateInspection {
  return { status: 'legacy_workspace_sync_state_unknown', path, reason };
}

async function readInventory(
  rootPath: string,
  bound: TraversalBound,
  options: Readonly<{ ignoreRetirementMarker?: boolean }> = {},
): Promise<Readonly<{ entries: readonly InventoryEntry[]; hash: string }> | null> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  const inventory: InventoryEntry[] = [];
  for (const entry of entries) {
    if (entry.name === RETIREMENT_MARKER_NAME) {
      if (options.ignoreRetirementMarker) continue;
      return null;
    }
    if (!LEGACY_CHILD_DIRECTORIES.has(entry.name)) return null;
    const entryPath = join(rootPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat) return null;
    if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) return null;
    inventory.push({ name: entry.name, size: entryStat.size });
  }
  inventory.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const hash = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
  return { entries: inventory, hash };
}

function isRealNonSymlinkDirectory(stat: Awaited<ReturnType<typeof lstat>>): boolean {
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function isRealNonSymlinkFile(stat: Awaited<ReturnType<typeof lstat>>): boolean {
  return stat.isFile() && !stat.isSymbolicLink();
}

async function readJsonRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
): Promise<Record<string, unknown> | null> {
  if (fileStat.size > MAX_RECORD_BYTES) return null;
  const parsed = await readFile(filePath, 'utf8')
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isReleasedNormalizedWorkspaceRoot(value: string): boolean {
  const normalized = posix.normalize(value.replace(/\\/gu, '/').trim()).replace(/^\.\//u, '');
  const canonical = normalized === '.' ? '' : normalized;
  return value === (canonical === '/' || canonical === '' ? canonical : canonical.replace(/\/+$/u, ''));
}

function isReleasedNormalizedIgnorePatterns(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) return false;
  const normalized = [...new Set(value.map((pattern) => pattern.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return JSON.stringify(value) === JSON.stringify(normalized);
}

const RETIRED_JOB_KEYS = new Set([
  'schemaVersion', 'lastAttempt', 'jobId', 'correlationId', 'relationshipId',
  'directionId', 'offerId', 'mode', 'createdAtMs', 'updatedAtMs',
  'resumeContext', 'cancelRequestedAtMs', 'abortedAtMs', 'completedAtMs',
  'awaitingRecoveryAtMs', 'failedAtMs', 'lastErrorMessage', 'result', 'status',
]);
const RETIRED_JOB_STATUS_KEYS = new Set([
  'status', 'phase', 'checkpoint', 'progressCounters', 'warnings',
  'blockingDivergenceCandidates',
]);
const RETIRED_JOB_PROGRESS_KEYS = new Set([
  'plannedFiles', 'plannedBytes', 'transferredFiles', 'transferredBytes',
  'appliedFiles', 'appliedBytes',
]);
const RETIRED_JOB_STATUSES = new Set([
  'pending', 'in_progress', 'completed', 'aborted', 'failed', 'awaiting_recovery',
]);
const RETIRED_JOB_PHASES = new Set([
  'planning', 'negotiate_missing_digests', 'transfer_missing_blobs_to_target_cas',
  'apply', 'commit_baseline',
]);
const RETIRED_JOB_CHECKPOINTS = new Set([
  'job_created', 'relationship_resolved', 'missing_digests_negotiated',
  'blob_transfer_started', 'blob_transfer_completed', 'apply_started',
  'apply_completed', 'baseline_committed',
]);
const RETIRED_RELATIONSHIP_KEYS = new Set([
  'schemaVersion', 'relationshipId', 'endpoints', 'config', 'createdAtMs', 'updatedAtMs',
]);
const RETIRED_RELATIONSHIP_ID_PATTERN = /^rel_[A-Za-z0-9_-]+$/u;

function isReleasedJobStatus(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, RETIRED_JOB_STATUS_KEYS)) return false;
  if (!RETIRED_JOB_STATUSES.has(String(value.status))
    || !RETIRED_JOB_PHASES.has(String(value.phase))
    || !RETIRED_JOB_CHECKPOINTS.has(String(value.checkpoint))) return false;
  const counters = value.progressCounters;
  if (!isRecord(counters) || !hasOnlyKeys(counters, RETIRED_JOB_PROGRESS_KEYS)
    || RETIRED_JOB_PROGRESS_KEYS.size !== Object.keys(counters).length
    || !Object.values(counters).every(isNonNegativeInteger)) return false;
  return Array.isArray(value.warnings)
    && value.warnings.every(isNonEmptyString)
    && Array.isArray(value.blockingDivergenceCandidates);
}

function isReleasedJobRecord(record: Record<string, unknown>, expectedJobId: string): boolean {
  if (!hasOnlyKeys(record, RETIRED_JOB_KEYS)
    || record.schemaVersion !== WORKSPACE_REPLICATION_SCHEMA_VERSION
    || record.jobId !== expectedJobId
    || !isNonNegativeInteger(record.createdAtMs)
    || !isNonNegativeInteger(record.updatedAtMs)
    || !isReleasedJobStatus(record.status)) return false;
  for (const key of ['correlationId', 'relationshipId', 'directionId', 'offerId', 'lastErrorMessage'] as const) {
    if (record[key] !== undefined && !isNonEmptyString(record[key])) return false;
  }
  if (record.mode !== undefined && !['one_way_safe', 'one_way_replica', 'two_way_safe'].includes(String(record.mode))) return false;
  for (const key of ['cancelRequestedAtMs', 'abortedAtMs', 'completedAtMs', 'awaitingRecoveryAtMs', 'failedAtMs'] as const) {
    if (record[key] !== undefined && !isNonNegativeInteger(record[key])) return false;
  }
  if (record.lastAttempt !== undefined) {
    const attempt = record.lastAttempt;
    if (!isRecord(attempt)
      || !hasOnlyKeys(attempt, new Set(['attemptNumber', 'leaseId', 'ownerId', 'acquiredAtMs']))
      || Object.keys(attempt).length !== 4
      || !isNonNegativeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
      || !isNonEmptyString(attempt.leaseId) || !isNonEmptyString(attempt.ownerId)
      || !isNonNegativeInteger(attempt.acquiredAtMs)) return false;
  }
  if (record.resumeContext !== undefined) {
    const context = record.resumeContext;
    const apply = isRecord(context) ? context.apply : null;
    if (!isRecord(context) || !hasOnlyKeys(context, new Set(['apply']))
      || !isRecord(apply) || !hasOnlyKeys(apply, new Set(['targetPath', 'strategy', 'conflictPolicy']))
      || !isNonEmptyString(apply.targetPath)
      || !['transfer_snapshot', 'sync_changes'].includes(String(apply.strategy))
      || !['create_sibling_copy', 'replace_existing'].includes(String(apply.conflictPolicy))) return false;
  }
  if (record.result !== undefined) {
    const result = record.result;
    if (!isRecord(result) || Object.keys(result).length !== 1 || !isNonEmptyString(result.targetPath)) return false;
  }
  return true;
}

function isReleasedRelationshipRecord(
  record: Record<string, unknown>,
  expectedRelationshipId: string,
): boolean {
  if (!hasOnlyKeys(record, RETIRED_RELATIONSHIP_KEYS)
    || Object.keys(record).length !== RETIRED_RELATIONSHIP_KEYS.size
    || record.schemaVersion !== WORKSPACE_REPLICATION_SCHEMA_VERSION
    || record.relationshipId !== expectedRelationshipId
    || !RETIRED_RELATIONSHIP_ID_PATTERN.test(expectedRelationshipId)
    || !isNonNegativeInteger(record.createdAtMs)
    || !isNonNegativeInteger(record.updatedAtMs)
    || !Array.isArray(record.endpoints) || record.endpoints.length !== 2) return false;
  if (!record.endpoints.every((endpoint) => (
    isRecord(endpoint)
    && Object.keys(endpoint).length === 2
    && isNonEmptyString(endpoint.machineId) && endpoint.machineId === endpoint.machineId.trim()
    && isNonEmptyString(endpoint.rootPath) && isReleasedNormalizedWorkspaceRoot(endpoint.rootPath)
  ))) return false;
  const endpoints = record.endpoints as Array<Readonly<{ machineId: string; rootPath: string }>>;
  const sortedEndpoints = [...endpoints].sort((left, right) => (
    left.machineId.localeCompare(right.machineId) || left.rootPath.localeCompare(right.rootPath)
  ));
  if (JSON.stringify(endpoints) !== JSON.stringify(sortedEndpoints)) return false;
  const config = record.config;
  if (!(isRecord(config)
    && hasOnlyKeys(config, new Set(['mode', 'ignorePatterns']))
    && ['one_way_safe', 'one_way_replica', 'two_way_safe'].includes(String(config.mode))
    && (config.ignorePatterns === undefined || isReleasedNormalizedIgnorePatterns(config.ignorePatterns)))) return false;
  const relationshipIdentity = {
    endpoints: record.endpoints,
    ...(config.ignorePatterns === undefined ? {} : { ignorePatterns: config.ignorePatterns }),
    mode: config.mode,
  };
  return expectedRelationshipId === `rel_${createHash('sha256')
    .update(deterministicReleasedJson(relationshipIdentity))
    .digest('base64url')}`;
}

async function isRecognizedJobRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
  expectedJobId: string,
): Promise<boolean> {
  const record = await readJsonRecordCandidate(filePath, fileStat);
  return record !== null && isReleasedJobRecord(record, expectedJobId);
}

async function isRecognizedRelationshipRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
  expectedRelationshipId: string,
): Promise<boolean> {
  const record = await readJsonRecordCandidate(filePath, fileStat);
  return record !== null && isReleasedRelationshipRecord(record, expectedRelationshipId);
}

async function isRecognizedScopeLeaseRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
): Promise<boolean> {
  const record = await readJsonRecordCandidate(filePath, fileStat);
  return record !== null
    && hasOnlyKeys(record, new Set(['leaseId', 'attempt', 'ownerId', 'acquiredAtMs', 'renewedAtMs', 'expiresAtMs']))
    && isNonEmptyString(record.ownerId)
    && isFiniteNumber(record.acquiredAtMs)
    && isFiniteNumber(record.renewedAtMs)
    && isFiniteNumber(record.expiresAtMs)
    && (record.leaseId === undefined || isNonEmptyString(record.leaseId))
    && (record.attempt === undefined || (isNonNegativeInteger(record.attempt) && record.attempt >= 1));
}

function isReleasedManifestEntry(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.relativePath)
    || value.relativePath.startsWith('/') || value.relativePath.startsWith('\\')
    || /^[a-zA-Z]:[\\/]/u.test(value.relativePath)
    || !value.relativePath.split(/[\\/]/u).every((part) => part && part !== '.' && part !== '..')) return false;
  if (value.kind === 'directory') return Object.keys(value).length === 2;
  if (value.kind === 'symlink') {
    return Object.keys(value).length === 3 && isNonEmptyString(value.target);
  }
  return value.kind === 'file'
    && Object.keys(value).length === 5
    && isNonEmptyString(value.digest)
    && isNonNegativeInteger(value.sizeBytes)
    && typeof value.executable === 'boolean';
}

function isReleasedManifest(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, new Set(['entries', 'fingerprint']))
    && Array.isArray(value.entries)
    && value.entries.every(isReleasedManifestEntry)
    && (value.fingerprint === undefined || /^sha256:[a-f0-9]{64}$/u.test(String(value.fingerprint)));
}

function deterministicReleasedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(deterministicReleasedJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${deterministicReleasedJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isReleasedBaselineRecord(
  record: Record<string, unknown>,
  expectedDirectionId: string,
): boolean {
  if (!hasOnlyKeys(record, new Set(['schemaVersion', 'cacheKey', 'scope', 'baseline']))
    || Object.keys(record).length !== 4
    || record.schemaVersion !== WORKSPACE_REPLICATION_SCHEMA_VERSION
    || !/^workspace-replication-baseline-v1-[a-f0-9]{64}$/u.test(String(record.cacheKey))) return false;
  const scope = record.scope;
  if (!isRecord(scope)
    || !hasOnlyKeys(scope, new Set(['sourceMachineId', 'sourceWorkspaceRoot', 'targetMachineId', 'targetWorkspaceRoot', 'mode', 'ignorePatterns']))
    || !isNonEmptyString(scope.sourceMachineId) || scope.sourceMachineId !== scope.sourceMachineId.trim()
    || !isNonEmptyString(scope.sourceWorkspaceRoot) || !isReleasedNormalizedWorkspaceRoot(scope.sourceWorkspaceRoot)
    || !isNonEmptyString(scope.targetMachineId) || scope.targetMachineId !== scope.targetMachineId.trim()
    || !isNonEmptyString(scope.targetWorkspaceRoot) || !isReleasedNormalizedWorkspaceRoot(scope.targetWorkspaceRoot)
    || !['one_way_safe', 'one_way_replica', 'two_way_safe'].includes(String(scope.mode))
    || (scope.ignorePatterns !== undefined
      && !isReleasedNormalizedIgnorePatterns(scope.ignorePatterns))) return false;
  const directionScope = {
    sourceMachineId: scope.sourceMachineId,
    sourceWorkspaceRoot: scope.sourceWorkspaceRoot,
    targetMachineId: scope.targetMachineId,
    targetWorkspaceRoot: scope.targetWorkspaceRoot,
    mode: scope.mode,
    ...(scope.ignorePatterns === undefined ? {} : { ignorePatterns: scope.ignorePatterns }),
  };
  const serializedScope = JSON.stringify(directionScope);
  const expectedCacheKey = `workspace-replication-baseline-v1-${createHash('sha256')
    .update('workspace-replication-baseline-v1\n')
    .update(serializedScope)
    .digest('hex')}`;
  const expectedId = `dir_${createHash('sha256').update(deterministicReleasedJson(directionScope)).digest('base64url')}`;
  if (record.cacheKey !== expectedCacheKey || expectedDirectionId !== expectedId) return false;
  const baseline = record.baseline;
  return isRecord(baseline)
    && hasOnlyKeys(baseline, new Set(['manifestFingerprint', 'manifest', 'savedAtMs']))
    && Object.keys(baseline).length === 3
    && /^sha256:[a-f0-9]{64}$/u.test(String(baseline.manifestFingerprint))
    && isReleasedManifest(baseline.manifest)
    && isNonNegativeInteger(baseline.savedAtMs);
}

async function isRecognizedSourceOfferCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
  expectedOfferId: string,
): Promise<boolean> {
  if (fileStat.size > MAX_RECORD_BYTES) return false;
  const raw = await readFile(filePath, 'utf8').catch(() => null);
  if (raw === null) return false;
  const lines = raw.split(/\r?\n/u);
  if (lines.shift() !== RETIRED_SOURCE_OFFER_MAGIC) return false;
  const header = (() => {
    try { return JSON.parse(lines.shift() ?? '') as unknown; } catch { return null; }
  })();
  if (!isRecord(header)
    || !hasOnlyKeys(header, new Set(['offerId', 'relationshipId', 'directionId', 'sourceFingerprint', 'manifestFingerprint', 'sourceControllerMetadata']))
    || header.offerId !== expectedOfferId
    || !isNonEmptyString(header.relationshipId) || !isNonEmptyString(header.directionId)
    || !/^sha256:[a-f0-9]{64}$/u.test(String(header.sourceFingerprint))
    || (header.manifestFingerprint !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(String(header.manifestFingerprint)))
    || (header.sourceControllerMetadata !== undefined && !isRecord(header.sourceControllerMetadata))) return false;
  return lines.filter((line) => line.trim()).every((line) => {
    try { return isReleasedManifestEntry(JSON.parse(line) as unknown); } catch { return false; }
  });
}

async function inspectRelationshipRecordLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  let sawRecord = false;
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat) return null;
    if (entry.name === RETIRED_RELATIONSHIP_RECORD_NAME) {
      if (!isRealNonSymlinkFile(entryStat)) return null;
      if (!(await isRecognizedRelationshipRecordCandidate(entryPath, entryStat, basename(directoryPath)))) return null;
      sawRecord = true;
      continue;
    }
    if (entry.name === RETIRED_BASELINE_DIRECTORY_NAME) {
      if (!isRealNonSymlinkDirectory(entryStat)) return null;
      if (!(await inspectDirectionalBaselinesLocation(entryPath, bound))) return null;
      continue;
    }
    if (RETIRED_ATOMIC_TEMPORARY_FILE_PATTERN.test(entry.name)) {
      if (!isRealNonSymlinkFile(entryStat)) return null;
      continue;
    }
    return null;
  }
  if (!sawRecord) return null;
  return true;
}

async function inspectDirectionalBaselinesLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries || entries.length > bound.remaining) return false;
  bound.remaining -= entries.length;
  for (const entry of entries) {
    if (!RETIRED_DIRECTION_DIRECTORY_PATTERN.test(entry.name)) return false;
    const directionPath = join(directoryPath, entry.name);
    const directionStat = await lstat(directionPath).catch(() => null);
    if (!directionStat || !isRealNonSymlinkDirectory(directionStat)) return false;
    const directionEntries = await readdir(directionPath, { withFileTypes: true }).catch(() => null);
    if (!directionEntries || directionEntries.length > bound.remaining) return false;
    bound.remaining -= directionEntries.length;
    for (const directionEntry of directionEntries) {
      const entryPath = join(directionPath, directionEntry.name);
      const entryStat = await lstat(entryPath).catch(() => null);
      if (!entryStat || !isRealNonSymlinkFile(entryStat)) return false;
      if (directionEntry.name === RETIRED_BASELINE_RECORD_NAME) {
        const record = await readJsonRecordCandidate(entryPath, entryStat);
        if (!record || !isReleasedBaselineRecord(record, basename(directionPath))) return false;
        continue;
      }
      if (!RETIRED_ATOMIC_TEMPORARY_FILE_PATTERN.test(directionEntry.name)) return false;
    }
  }
  return true;
}

async function inspectJobRecordLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  let recognized = false;
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat) return null;
    if (RETIRED_ATOMIC_TEMPORARY_FILE_PATTERN.test(entry.name)) {
      if (!isRealNonSymlinkFile(entryStat)) return null;
      continue;
    }
    if (RETIRED_JOB_RECORD_FILE_PATTERN.test(entry.name)) {
      if (!isRealNonSymlinkFile(entryStat)) return null;
      if (!(await isRecognizedJobRecordCandidate(entryPath, entryStat, entry.name.slice(0, -'.json'.length)))) return null;
      recognized = true;
      continue;
    }
    return null;
  }
  return recognized;
}

async function inspectSourceOfferLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  let recognized = false;
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat) return null;
    if (!RETIRED_OFFER_FILE_PATTERN.test(entry.name) || !isRealNonSymlinkFile(entryStat)) return null;
    if (!(await isRecognizedSourceOfferCandidate(entryPath, entryStat, entry.name.slice(0, -'.txt'.length)))) return null;
    recognized = true;
  }
  return recognized;
}

async function inspectScopeLeaseLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  let recognized = false;
  for (const entry of entries) {
    if (!RETIRED_SCOPE_LEASE_DIRECTORY_PATTERN.test(entry.name)) return null;
    const scopePath = join(directoryPath, entry.name);
    const scopeStat = await lstat(scopePath).catch(() => null);
    if (!scopeStat || !isRealNonSymlinkDirectory(scopeStat)) return null;
    const scopeEntries = await readdir(scopePath, { withFileTypes: true }).catch(() => null);
    if (!scopeEntries) return null;
    if (scopeEntries.length > bound.remaining) return null;
    bound.remaining -= scopeEntries.length;
    let sawLeaseDirectory = false;
    for (const scopeEntry of scopeEntries) {
      const scopeEntryPath = join(scopePath, scopeEntry.name);
      const scopeEntryStat = await lstat(scopeEntryPath).catch(() => null);
      if (!scopeEntryStat) return null;
      if (scopeEntry.name === RETIRED_LEASE_DIRECTORY_NAME) {
        if (!isRealNonSymlinkDirectory(scopeEntryStat)) return null;
        const leaseEntries = await readdir(scopeEntryPath, { withFileTypes: true }).catch(() => null);
        if (!leaseEntries) return null;
        if (leaseEntries.length > bound.remaining) return null;
        bound.remaining -= leaseEntries.length;
        let sawLeaseRecord = false;
        for (const leaseEntry of leaseEntries) {
          const leaseEntryPath = join(scopeEntryPath, leaseEntry.name);
          const leaseEntryStat = await lstat(leaseEntryPath).catch(() => null);
          if (!leaseEntryStat) return null;
          if (leaseEntry.name === RETIRED_LEASE_RECORD_NAME) {
            if (!isRealNonSymlinkFile(leaseEntryStat)) return null;
            if (!(await isRecognizedScopeLeaseRecordCandidate(leaseEntryPath, leaseEntryStat))) return null;
            sawLeaseRecord = true;
            recognized = true;
            continue;
          }
          if (RETIRED_LEASE_TEMPORARY_FILE_PATTERN.test(leaseEntry.name)) {
            if (!isRealNonSymlinkFile(leaseEntryStat)) return null;
            continue;
          }
          return null;
        }
        if (!sawLeaseRecord) return null;
        sawLeaseDirectory = true;
        continue;
      }
      if (RETIRED_LEASE_TEMPORARY_DIRECTORY_PATTERN.test(scopeEntry.name)) {
        if (!isRealNonSymlinkDirectory(scopeEntryStat)) return null;
        const temporaryLeaseEntries = await readdir(scopeEntryPath, { withFileTypes: true }).catch(() => null);
        if (!temporaryLeaseEntries || temporaryLeaseEntries.length !== 1
          || temporaryLeaseEntries.length > bound.remaining) return null;
        bound.remaining -= temporaryLeaseEntries.length;
        const temporaryLeaseEntry = temporaryLeaseEntries[0]!;
        const temporaryLeasePath = join(scopeEntryPath, temporaryLeaseEntry.name);
        const temporaryLeaseStat = await lstat(temporaryLeasePath).catch(() => null);
        if (temporaryLeaseEntry.name !== RETIRED_LEASE_RECORD_NAME || !temporaryLeaseStat
          || !isRealNonSymlinkFile(temporaryLeaseStat)
          || !(await isRecognizedScopeLeaseRecordCandidate(temporaryLeasePath, temporaryLeaseStat))) return null;
        continue;
      }
      return null;
    }
    if (!sawLeaseDirectory) return null;
  }
  return recognized;
}

async function inspectStagingLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat) return null;
    if (!RETIRED_JOB_IDENTIFIER_PATTERN.test(entry.name) || !isRealNonSymlinkDirectory(entryStat)) return null;
    if (!(await inspectStagingJobLocation(entryPath, bound))) return null;
  }
  return false;
}

async function inspectStagingJobLocation(directoryPath: string, bound: TraversalBound): Promise<boolean> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries || entries.length > bound.remaining) return false;
  bound.remaining -= entries.length;
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat || !isRealNonSymlinkDirectory(entryStat)) return false;
    if (entry.name === RETIRED_LEASE_DIRECTORY_NAME) {
      if (!(await inspectLeaseDirectory(entryPath, bound))) return false;
      continue;
    }
    if (RETIRED_LEASE_TEMPORARY_DIRECTORY_PATTERN.test(entry.name)) {
      if (!(await inspectLeaseDirectory(entryPath, bound, { allowTemporaryFiles: false }))) return false;
      continue;
    }
    if (entry.name === RETIRED_STAGING_BLOB_PACKS_DIRECTORY_NAME) {
      if (!(await inspectStagingBlobPacksLocation(entryPath, bound))) return false;
      continue;
    }
    return false;
  }
  return true;
}

async function inspectLeaseDirectory(
  directoryPath: string,
  bound: TraversalBound,
  options: Readonly<{ allowTemporaryFiles?: boolean }> = {},
): Promise<boolean> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries || entries.length > bound.remaining) return false;
  bound.remaining -= entries.length;
  let sawRecord = false;
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat || !isRealNonSymlinkFile(entryStat)) return false;
    if (entry.name === RETIRED_LEASE_RECORD_NAME) {
      if (!(await isRecognizedScopeLeaseRecordCandidate(entryPath, entryStat))) return false;
      sawRecord = true;
      continue;
    }
    if (options.allowTemporaryFiles !== false && RETIRED_LEASE_TEMPORARY_FILE_PATTERN.test(entry.name)) continue;
    return false;
  }
  return sawRecord;
}

async function inspectStagingBlobPacksLocation(directoryPath: string, bound: TraversalBound): Promise<boolean> {
  const packEntries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!packEntries || packEntries.length > bound.remaining) return false;
  bound.remaining -= packEntries.length;
  for (const packEntry of packEntries) {
    if (!packEntry.name.trim() || packEntry.name.length > 128) return false;
    const packPath = join(directoryPath, packEntry.name);
    const packStat = await lstat(packPath).catch(() => null);
    if (!packStat || !isRealNonSymlinkDirectory(packStat)) return false;
    const partialEntries = await readdir(packPath, { withFileTypes: true }).catch(() => null);
    if (!partialEntries || partialEntries.length > bound.remaining) return false;
    bound.remaining -= partialEntries.length;
    for (const partialEntry of partialEntries) {
      const partialStat = await lstat(join(packPath, partialEntry.name)).catch(() => null);
      if (!partialStat || !isRealNonSymlinkFile(partialStat)
        || !RETIRED_STAGING_PACK_PARTIAL_FILE_PATTERN.test(partialEntry.name)) return false;
    }
  }
  return true;
}

async function inspectCasLocation(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  for (const entry of entries) {
    if (entry.name !== RETIRED_CAS_SHARD_DIRECTORY_NAME) return null;
    const shaDirectory = join(directoryPath, entry.name);
    const entryStat = await lstat(shaDirectory).catch(() => null);
    if (!entryStat || !isRealNonSymlinkDirectory(entryStat)) return null;
    const shards = await readdir(shaDirectory, { withFileTypes: true }).catch(() => null);
    if (!shards || shards.length > bound.remaining) return null;
    bound.remaining -= shards.length;
    for (const shard of shards) {
      if (!RETIRED_CAS_PREFIX_PATTERN.test(shard.name)) return null;
      const shardPath = join(shaDirectory, shard.name);
      const shardStat = await lstat(shardPath).catch(() => null);
      if (!shardStat || !isRealNonSymlinkDirectory(shardStat)) return null;
      const blobs = await readdir(shardPath, { withFileTypes: true }).catch(() => null);
      if (!blobs || blobs.length > bound.remaining) return null;
      bound.remaining -= blobs.length;
      for (const blob of blobs) {
        const blobStat = await lstat(join(shardPath, blob.name)).catch(() => null);
        if (!blobStat || !isRealNonSymlinkFile(blobStat)) return null;
        if (RETIRED_CAS_DIGEST_PATTERN.test(blob.name)) {
          if (!blob.name.startsWith(shard.name)) return null;
          continue;
        }
        if (!RETIRED_CAS_PARTIAL_FILE_PATTERN.test(blob.name)) return null;
      }
    }
  }
  return false;
}

/**
 * One full bounded traversal of the released record locations. Returns the
 * classification inputs only when every inspected entry matches the released
 * cli-v0.2.11 shape; a symlink, an unreadable entry, a malformed record
 * candidate, an unexpected name, or bound exhaustion returns null and the
 * caller must leave the state untouched.
 */
async function inspectReleasedStateLayout(
  rootPath: string,
  options: Readonly<{ ignoreRetirementMarker?: boolean }> = {},
): Promise<Readonly<{ inventoryHash: string; recognized: boolean }> | null> {
  const bound: TraversalBound = { remaining: MAX_SCAN_ENTRIES };
  bound.remaining -= 1; // the state root itself
  const inventory = await readInventory(rootPath, bound, options);
  if (!inventory) return null;
  let recognized = false;
  const locationInspectors: ReadonlyArray<Readonly<{
    directoryName: string;
    inspect: (directoryPath: string) => Promise<boolean | null>;
  }>> = [
    { directoryName: 'relationships', inspect: (path) => inspectRelationshipRecordLocationChain(path, bound) },
    { directoryName: 'jobs', inspect: (path) => inspectJobRecordLocation(path, bound) },
    { directoryName: 'offers', inspect: (path) => inspectSourceOfferLocation(path, bound) },
    { directoryName: 'scope-leases', inspect: (path) => inspectScopeLeaseLocation(path, bound) },
    { directoryName: 'staging', inspect: (path) => inspectStagingLocation(path, bound) },
    { directoryName: 'cas', inspect: (path) => inspectCasLocation(path, bound) },
  ];
  for (const location of locationInspectors) {
    const locationPath = join(rootPath, location.directoryName);
    // An installation may never have created every store directory. A missing
    // location contributes nothing; an unreadable or replaced one fails the
    // whole traversal closed.
    const locationStat = await lstat(locationPath).catch((error: unknown) => {
      return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? null : undefined;
    });
    if (locationStat === null) continue;
    if (!locationStat || !isRealNonSymlinkDirectory(locationStat)) return null;
    const outcome = await location.inspect(locationPath);
    if (outcome === null) return null;
    recognized = recognized || outcome;
  }
  return { inventoryHash: inventory.hash, recognized };
}

/** Relationships carry one record location per `rel_*` directory. */
async function inspectRelationshipRecordLocationChain(
  directoryPath: string,
  bound: TraversalBound,
): Promise<boolean | null> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  if (entries.length > bound.remaining) return null;
  bound.remaining -= entries.length;
  let recognized = false;
  for (const entry of entries) {
    if (!RETIRED_RELATIONSHIP_DIRECTORY_PATTERN.test(entry.name)) return null;
    const relationshipPath = join(directoryPath, entry.name);
    const relationshipStat = await lstat(relationshipPath).catch(() => null);
    if (!relationshipStat || !isRealNonSymlinkDirectory(relationshipStat)) return null;
    const outcome = await inspectRelationshipRecordLocation(relationshipPath, bound);
    if (outcome === null) return null;
    recognized = recognized || outcome;
  }
  return recognized;
}

function isOwnedAndPrivate(rootStat: Awaited<ReturnType<typeof lstat>>): boolean {
  if (typeof process.getuid === 'function' && rootStat.uid !== process.getuid()) return false;
  return (Number(rootStat.mode) & 0o077) === 0;
}

type LegacyStatePrivacyBoundary = Readonly<{
  platform: NodeJS.Platform;
  windowsAclBoundary?: WindowsProtectedAclBoundary;
  readLinuxMountInfo?: () => Promise<string>;
}>;

async function isPathOwnedAndPrivate(
  path: string,
  pathStat: Awaited<ReturnType<typeof lstat>>,
  boundary: LegacyStatePrivacyBoundary,
): Promise<boolean> {
  if (boundary.platform !== 'win32') return isOwnedAndPrivate(pathStat);
  const windowsAclBoundary = boundary.windowsAclBoundary;
  if (!windowsAclBoundary) return false;
  try {
    await windowsAclBoundary.verify({ path, kind: 'directory' });
    return true;
  } catch {
    return false;
  }
}

function decodeLinuxMountInfoPath(value: string): string {
  return value.replace(/\\(040|011|012|134)/gu, (escaped) => ({
    '\\040': ' ',
    '\\011': '\t',
    '\\012': '\n',
    '\\134': '\\',
  })[escaped] ?? escaped);
}

async function hasLinuxMountAtOrBelow(
  rootPath: string,
  readMountInfo: () => Promise<string>,
): Promise<boolean | null> {
  const raw = await readMountInfo().catch(() => null);
  if (raw === null) return null;
  const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const separatorIndex = line.indexOf(' - ');
    const fields = (separatorIndex < 0 ? line : line.slice(0, separatorIndex)).split(' ');
    if (fields.length < 5) return null;
    const mountPoint = decodeLinuxMountInfoPath(fields[4]!);
    if (mountPoint === rootPath || mountPoint.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Validates a previously written quarantine against the exact plan-owned
 * retirement marker/directory shape. Anything ambiguous or malformed fails
 * closed: a similarly named directory is never treated as authoritative.
 */
async function validateRetiredQuarantine(
  quarantinePath: string,
  name: string,
  boundary: LegacyStatePrivacyBoundary,
  canonicalActiveServerDir: string,
  activeServerDirStat: Awaited<ReturnType<typeof lstat>>,
): Promise<Readonly<{ valid: true; inventoryHash: string; markerPresent: boolean }> | Readonly<{ valid: false }>> {
  const match = RETIRED_QUARANTINE_NAME_PATTERN.exec(name);
  if (!match) return { valid: false };
  const namedAtMs = Number(match[1]);
  const statEntry = await lstat(quarantinePath).catch(() => null);
  if (!statEntry || !statEntry.isDirectory() || statEntry.isSymbolicLink()) return { valid: false };
  const canonicalQuarantinePath = await realpathSafe(quarantinePath);
  if (!canonicalQuarantinePath || dirname(canonicalQuarantinePath) !== canonicalActiveServerDir
    || (typeof statEntry.dev === 'number' && typeof activeServerDirStat.dev === 'number'
      && statEntry.dev !== activeServerDirStat.dev)) return { valid: false };
  if (boundary.platform === 'linux') {
    const hasMount = await hasLinuxMountAtOrBelow(
      canonicalQuarantinePath,
      boundary.readLinuxMountInfo ?? (async () => await readFile('/proc/self/mountinfo', 'utf8')),
    );
    if (hasMount !== false) return { valid: false };
  }
  if (!(await isPathOwnedAndPrivate(canonicalQuarantinePath, statEntry, boundary))) return { valid: false };
  const rawMarker = await readFile(join(canonicalQuarantinePath, RETIREMENT_MARKER_NAME), 'utf8').catch(() => null);
  if (rawMarker === null) {
    const layout = await inspectReleasedStateLayout(canonicalQuarantinePath).catch(() => null);
    if (!layout?.recognized) return { valid: false };
    return { valid: true, inventoryHash: layout.inventoryHash, markerPresent: false };
  }
  if (rawMarker.length > MAX_RECORD_BYTES) return { valid: false };
  let marker: unknown;
  try {
    marker = JSON.parse(rawMarker);
  } catch {
    return { valid: false };
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return { valid: false };
  const record = marker as Record<string, unknown>;
  if (record.detectedSchemaVersion !== WORKSPACE_REPLICATION_SCHEMA_VERSION) return { valid: false };
  if (typeof record.detectedAtMs !== 'number' || !Number.isSafeInteger(record.detectedAtMs)
    || record.detectedAtMs !== namedAtMs) {
    return { valid: false };
  }
  if (typeof record.installationId !== 'string' || record.installationId.length < 1
    || record.installationId.length > MAX_INSTALLATION_ID_LENGTH) {
    return { valid: false };
  }
  if (typeof record.inventoryHash !== 'string' || !INVENTORY_HASH_PATTERN.test(record.inventoryHash)) {
    return { valid: false };
  }
  // Re-run the exact bounded released-layout proof. The immediate inventory
  // hash alone cannot detect nested drift after the quarantine was marked.
  const layout = await inspectReleasedStateLayout(canonicalQuarantinePath, { ignoreRetirementMarker: true }).catch(() => null);
  if (!layout?.recognized || layout.inventoryHash !== record.inventoryHash) return { valid: false };
  return { valid: true, inventoryHash: layout.inventoryHash, markerPresent: true };
}

/**
 * Recognizes a valid prior quarantine once the live state root is gone, so a
 * restart keeps reporting the retired state instead of forgetting it. Only
 * immediate children of the active server directory are considered; no broad
 * scan runs and no quarantine is modified.
 */
async function classifyRetiredQuarantine(
  activeServerDir: string,
  statePath: string,
  boundary: LegacyStatePrivacyBoundary,
  metadata: Readonly<{ installationId: string; nowMs: number }>,
): Promise<WorkspaceSyncLegacyStateInspection> {
  const entries = await readdir(activeServerDir, { withFileTypes: true }).catch((error: unknown) => (
    (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? [] : null
  ));
  if (!entries) return unknown(statePath, 'active_server_dir_unreadable');
  const candidates = entries
    .filter((entry) => RETIRED_QUARANTINE_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) return { status: 'absent', path: statePath };
  if (candidates.length > 1) return unknown(activeServerDir, 'multiple_retired_quarantines');
  const quarantinePath = join(activeServerDir, candidates[0]!);
  const canonicalActiveServerDir = await realpathSafe(activeServerDir);
  const activeServerDirStat = canonicalActiveServerDir
    ? await lstat(canonicalActiveServerDir).catch(() => null)
    : null;
  if (!canonicalActiveServerDir || !activeServerDirStat || !activeServerDirStat.isDirectory()
    || activeServerDirStat.isSymbolicLink()) {
    return unknown(quarantinePath, 'active_server_dir_unreadable');
  }
  if (!(await isPathOwnedAndPrivate(canonicalActiveServerDir, activeServerDirStat, boundary))) {
    return unknown(quarantinePath, 'parent_ownership_or_permissions');
  }
  const validated: Array<Readonly<{ path: string; inventoryHash: string; markerPresent: boolean }>> = [];
  for (const name of candidates) {
    const candidatePath = join(activeServerDir, name);
    const outcome = await validateRetiredQuarantine(
      candidatePath,
      name,
      boundary,
      canonicalActiveServerDir,
      activeServerDirStat,
    );
    if (!outcome.valid) return unknown(candidatePath, 'malformed_retired_quarantine');
    validated.push({ path: candidatePath, inventoryHash: outcome.inventoryHash, markerPresent: outcome.markerPresent });
  }
  const recognized = validated[0]!;
  if (!recognized.markerPresent) {
    try {
      await writeJsonAtomic(join(recognized.path, RETIREMENT_MARKER_NAME), {
        detectedSchemaVersion: WORKSPACE_REPLICATION_SCHEMA_VERSION,
        detectedAtMs: Number(RETIRED_QUARANTINE_NAME_PATTERN.exec(basename(recognized.path))?.[1] ?? metadata.nowMs),
        installationId: metadata.installationId,
        inventoryHash: recognized.inventoryHash,
      });
    } catch {
      return unknown(recognized.path, 'quarantine_marker_failed');
    }
  }
  return {
    status: 'legacy_workspace_sync_state_unsupported',
    classification: 'retired_v1',
    path: recognized.path,
    quarantinePath: recognized.path,
    schemaVersion: WORKSPACE_REPLICATION_SCHEMA_VERSION,
    inventoryHash: recognized.inventoryHash,
  };
}

/**
 * The one owner-local availability assertion, derived once from the startup
 * inspection. When retired v1 state is present or unrecognized, every
 * workspace-sync entry point must fail closed with the exact typed status
 * before any relationship, copy, bootstrap, agent or target mutation runs.
 * The message is bounded and never contains paths or inventory details.
 */
export function createWorkspaceSyncLegacyStateGate(inspection: WorkspaceSyncLegacyStateInspection): () => void {
  if (inspection.status === 'absent') return () => undefined;
  const message = inspection.status === 'legacy_workspace_sync_state_unsupported'
    ? 'Retired workspace replication state is present and unsupported; workspace sync stays disabled'
    : 'Workspace sync legacy state could not be safely classified; workspace sync stays disabled';
  const { status } = inspection;
  return () => {
    throw Object.assign(new Error(message), { code: status });
  };
}

export async function inspectRetiredWorkspaceReplicationState(
  input: InspectRetiredWorkspaceReplicationStateInput,
): Promise<WorkspaceSyncLegacyStateInspection> {
  const platform = input.platform ?? process.platform;
  const boundary: LegacyStatePrivacyBoundary = {
    platform,
    windowsAclBoundary: platform === 'win32'
      ? input.windowsAclBoundary ?? createWindowsProtectedAclBoundary()
      : undefined,
    readLinuxMountInfo: platform === 'linux' ? input.readLinuxMountInfo : undefined,
  };
  const activeServerDir = resolve(input.activeServerDir);
  const statePath = join(activeServerDir, LEGACY_DIRECTORY_NAME);
  const initialStat = await lstat(statePath).catch((error: unknown) => {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? null : undefined;
  });
  const installationId = typeof input.installationId === 'string'
    && input.installationId.length > 0
    && input.installationId.length <= MAX_INSTALLATION_ID_LENGTH
    ? input.installationId
    : 'unknown';
  const nowMs = input.nowMs ?? Date.now();
  if (initialStat === null) return await classifyRetiredQuarantine(activeServerDir, statePath, boundary, { installationId, nowMs });
  if (!initialStat || !initialStat.isDirectory() || initialStat.isSymbolicLink()) {
    return unknown(statePath, 'not_a_real_directory');
  }

  const canonicalActiveServerDir = await realpathSafe(activeServerDir);
  const canonicalParent = await stat(activeServerDir).catch(() => null);
  const canonicalStatePath = await realpathSafe(statePath);
  if (!canonicalParent || !canonicalActiveServerDir || !canonicalStatePath
    || dirname(canonicalStatePath) !== canonicalActiveServerDir
    || basename(canonicalStatePath) !== LEGACY_DIRECTORY_NAME) {
    return unknown(statePath, 'path_replacement');
  }
  if (!(await isPathOwnedAndPrivate(canonicalActiveServerDir, canonicalParent, boundary))) {
    return unknown(statePath, 'parent_ownership_or_permissions');
  }
  const canonicalStateStat = await lstat(canonicalStatePath).catch(() => null);
  if (!canonicalStateStat || !canonicalStateStat.isDirectory() || canonicalStateStat.isSymbolicLink()) {
    return unknown(statePath, 'path_replacement');
  }
  if (typeof canonicalStateStat.dev === 'number' && typeof canonicalParent.dev === 'number'
    && canonicalStateStat.dev !== canonicalParent.dev) {
    return unknown(statePath, 'mount_replacement');
  }
  if (platform === 'linux') {
    const hasMount = await hasLinuxMountAtOrBelow(
      canonicalStatePath,
      boundary.readLinuxMountInfo ?? (async () => await readFile('/proc/self/mountinfo', 'utf8')),
    );
    if (hasMount !== false) return unknown(statePath, 'mount_replacement');
  }
  if (!(await isPathOwnedAndPrivate(canonicalStatePath, canonicalStateStat, boundary))) {
    return unknown(statePath, 'ownership_or_permissions');
  }

  const layout = await inspectReleasedStateLayout(canonicalStatePath).catch(() => null);
  if (!layout) return unknown(statePath, 'unrecognized_child');
  if (!layout.recognized) return unknown(statePath, 'recognized_v1_record_missing');

  const suffix = input.randomSuffix && input.randomSuffix.length <= 64 && /^[A-Za-z0-9_-]+$/u.test(input.randomSuffix)
    ? input.randomSuffix
    : randomUUID().replaceAll('-', '');
  const quarantinePath = join(activeServerDir, `${RETIRED_DIRECTORY_PREFIX}${String(nowMs)}-${suffix}`);
  // Establish private permissions on the state root BEFORE it becomes visible
  // under the quarantine name: a failed hardening step must never leave a
  // publicly readable quarantine behind, and every failure below this point
  // reports the path that actually exists (the still-present state root).
  if (platform === 'win32') {
    const windowsAclBoundary = boundary.windowsAclBoundary;
    if (!windowsAclBoundary) return unknown(statePath, 'quarantine_permissions_failed');
    try {
      await windowsAclBoundary.applyAndVerify({ path: canonicalStatePath, kind: 'directory' });
    } catch {
      return unknown(statePath, 'quarantine_permissions_failed');
    }
  } else {
    try {
      await (input.setPosixPrivatePermissions ?? ((path: string) => chmod(path, 0o700)))(canonicalStatePath);
      const hardenedStat = await lstat(canonicalStatePath);
      if (!hardenedStat.isDirectory() || hardenedStat.isSymbolicLink()
        || !isOwnedAndPrivate(hardenedStat)) {
        return unknown(statePath, 'quarantine_permissions_failed');
      }
    } catch {
      return unknown(statePath, 'quarantine_permissions_failed');
    }
  }

  try {
    await rename(canonicalStatePath, quarantinePath);
  } catch {
    return unknown(statePath, 'quarantine_failed');
  }

  if (platform === 'win32') {
    // Re-prove the renamed quarantine through the canonical boundary. The
    // rename already happened, so this failure reports the existing
    // quarantine path instead of the now-absent state root.
    const windowsAclBoundary = boundary.windowsAclBoundary;
    if (!windowsAclBoundary) return unknown(quarantinePath, 'quarantine_permissions_failed');
    try {
      await windowsAclBoundary.applyAndVerify({ path: quarantinePath, kind: 'directory' });
    } catch {
      return unknown(quarantinePath, 'quarantine_permissions_failed');
    }
  }
  const quarantineStat = await lstat(quarantinePath).catch(() => null);
  if (!quarantineStat || !quarantineStat.isDirectory() || quarantineStat.isSymbolicLink()
    || !(await isPathOwnedAndPrivate(quarantinePath, quarantineStat, boundary))) {
    return unknown(quarantinePath, 'quarantine_permissions_failed');
  }
  try {
    await writeJsonAtomic(join(quarantinePath, RETIREMENT_MARKER_NAME), {
      detectedSchemaVersion: WORKSPACE_REPLICATION_SCHEMA_VERSION,
      detectedAtMs: nowMs,
      installationId,
      inventoryHash: layout.inventoryHash,
    });
  } catch {
    return unknown(quarantinePath, 'quarantine_marker_failed');
  }
  return {
    status: 'legacy_workspace_sync_state_unsupported',
    classification: 'retired_v1',
    path: statePath,
    quarantinePath,
    schemaVersion: WORKSPACE_REPLICATION_SCHEMA_VERSION,
    inventoryHash: layout.inventoryHash,
  };
}

async function realpathSafe(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}
