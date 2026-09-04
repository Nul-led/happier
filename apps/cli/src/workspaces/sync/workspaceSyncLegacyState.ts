import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, open, readFile, readdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

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
// whose first line is the released stream magic. There is deliberately no
// recursive scan: anything outside these locations proves nothing.
const RETIRED_RELATIONSHIP_DIRECTORY_PATTERN = /^rel_[A-Za-z0-9_-]+$/u;
const RETIRED_SCOPE_LEASE_DIRECTORY_PATTERN = /^rel_[A-Za-z0-9_-]+__dir_[A-Za-z0-9_-]+$/u;
const RETIRED_JOB_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/u;
const RETIRED_JOB_RECORD_FILE_PATTERN = /^[A-Za-z0-9._-]+\.json$/u;
const RETIRED_OFFER_FILE_PATTERN = /^offer_[A-Za-z0-9_-]+\.txt$/u;
const RETIRED_SOURCE_OFFER_MAGIC = 'HAPPIER_WORKSPACE_REPLICATION_SOURCE_OFFER_V1';
const RETIRED_CAS_SHARD_DIRECTORY_NAME = 'sha256';
const RETIRED_BASELINE_DIRECTORY_NAME = 'directionalBaselines';
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

async function isRecognizedJobRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
): Promise<boolean> {
  const record = await readJsonRecordCandidate(filePath, fileStat);
  return record !== null
    && record.schemaVersion === WORKSPACE_REPLICATION_SCHEMA_VERSION
    && typeof record.jobId === 'string'
    && record.jobId.length > 0;
}

async function isRecognizedRelationshipRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
): Promise<boolean> {
  const record = await readJsonRecordCandidate(filePath, fileStat);
  return record !== null
    && record.schemaVersion === WORKSPACE_REPLICATION_SCHEMA_VERSION
    && typeof record.relationshipId === 'string'
    && record.relationshipId.length > 0;
}

async function isRecognizedScopeLeaseRecordCandidate(
  filePath: string,
  fileStat: Awaited<ReturnType<typeof lstat>>,
): Promise<boolean> {
  const record = await readJsonRecordCandidate(filePath, fileStat);
  return record !== null
    && typeof record.ownerId === 'string'
    && record.ownerId.trim().length > 0
    && typeof record.acquiredAtMs === 'number'
    && typeof record.renewedAtMs === 'number'
    && typeof record.expiresAtMs === 'number';
}

async function isRecognizedSourceOfferCandidate(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r').catch(() => null);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(RETIRED_SOURCE_OFFER_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8') === RETIRED_SOURCE_OFFER_MAGIC;
  } finally {
    await handle.close().catch(() => undefined);
  }
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
      if (!(await isRecognizedRelationshipRecordCandidate(entryPath, entryStat))) return null;
      sawRecord = true;
      continue;
    }
    if (entry.name === RETIRED_BASELINE_DIRECTORY_NAME) {
      if (!isRealNonSymlinkDirectory(entryStat)) return null;
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
      if (!(await isRecognizedJobRecordCandidate(entryPath, entryStat))) return null;
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
    if (!(await isRecognizedSourceOfferCandidate(entryPath))) return null;
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
  }
  return false;
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
    if (RETIRED_CAS_PARTIAL_FILE_PATTERN.test(entry.name)) {
      const entryStat = await lstat(join(directoryPath, entry.name)).catch(() => null);
      if (!entryStat || !isRealNonSymlinkFile(entryStat)) return null;
      continue;
    }
    if (entry.name !== RETIRED_CAS_SHARD_DIRECTORY_NAME) return null;
    const entryStat = await lstat(join(directoryPath, entry.name)).catch(() => null);
    if (!entryStat || !isRealNonSymlinkDirectory(entryStat)) return null;
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
): Promise<Readonly<{ inventoryHash: string; recognized: boolean }> | null> {
  const bound: TraversalBound = { remaining: MAX_SCAN_ENTRIES };
  bound.remaining -= 1; // the state root itself
  const inventory = await readInventory(rootPath, bound);
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

function isOwnedAndSafeToInspectBeforePrivacyHardening(
  rootStat: Awaited<ReturnType<typeof lstat>>,
): boolean {
  if (typeof process.getuid === 'function' && rootStat.uid !== process.getuid()) return false;
  // The released state may predate Lane 08's user-only quarantine contract.
  // Read/execute visibility can be removed after exact classification, but an
  // externally writable tree cannot be classified without a mutation race.
  return (Number(rootStat.mode) & 0o022) === 0;
}

type LegacyStatePrivacyBoundary = Readonly<{
  platform: NodeJS.Platform;
  windowsAclBoundary?: WindowsProtectedAclBoundary;
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

async function isPathSafeToInspectBeforePrivacyHardening(
  path: string,
  pathStat: Awaited<ReturnType<typeof lstat>>,
  boundary: LegacyStatePrivacyBoundary,
): Promise<boolean> {
  if (boundary.platform !== 'win32') return isOwnedAndSafeToInspectBeforePrivacyHardening(pathStat);
  return await isPathOwnedAndPrivate(path, pathStat, boundary);
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
): Promise<Readonly<{ valid: true; inventoryHash: string; markerPresent: boolean }> | Readonly<{ valid: false }>> {
  const match = RETIRED_QUARANTINE_NAME_PATTERN.exec(name);
  if (!match) return { valid: false };
  const namedAtMs = Number(match[1]);
  const statEntry = await lstat(quarantinePath).catch(() => null);
  if (!statEntry || !statEntry.isDirectory() || statEntry.isSymbolicLink()) return { valid: false };
  if (!(await isPathOwnedAndPrivate(quarantinePath, statEntry, boundary))) return { valid: false };
  const rawMarker = await readFile(join(quarantinePath, RETIREMENT_MARKER_NAME), 'utf8').catch(() => null);
  if (rawMarker === null) {
    const layout = await inspectReleasedStateLayout(quarantinePath).catch(() => null);
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
  // The recorded inventory must still describe the quarantined children
  // (excluding the marker itself); drift makes the directory ambiguous.
  const inventory = await readInventory(quarantinePath, { remaining: MAX_SCAN_ENTRIES }, { ignoreRetirementMarker: true }).catch(() => null);
  if (!inventory || inventory.hash !== record.inventoryHash) return { valid: false };
  return { valid: true, inventoryHash: inventory.hash, markerPresent: true };
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
    const outcome = await validateRetiredQuarantine(candidatePath, name, boundary);
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
  if (!(await isPathSafeToInspectBeforePrivacyHardening(canonicalStatePath, canonicalStateStat, boundary))) {
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
