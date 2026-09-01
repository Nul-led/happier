import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { normalizeSessionHandoffWorkspaceRootPath } from '@happier-dev/protocol';

import { readProcessIdentityByPid } from '@/daemon/processIdentity';
import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import { reclaimJsonOwnerFileLockSnapshot, withJsonOwnerFileLock } from '@/utils/fs/jsonOwnerFileLock';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import { computeWorkspaceSyncRootFingerprint } from './workspaceSyncRootIdentity';

export type WorkspaceRootOwnershipRequest = Readonly<{
  ownerId: string;
  canonicalRoot: string;
  operation: 'sync' | 'bootstrap' | 'handoff';
  /** Bootstrap recovery may replace the current object while this reservation is held. */
  deferRootIdentityBinding?: true;
}>;
export type WorkspaceRootOwnership = WorkspaceRootOwnershipRequest & Readonly<{ rootFingerprint: string | null }>;
export type WorkspaceRootOwnershipHandle = Readonly<{
  owner: WorkspaceRootOwnership;
  bindCurrentRootIdentity: () => Promise<void>;
  release: () => Promise<void>;
}>;
export type WorkspaceRootOwnershipResult = WorkspaceRootOwnershipHandle | Readonly<{
  kind: 'overlap';
  existing: WorkspaceRootOwnership;
}>;

type ProcessOwner = Readonly<{ pid: number; processStartedAtMs: number | null; ownerToken: string }>;
type ProcessOwnerObservation =
  | Readonly<{ kind: 'dead' }>
  | Readonly<{ kind: 'alive'; processStartedAtMs: number | null }>;
type OwnershipRecordV2 = WorkspaceRootOwnership & Readonly<{ v: 2; processOwner: ProcessOwner }>;
type ActiveOwnership = {
  owner: { -readonly [Key in keyof WorkspaceRootOwnership]: WorkspaceRootOwnership[Key] };
  path: string;
  processOwner: ProcessOwner;
  lost: boolean;
};
type RecordSnapshot = Readonly<{ raw: string; record: OwnershipRecordV2 | null }>;

const operations = new Set(['sync', 'bootstrap', 'handoff']);
const ownerTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseOwner(record: Record<string, unknown>): WorkspaceRootOwnership | null {
  if (typeof record.ownerId !== 'string' || !record.ownerId) return null;
  if (typeof record.canonicalRoot !== 'string' || !record.canonicalRoot) return null;
  if (!operations.has(String(record.operation))) return null;
  if (!(record.rootFingerprint === null
    || (typeof record.rootFingerprint === 'string' && /^[a-f0-9]{64}$/u.test(record.rootFingerprint)))) return null;
  return {
    ownerId: record.ownerId,
    canonicalRoot: record.canonicalRoot,
    operation: record.operation as WorkspaceRootOwnership['operation'],
    rootFingerprint: record.rootFingerprint,
  };
}

function parseRecord(raw: string): OwnershipRecordV2 | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const owner = parseOwner(record);
    if (!owner) return null;
    if (record.v !== 2
      || !hasExactKeys(record, ['v', 'ownerId', 'canonicalRoot', 'operation', 'rootFingerprint', 'processOwner'])) return null;
    if (!record.processOwner || typeof record.processOwner !== 'object' || Array.isArray(record.processOwner)) return null;
    const processOwner = record.processOwner as Record<string, unknown>;
    if (!hasExactKeys(processOwner, ['pid', 'processStartedAtMs', 'ownerToken'])) return null;
    if (!Number.isSafeInteger(processOwner.pid) || Number(processOwner.pid) < 1) return null;
    if (!(processOwner.processStartedAtMs === null
      || (Number.isSafeInteger(processOwner.processStartedAtMs) && Number(processOwner.processStartedAtMs) >= 0))) return null;
    if (typeof processOwner.ownerToken !== 'string' || !ownerTokenPattern.test(processOwner.ownerToken)) return null;
    return {
      v: 2,
      ...owner,
      processOwner: {
        pid: Number(processOwner.pid),
        processStartedAtMs: processOwner.processStartedAtMs === null ? null : Number(processOwner.processStartedAtMs),
        ownerToken: processOwner.ownerToken,
      },
    };
  } catch {
    return null;
  }
}

