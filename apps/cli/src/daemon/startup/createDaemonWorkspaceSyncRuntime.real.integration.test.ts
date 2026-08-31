import { AccountSettingsSchema } from '@happier-dev/protocol';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createWorkspaceRootOwnershipManager } from '@/workspaces/sync/workspaceSyncRootOwnership';
import { createWorkspaceSyncPeerIdentityValidator } from '@/workspaces/sync/transport/workspaceSyncPeerIdentity';
import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';
import type {
  WorkspaceSyncPersistentModeV1,
  WorkspaceSyncRelationshipV1,
} from '@/workspaces/sync/workspaceSyncTypes';
import { createDaemonWorkspaceSyncBroker } from './createDaemonWorkspaceSyncBroker';
import { createDaemonWorkspaceSyncRuntime, type DaemonWorkspaceSyncRuntime } from './createDaemonWorkspaceSyncRuntime';
import {
  launchWorkspaceSyncLocalAgent,
  spawnWorkspaceSyncSidecar,
} from './workspaceSyncNativeProcessLaunchers';

const managerPath = process.env.HAPPIER_MUTAGEN_LIVE_MANAGER_BIN;
const agentPath = process.env.HAPPIER_MUTAGEN_LIVE_AGENT_BIN;
const custodyPath = process.env.HAPPIER_PROCESS_CUSTODY_LIVE_BIN;

/**
 * The source-built lane fails closed: when the live lane runs without the
 * three source-built executables the suite must fail, never silently skip.
 */
async function requireLiveBinaries(): Promise<{
  manager: string;
  agent: string;
  custody: string;
}> {
  if (!managerPath || !agentPath || !custodyPath) {
    throw new Error(
      'live binaries must be supplied for the source-built integration lane: set '
      + 'HAPPIER_MUTAGEN_LIVE_MANAGER_BIN, HAPPIER_MUTAGEN_LIVE_AGENT_BIN, and '
      + 'HAPPIER_PROCESS_CUSTODY_LIVE_BIN to freshly built executables',
    );
  }
  const verified = {
    manager: resolve(managerPath),
    agent: resolve(agentPath),
    custody: resolve(custodyPath),
  };
  await Promise.all([
    access(verified.manager),
    access(verified.agent),
    access(verified.custody),
  ]);
  return verified;
}

type ObservedContent = string | null;

async function waitFor(
  path: string,
  predicate: (content: ObservedContent) => boolean,
  description: string,
  deadlineMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let last: ObservedContent = null;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    last = await readFile(path, 'utf8').then(
      (content) => content as ObservedContent,
      (error: unknown) => {
        lastError = error;
        return null;
      },
    );
    if (predicate(last)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(
    `Timed out waiting for ${description} at ${path}; last=${JSON.stringify(last)}`
    + (lastError instanceof Error ? `; lastError=${lastError.message}` : ''),
  );
}

function waitForContents(path: string, expected: string, description = 'synchronized contents'): Promise<void> {
  return waitFor(path, (content) => content === expected, description);
}

function waitForAbsent(path: string, description: string, deadlineMs = 30_000): Promise<void> {
  return waitFor(path, (content) => content === null, description, deadlineMs);
}

/** Bounded negative window: no relationship exists that could still propagate. */
async function assertStillAbsent(path: string, windowMs = 1_500): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await waitForAbsent(path, 'file to stay absent during the finite-copy window', windowMs);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  await expect(access(path)).rejects.toThrow();
}

const contentPolicy = Object.freeze({
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [] as const,
  extraIncludePatterns: [] as const,
  includeGitDirectory: false,
});

