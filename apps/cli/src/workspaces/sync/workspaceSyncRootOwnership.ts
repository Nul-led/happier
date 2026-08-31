import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { normalizeSessionHandoffWorkspaceRootPath } from '@happier-dev/protocol';

import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import { withJsonOwnerFileLock } from '@/utils/fs/jsonOwnerFileLock';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import { computeWorkspaceSyncRootFingerprint } from './workspaceSyncRootIdentity';

export type WorkspaceRootOwnershipRequest = Readonly<{ ownerId: string; canonicalRoot: string; operation: 'sync' | 'bootstrap' | 'handoff' }>;
export type WorkspaceRootOwnership = WorkspaceRootOwnershipRequest & Readonly<{ rootFingerprint: string | null }>;
export type WorkspaceRootOwnershipHandle = Readonly<{
  owner: WorkspaceRootOwnership;
  bindCurrentRootIdentity: () => Promise<void>;
  renew: () => Promise<void>;
  release: () => Promise<void>;
}>;
export type WorkspaceRootOwnershipResult = WorkspaceRootOwnershipHandle | Readonly<{ kind: 'overlap'; existing: WorkspaceRootOwnership }>;

const STALE_HEARTBEAT_MS = 5 * 60_000;

type OwnershipRecord = WorkspaceRootOwnership & Readonly<{ v: 1; pid: number; heartbeatAtMs: number }>;
type ActiveOwnership = {
  owner: { -readonly [Key in keyof WorkspaceRootOwnership]: WorkspaceRootOwnership[Key] };
  path: string;
  references: number;
  lost: boolean;
};

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
function parseRecord(value: unknown): OwnershipRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || typeof record.ownerId !== 'string' || !record.ownerId
    || typeof record.canonicalRoot !== 'string' || !record.canonicalRoot
    || !['sync', 'bootstrap', 'handoff'].includes(String(record.operation))
    || !(record.rootFingerprint === null || (typeof record.rootFingerprint === 'string' && /^[a-f0-9]{64}$/u.test(record.rootFingerprint)))
    || !Number.isSafeInteger(record.pid) || Number(record.pid) < 1
    || !Number.isFinite(record.heartbeatAtMs)) return null;
  return record as OwnershipRecord;
}
function defaultIsProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export type WorkspaceRootOwnershipManager = Readonly<{
  tryAcquire(input: WorkspaceRootOwnershipRequest): Promise<WorkspaceRootOwnershipResult>;
}>;