async function resolveCanonicalRoot(input: string): Promise<string> {
  const normalized = normalizeSessionHandoffWorkspaceRootPath(input);
  if (!normalized) throw new Error('workspace root ownership root is unsafe');
  try {
    const localIdentity = normalizeSessionHandoffWorkspaceRootPath(await realpath(normalized));
    if (!localIdentity) throw new Error('workspace root ownership real path is unsafe');
    return localIdentity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return normalized;
  }
}

function overlaps(left: string, right: string): boolean {
  return getPathRemainderWithinBase(left, right) !== null
    || getPathRemainderWithinBase(right, left) !== null;
}

function recordPath(lockDirectory: string, canonicalRoot: string): string {
  return join(lockDirectory, `${createHash('sha256').update(canonicalRoot).digest('hex')}.json`);
}

async function inspectProcessOwner(pid: number): Promise<ProcessOwnerObservation> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') return { kind: 'dead' };
  }
  const identity = await readProcessIdentityByPid(pid);
  return {
    kind: 'alive',
    processStartedAtMs: Number.isSafeInteger(identity?.processStartTimeMs) ? identity?.processStartTimeMs ?? null : null,
  };
}

async function readSnapshot(path: string): Promise<RecordSnapshot | null> {
  const raw = await readFile(path, 'utf8').catch(() => null);
  return raw === null ? null : { raw, record: parseRecord(raw) };
}

function exactRecordOwner(record: OwnershipRecordV2, owner: WorkspaceRootOwnership, processOwner: ProcessOwner): boolean {
  return record.ownerId === owner.ownerId
    && record.canonicalRoot === owner.canonicalRoot
    && record.operation === owner.operation
    && record.rootFingerprint === owner.rootFingerprint
    && record.processOwner.pid === processOwner.pid
    && record.processOwner.processStartedAtMs === processOwner.processStartedAtMs
    && record.processOwner.ownerToken === processOwner.ownerToken;
}

function ownerFromRecord(record: OwnershipRecordV2): WorkspaceRootOwnership {
  return {
    ownerId: record.ownerId,
    canonicalRoot: record.canonicalRoot,
    operation: record.operation,
    rootFingerprint: record.rootFingerprint,
  };
}

export type WorkspaceRootOwnershipManager = Readonly<{
  tryAcquire(input: WorkspaceRootOwnershipRequest): Promise<WorkspaceRootOwnershipResult>;
}>;