function liveRelationship(input: Readonly<{
  relationshipId: string;
  mode: WorkspaceSyncPersistentModeV1;
}>): WorkspaceSyncRelationshipV1 {
  return {
    v: 1,
    relationshipId: input.relationshipId,
    controllerMachineId: 'local-machine',
    alphaWorkspaceRefId: 'alpha-ref',
    betaWorkspaceRefId: 'beta-ref',
    mode: input.mode,
    contentPolicy: {
      ...contentPolicy,
      policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicy),
    },
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

async function startLiveRuntime(input: Readonly<{
  root: string;
  binaries: Readonly<{ manager: string; agent: string; custody: string }>;
  relationship: WorkspaceSyncRelationshipV1 | null;
}>): Promise<DaemonWorkspaceSyncRuntime> {
  const alphaRoot = join(input.root, 'alpha');
  const betaRoot = join(input.root, 'beta');
  const dataRoot = join(input.root, 'daemon');
  await Promise.all([
    mkdir(alphaRoot, { recursive: true }),
    mkdir(betaRoot, { recursive: true }),
  ]);
  const snapshot = {
    source: 'network' as const,
    settings: AccountSettingsSchema.parse(
      input.relationship ? { workspaceSyncRelationshipsV1: [input.relationship] } : {},
    ),
    settingsVersion: 1,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
    scopeKey: input.relationship?.relationshipId ?? 'live-copy-once',
  };
  const workspaceRefs = new Map([
    ['alpha-ref', { machineId: 'local-machine', rootPath: alphaRoot }],
    ['beta-ref', { machineId: 'local-machine', rootPath: betaRoot }],
  ]);
  const rootOwnershipManager = createWorkspaceRootOwnershipManager({
    lockDirectory: join(dataRoot, 'root-ownership'),
  });

  const peerIdentityEvents: string[] = [];
  const runtime = createDaemonWorkspaceSyncRuntime({
    daemonDataRoot: dataRoot,
    localMachineId: 'local-machine',
    releaseChannel: 'publicdev',
    resolveWorkspaceRef: (id) => workspaceRefs.get(id) ?? null,
    rootOwnershipManager,
    // The production target-authority boundary is covered separately; this
    // local two-root harness starts with both authorized roots prepared.
    prepareRelationshipTarget: async () => undefined,
    bootstrap: async () => ({ release: async () => undefined }),
    createBroker: async (brokerInput) => {
      const validator = createWorkspaceSyncPeerIdentityValidator({
        resolveExecutable: () => input.binaries.custody,
      });
      return await createDaemonWorkspaceSyncBroker({
        ...brokerInput,
        peerIdentityValidator: {
          setExpectedSidecarPid: (pid) => {
            peerIdentityEvents.push(`expected:${pid}`);
            validator.setExpectedSidecarPid(pid);
          },
          validate: async (context) => {
            peerIdentityEvents.push(`validate:${context.kind}:${context.sidecarPid ?? 'none'}`);
            const accepted = await validator.validate(context);
            peerIdentityEvents.push(`validated:${context.kind}:${accepted}`);
            return accepted;
          },
        },
      });
    },
    spawnSidecar: spawnWorkspaceSyncSidecar,
    launchLocalAgent: launchWorkspaceSyncLocalAgent,
    getSettingsSnapshot: () => snapshot,
    subscribeSettingsSnapshot: () => () => undefined,
    resolveInstalledComponentPaths: () => ({
      currentPath: input.binaries.manager,
      resolvedCurrentPath: null,
    }),
    resolveArtifactPaths: () => ({
      managerPath: input.binaries.manager,
      agentPath: input.binaries.agent,
    }),
    assertArtifactPayload: () => ({
      engineVersion: 'source-built-live-test',
      protocolEpoch: 'external-stream-v1',
    }),
    resolveDataLayout: () => ({
      rootDir: join(dataRoot, 'mutagen'),
      dataDir: join(dataRoot, 'mutagen', 'data'),
      brokerDir: join(dataRoot, 'mutagen', 'broker'),
      stagingDir: join(dataRoot, 'mutagen', 'staging'),
    }),
  });

  await runtime.start().catch((error: unknown) => {
    throw new Error(`Live workspace sync startup failed; peer identity events=${peerIdentityEvents.join(',')}`, {
      cause: error,
    });
  });
  return runtime;
}

async function withLiveRuntime(
  input: Readonly<{
    binaries: Readonly<{ manager: string; agent: string; custody: string }>;
    relationship: WorkspaceSyncRelationshipV1 | null;
  }>,
  run: (context: Readonly<{
    runtime: DaemonWorkspaceSyncRuntime;
    alphaRoot: string;
    betaRoot: string;
    root: string;
  }>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'happier-workspace-sync-live-'));
  let runtime: DaemonWorkspaceSyncRuntime | null = null;
  try {
    runtime = await startLiveRuntime({ root, binaries: input.binaries, relationship: input.relationship });
    await run({
      runtime,
      root,
      alphaRoot: join(root, 'alpha'),
      betaRoot: join(root, 'beta'),
    });
  } finally {
    await runtime?.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

describe(
  'daemon workspace sync runtime with source-built Mutagen processes',
  { timeout: 150_000 },
  () => {
    it('moves non-empty bytes in both directions through the real manager, authenticated OS broker, controller, and rooted agents', async () => {
      const binaries = await requireLiveBinaries();
      await withLiveRuntime(
        { binaries, relationship: liveRelationship({ relationshipId: 'live-local-byte-path', mode: 'keep_both_in_sync' }) },
        async ({ runtime, alphaRoot, betaRoot }) => {
          await writeFile(join(alphaRoot, 'alpha-to-beta.txt'), 'non-empty alpha payload\n');
          await waitForContents(join(betaRoot, 'alpha-to-beta.txt'), 'non-empty alpha payload\n');

          await writeFile(join(betaRoot, 'beta-to-alpha.txt'), 'non-empty beta payload\n');
          await waitForContents(join(alphaRoot, 'beta-to-alpha.txt'), 'non-empty beta payload\n');

          const status = await runtime.managedWorkspaceSync.get('live-local-byte-path');
          expect(status).toMatchObject({
            relationshipId: 'live-local-byte-path',
            mode: 'keep_both_in_sync',
          });
        },
      );
    });

    it('copy_once materializes alpha bytes on beta, completes the flush, and leaves no persistent relationship or session', async () => {
      const binaries = await requireLiveBinaries();
      await withLiveRuntime(
        { binaries, relationship: null },
        async ({ runtime, alphaRoot, betaRoot }) => {
          await writeFile(join(alphaRoot, 'alpha-to-beta.txt'), 'non-empty copy_once payload\n');

          const status = await runtime.managedWorkspaceSync.copyOnce({
            v: 1,
            operationId: 'live-copy-once-mode',
            controllerMachineId: 'local-machine',
            alphaWorkspaceRefId: 'alpha-ref',
            betaWorkspaceRefId: 'beta-ref',
            contentPolicy: {
              ...contentPolicy,
              policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicy),
            },
          });

          // The observed result names the ephemeral operation and the completed flush.
          expect(status).toMatchObject({
            relationshipId: 'live-copy-once-mode',
            mode: 'copy_once',
          });
          expect(typeof status.lastSuccessfulSyncAtMs).toBe('number');

          // The initial copy reached the target.
          await waitForContents(join(betaRoot, 'alpha-to-beta.txt'), 'non-empty copy_once payload\n');

          // The engine holds no session afterwards: a surviving session would
          // fail this list with relationship_definition_conflict, so an empty
          // list is an engine observation, not a registration check.
          await expect(runtime.managedWorkspaceSync.list()).resolves.toEqual([]);
          await expect(runtime.managedWorkspaceSync.get('live-copy-once-mode')).resolves.toBeNull();

          // The copy is finite: later source changes have no session to ride.
          await writeFile(join(alphaRoot, 'after-copy.txt'), 'written after copy_once completed\n');
          await assertStillAbsent(join(betaRoot, 'after-copy.txt'));
        },
      );
    });

    it('keep_synced (one-way-safe) propagates source changes, preserves non-conflicting target-only files, and propagates non-conflicting source deletion', async () => {
      const binaries = await requireLiveBinaries();
      await withLiveRuntime(
        { binaries, relationship: liveRelationship({ relationshipId: 'live-keep-synced-mode', mode: 'keep_synced' }) },
        async ({ runtime, alphaRoot, betaRoot }) => {
          await writeFile(join(alphaRoot, 'notes.txt'), 'keep_synced v1\n');
          await waitForContents(join(betaRoot, 'notes.txt'), 'keep_synced v1\n');

          // A target-only file appears, then a later source cycle completes;
          // one-way-safe must retain the non-conflicting target-only path.
          await writeFile(join(betaRoot, 'beta-only.txt'), 'target-only content\n');
          await writeFile(join(alphaRoot, 'notes.txt'), 'keep_synced v2\n');
          await waitForContents(join(betaRoot, 'notes.txt'), 'keep_synced v2\n');
          await waitForContents(join(betaRoot, 'beta-only.txt'), 'target-only content\n', 'target-only file to remain');

          // Deleting an unmodified source path propagates to the target.
          await rm(join(alphaRoot, 'notes.txt'));
          await waitForAbsent(join(betaRoot, 'notes.txt'), 'source deletion to propagate');

          const status = await runtime.managedWorkspaceSync.get('live-keep-synced-mode');
          expect(status).toMatchObject({
            relationshipId: 'live-keep-synced-mode',
            mode: 'keep_synced',
          });
        },
      );
    });

    it('mirror_exactly (one-way-replica) removes the explicit target-only file and propagates later source edits and deletion', async () => {
      const binaries = await requireLiveBinaries();
      await withLiveRuntime(
        { binaries, relationship: liveRelationship({ relationshipId: 'live-mirror-exactly-mode', mode: 'mirror_exactly' }) },
        async ({ runtime, alphaRoot, betaRoot }) => {
          await writeFile(join(alphaRoot, 'report.txt'), 'mirror v1\n');
          await waitForContents(join(betaRoot, 'report.txt'), 'mirror v1\n');

          // The destructive half of the mode: an explicit target-only file is
          // removed once a reconciliation cycle completes.
          await writeFile(join(betaRoot, 'target-only.txt'), 'doomed target-only content\n');
          await runtime.managedWorkspaceSync.flush('live-mirror-exactly-mode');
          await waitForAbsent(join(betaRoot, 'target-only.txt'), 'explicit target-only file removal');

          // Later source edits and deletions keep the target an exact replica.
          await writeFile(join(alphaRoot, 'report.txt'), 'mirror v2\n');
          await waitForContents(join(betaRoot, 'report.txt'), 'mirror v2\n');
          await rm(join(alphaRoot, 'report.txt'));
          await waitForAbsent(join(betaRoot, 'report.txt'), 'replica source deletion');

          const status = await runtime.managedWorkspaceSync.get('live-mirror-exactly-mode');
          expect(status).toMatchObject({
            relationshipId: 'live-mirror-exactly-mode',
            mode: 'mirror_exactly',
          });
        },
      );
    });

    it('keep_both_in_sync (two-way-safe) reconciles both directions and surfaces a divergent edit as an explicit conflict', async () => {
      const binaries = await requireLiveBinaries();
      await withLiveRuntime(
        { binaries, relationship: liveRelationship({ relationshipId: 'live-two-way-mode', mode: 'keep_both_in_sync' }) },
        async ({ runtime, alphaRoot, betaRoot }) => {
          await writeFile(join(alphaRoot, 'shared.txt'), 'two-way alpha seed\n');
          await waitForContents(join(betaRoot, 'shared.txt'), 'two-way alpha seed\n');

          await writeFile(join(betaRoot, 'beta-to-alpha.txt'), 'non-empty beta payload\n');
          await waitForContents(join(alphaRoot, 'beta-to-alpha.txt'), 'non-empty beta payload\n');

          // Minimal conflict observation only: divergent edits on both
          // endpoints must be reported by the engine-derived projection.
          // Resolution belongs to the dedicated conflict owner and is not
          // exercised here.
          await writeFile(join(alphaRoot, 'conflicted.txt'), 'alpha divergent edit\n');
          await writeFile(join(betaRoot, 'conflicted.txt'), 'beta divergent edit\n');
          await runtime.managedWorkspaceSync.flush('live-two-way-mode');

          const conflicts = await runtime.managedWorkspaceSync.listConflicts('live-two-way-mode');
          expect(conflicts.totalCount).toBeGreaterThanOrEqual(1);
          expect(conflicts.conflicts.some((entry) => entry.path.includes('conflicted.txt'))).toBe(true);

          const status = await runtime.managedWorkspaceSync.get('live-two-way-mode');
          expect(status).toMatchObject({
            relationshipId: 'live-two-way-mode',
            mode: 'keep_both_in_sync',
          });
          expect(status?.conflictCount).toBeGreaterThanOrEqual(1);
          expect(status?.state).toBe('conflicted');
        },
      );
    });
  },
);