export function createWorkspaceRootOwnershipManager(options: Readonly<{
  lockDirectory: string;
  pid?: number;
  nowMs?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}>): WorkspaceRootOwnershipManager {
  const lockDirectory = resolve(options.lockDirectory);
  const pid = options.pid ?? process.pid;
  const nowMs = options.nowMs ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const inventoryLockPath = join(lockDirectory, '.inventory.lock');
  const activeOwnership = new Set<ActiveOwnership>();
  let serialization: Promise<void> = Promise.resolve();

  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    const prior = serialization;
    let release!: () => void;
    serialization = new Promise<void>((resolveQueue) => { release = resolveQueue; });
    await prior;
    try { return await action(); } finally { release(); }
  };

  const createHandle = (entry: ActiveOwnership): WorkspaceRootOwnershipHandle => {
    let released = false;
    const write = async () => await writeJsonAtomic(entry.path, {
      v: 1,
      ...entry.owner,
      pid,
      heartbeatAtMs: nowMs(),
    } satisfies OwnershipRecord);
    return {
      owner: entry.owner,
      bindCurrentRootIdentity: async () => await exclusive(async () => {
        if (released || entry.lost) {
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        const fingerprint = await computeWorkspaceSyncRootFingerprint(entry.owner.canonicalRoot).catch(() => null);
        if (!fingerprint) {
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        if (entry.owner.rootFingerprint !== null && entry.owner.rootFingerprint !== fingerprint) {
          entry.lost = true;
          activeOwnership.delete(entry);
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        if (entry.owner.rootFingerprint === null) entry.owner.rootFingerprint = fingerprint;
        await write();
      }),
      renew: async () => await exclusive(async () => {
        if (released || entry.lost) {
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        const current = await readFile(entry.path, 'utf8')
          .then((raw) => parseRecord(JSON.parse(raw) as unknown))
          .catch(() => null);
        if (!current || current.ownerId !== entry.owner.ownerId || current.pid !== pid
          || current.canonicalRoot !== entry.owner.canonicalRoot
          || current.rootFingerprint !== entry.owner.rootFingerprint) {
          entry.lost = true;
          activeOwnership.delete(entry);
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        if (entry.owner.rootFingerprint !== null) {
          const fingerprint = await computeWorkspaceSyncRootFingerprint(entry.owner.canonicalRoot).catch(() => null);
          if (fingerprint !== entry.owner.rootFingerprint) {
            entry.lost = true;
            activeOwnership.delete(entry);
            throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
          }
        }
        await write();
      }),
      release: async () => await exclusive(async () => {
        if (released) return;
        released = true;
        entry.references -= 1;
        if (entry.references > 0) return;
        activeOwnership.delete(entry);
        if (entry.lost) return;
        const current = await readFile(entry.path, 'utf8')
          .then((raw) => parseRecord(JSON.parse(raw) as unknown))
          .catch(() => null);
        if (current?.ownerId === entry.owner.ownerId && current.pid === pid
          && current.canonicalRoot === entry.owner.canonicalRoot
          && current.rootFingerprint === entry.owner.rootFingerprint) {
          await unlink(entry.path).catch(() => undefined);
        }
      }),
    };
  };

  return {
    tryAcquire: async (input) => await exclusive(async () => {
      if (!input.ownerId.trim()) throw new Error('workspace root ownership ownerId must be non-empty');
      const canonicalRoot = await resolveCanonicalRoot(input.canonicalRoot);
      const reusable = [...activeOwnership].find((entry) => (
        entry.owner.ownerId === input.ownerId.trim()
        && getPathRemainderWithinBase(entry.owner.canonicalRoot, canonicalRoot) === ''
        && getPathRemainderWithinBase(canonicalRoot, entry.owner.canonicalRoot) === ''
        && !entry.lost
      ));
      if (reusable) {
        const currentFingerprint = await computeWorkspaceSyncRootFingerprint(reusable.owner.canonicalRoot).catch(() => null);
        if (reusable.owner.rootFingerprint !== null && currentFingerprint !== reusable.owner.rootFingerprint) {
          reusable.lost = true;
          activeOwnership.delete(reusable);
          throw Object.assign(new Error('workspace root ownership lost'), { code: 'workspace_root_ownership_lost' });
        }
        if (reusable.owner.rootFingerprint === null && currentFingerprint !== null) {
          reusable.owner.rootFingerprint = currentFingerprint;
          await writeJsonAtomic(reusable.path, {
            v: 1,
            ...reusable.owner,
            pid,
            heartbeatAtMs: nowMs(),
          } satisfies OwnershipRecord);
        }
        reusable.references += 1;
        return createHandle(reusable);
      }
      await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
      return await withJsonOwnerFileLock({
        lockPath: inventoryLockPath,
        timeoutMs: 5_000,
        staleAfterMs: 30_000,
        errorCode: 'workspace_root_ownership_busy',
      }, async () => {
        const names = await readdir(lockDirectory);
        for (const name of names) {
          if (!name.endsWith('.json')) continue;
          const path = join(lockDirectory, name);
          const record = await readFile(path, 'utf8').then((raw) => parseRecord(JSON.parse(raw) as unknown)).catch(() => null);
          // A malformed ownership record is occupied by definition. It must not
          // be guessed stale or removed automatically.
          if (!record) return { kind: 'overlap', existing: { ownerId: 'unknown', canonicalRoot, operation: 'sync', rootFingerprint: null } };
          if (nowMs() - record.heartbeatAtMs > STALE_HEARTBEAT_MS && !isProcessAlive(record.pid)) {
            await unlink(path).catch(() => undefined);
            continue;
          }
          if (overlaps(record.canonicalRoot, canonicalRoot)) {
            return { kind: 'overlap', existing: {
              ownerId: record.ownerId,
              canonicalRoot: record.canonicalRoot,
              operation: record.operation,
              rootFingerprint: record.rootFingerprint,
            } };
          }
        }

        const rootFingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot).catch(() => null);
        const owner = { ...input, ownerId: input.ownerId.trim(), canonicalRoot, rootFingerprint } satisfies WorkspaceRootOwnership;
        const path = recordPath(lockDirectory, canonicalRoot);
        await writeJsonAtomic(path, { v: 1, ...owner, pid, heartbeatAtMs: nowMs() } satisfies OwnershipRecord);
        const active = { owner, path, references: 1, lost: false } satisfies ActiveOwnership;
        activeOwnership.add(active);
        return createHandle(active);
      });
    }),
  };
}