export function createWorkspaceRootOwnershipManager(options: Readonly<{
  lockDirectory: string;
  processOwner?: ProcessOwner;
  inspectProcessOwner?: (pid: number) => Promise<ProcessOwnerObservation>;
}>): WorkspaceRootOwnershipManager {
  const lockDirectory = resolve(options.lockDirectory);
  const observeProcessOwner = options.inspectProcessOwner ?? inspectProcessOwner;
  const inventoryLockPath = join(lockDirectory, '.inventory.lock');
  const activeOwnership = new Set<ActiveOwnership>();
  let serialization: Promise<void> = Promise.resolve();
  let currentProcessOwner: Promise<ProcessOwner> | null = null;

  const resolveCurrentProcessOwner = async (): Promise<ProcessOwner> => {
    currentProcessOwner ??= (async () => {
      if (options.processOwner) return options.processOwner;
      const observation = await inspectProcessOwner(process.pid);
      return {
        pid: process.pid,
        processStartedAtMs: observation.kind === 'alive' ? observation.processStartedAtMs : null,
        ownerToken: randomUUID(),
      };
    })();
    return await currentProcessOwner;
  };

  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    const prior = serialization;
    let release!: () => void;
    serialization = new Promise<void>((resolveQueue) => { release = resolveQueue; });
    await prior;
    try { return await action(); } finally { release(); }
  };

  const withInventoryLock = async <T>(action: () => Promise<T>): Promise<T> => {
    await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(lockDirectory, 0o700);
    return await withJsonOwnerFileLock({
      lockPath: inventoryLockPath,
      timeoutMs: 5_000,
      staleAfterMs: 30_000,
      errorCode: 'workspace_root_ownership_busy',
      readProcessStartedAtMs: async (pid) => {
        const identity = await readProcessIdentityByPid(pid);
        return Number.isSafeInteger(identity?.processStartTimeMs) ? identity?.processStartTimeMs ?? null : null;
      },
    }, action);
  };

  const removeExactRecord = async (path: string, raw: string): Promise<boolean> => {
    const result = await reclaimJsonOwnerFileLockSnapshot(path, raw);
    if (result === 'ownership_unknown') {
      throw Object.assign(new Error('workspace root ownership is compromised'), {
        code: 'workspace_root_ownership_compromised',
      });
    }
    return result === 'reclaimed';
  };

  const createHandle = (entry: ActiveOwnership): WorkspaceRootOwnershipHandle => {
    let released = false;
    return {
      owner: entry.owner,
      bindCurrentRootIdentity: async () => await exclusive(async () => {
        if (released || entry.lost) {
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        const fingerprint = await computeWorkspaceSyncRootFingerprint(entry.owner.canonicalRoot).catch(() => null);
        if (!fingerprint || (entry.owner.rootFingerprint !== null && entry.owner.rootFingerprint !== fingerprint)) {
          entry.lost = true;
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        if (entry.owner.rootFingerprint === fingerprint) return;
        await withInventoryLock(async () => {
          const snapshot = await readSnapshot(entry.path);
          if (!snapshot?.record || !exactRecordOwner(snapshot.record, entry.owner, entry.processOwner)) {
            entry.lost = true;
            throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
          }
          const boundOwner = { ...entry.owner, rootFingerprint: fingerprint } satisfies WorkspaceRootOwnership;
          await writeJsonAtomic(entry.path, { v: 2, ...boundOwner, processOwner: entry.processOwner } satisfies OwnershipRecordV2);
          entry.owner.rootFingerprint = fingerprint;
        });
      }),
      release: async () => await exclusive(async () => {
        if (released) return;
        released = true;
        activeOwnership.delete(entry);
        await withInventoryLock(async () => {
          const snapshot = await readSnapshot(entry.path);
          if (snapshot?.record && exactRecordOwner(snapshot.record, entry.owner, entry.processOwner)) {
            await removeExactRecord(entry.path, snapshot.raw);
          }
        });
      }),
    };
  };

  return {
    tryAcquire: async (input) => await exclusive(async () => {
      const ownerId = input.ownerId.trim();
      if (!ownerId) throw new Error('workspace root ownership ownerId must be non-empty');
      const canonicalRoot = await resolveCanonicalRoot(input.canonicalRoot);
      const processOwner = await resolveCurrentProcessOwner();
      return await withInventoryLock(async () => {
        const names = await readdir(lockDirectory);
        for (const name of names) {
          if (!name.endsWith('.json')) continue;
          const path = join(lockDirectory, name);
          const snapshot = await readSnapshot(path);
          if (!snapshot?.record) {
            return {
              kind: 'overlap',
              existing: { ownerId: 'unknown', canonicalRoot, operation: 'sync', rootFingerprint: null },
            };
          }

          const persistedProcess = snapshot.record.processOwner;
          const observation = await observeProcessOwner(persistedProcess.pid);
          const provenDead = observation.kind === 'dead';
          const provenReused = observation.kind === 'alive'
            && persistedProcess.processStartedAtMs !== null
            && observation.processStartedAtMs !== null
            && persistedProcess.processStartedAtMs !== observation.processStartedAtMs;
          if ((provenDead || provenReused) && await removeExactRecord(path, snapshot.raw)) continue;

          if (overlaps(snapshot.record.canonicalRoot, canonicalRoot)) {
            return { kind: 'overlap', existing: ownerFromRecord(snapshot.record) };
          }
        }

        const rootFingerprint = input.deferRootIdentityBinding
          ? null
          : await computeWorkspaceSyncRootFingerprint(canonicalRoot).catch(() => null);
        const owner = { ownerId, canonicalRoot, operation: input.operation, rootFingerprint } satisfies WorkspaceRootOwnership;
        const path = recordPath(lockDirectory, canonicalRoot);
        await writeJsonAtomic(path, { v: 2, ...owner, processOwner } satisfies OwnershipRecordV2);
        const active = { owner, path, processOwner, lost: false } satisfies ActiveOwnership;
        activeOwnership.add(active);
        return createHandle(active);
      });
    }),
  };
}
