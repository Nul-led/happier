import {
  AccountSettingsSchema,
  ActionApprovalRequestCreatedResultSchema,
  ApprovalRequestSchema,
  createActionExecutor,
  type ActionExecutorDeps,
  type ApprovalRequest,
  type WorkspaceSyncConflictResolveActionInputV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  MUTAGEN_ENGINE_VERSION,
  assertMutagenEngineArtifactPayload,
  ensureInstalledFirstPartyComponent,
  resolveMutagenEngineArtifactPaths,
  resolveMutagenEngineArtifactTarget,
} from '@happier-dev/cli-common/firstPartyRuntime';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { deleteWorkspaceSyncConflictLoserAtRoot } from '@/workspaces/sync/workspaceSyncConflicts';
import {
  registerMachineWorkspaceSyncRpcHandlers,
  type MachineWorkspaceSyncRpcService,
} from '@/api/machine/rpcHandlers.workspaceSync';
import type { RpcHandler, RpcHandlerContext, RpcHandlerRegistrar } from '@/api/rpc/types';
import { createWorkspaceRootOwnershipManager } from '@/workspaces/sync/workspaceSyncRootOwnership';
import type { WorkspaceSyncSidecarProcess } from '@/workspaces/sync/workspaceSyncSidecarLifecycle';
import { createWorkspaceSyncPeerIdentityValidator } from '@/workspaces/sync/transport/workspaceSyncPeerIdentity';
import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';
import { createWorkspaceSyncConflictResolutionAuthorizer } from './createProductionDaemonWorkspaceSyncRuntime';
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
const runInstalledArtifactIntegration = process.env.HAPPIER_RUN_MUTAGEN_INSTALLED_ARTIFACT_INTEGRATION === '1';
const runPerformanceAcceptance = process.env.HAPPIER_RUN_WORKSPACE_SYNC_PERFORMANCE === '1';
const performanceFileSizeBytes = Number.parseInt(
  process.env.HAPPIER_WORKSPACE_SYNC_PERFORMANCE_FILE_BYTES ?? String(1024 ** 3),
  10,
);
const performanceDeltaBytes = 4 * 1024;

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

async function writeDeterministicFile(path: string, sizeBytes: number): Promise<void> {
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  for (let index = 0; index < chunk.length; index += 1) chunk[index] = index % 251;
  const handle = await open(path, 'w');
  try {
    let offset = 0;
    while (offset < sizeBytes) {
      const length = Math.min(chunk.length, sizeBytes - offset);
      await handle.write(chunk, 0, length, offset);
      offset += length;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function applyDeterministicDelta(
  path: string,
  sizeBytes: number,
): Promise<Readonly<{ offset: number; bytes: Buffer }>> {
  const delta = Buffer.alloc(performanceDeltaBytes, 0xa7);
  const offset = Math.max(0, Math.floor(sizeBytes / 2) - Math.floor(delta.length / 2));
  const handle = await open(path, 'r+');
  try {
    await handle.write(delta, 0, delta.length, offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { offset, bytes: delta };
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolveDigest, rejectDigest) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', resolveDigest);
    stream.once('error', rejectDigest);
  });
  return hash.digest('hex');
}

async function waitForFileDigest(
  path: string,
  expectedSizeBytes: number,
  expectedDigest: string,
  description: string,
  deadlineMs = 20 * 60_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastSize = -1;
  let lastDigest = '';
  while (Date.now() < deadline) {
    const metadata = await stat(path).catch(() => null);
    lastSize = metadata?.size ?? -1;
    if (lastSize === expectedSizeBytes) {
      lastDigest = await digestFile(path);
      if (lastDigest === expectedDigest) return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${description}; size=${lastSize}; digest=${lastDigest}`);
}

async function waitForFileRegion(
  path: string,
  offset: number,
  expected: Buffer,
  description: string,
  deadlineMs = 20 * 60_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  const observed = Buffer.alloc(expected.length);
  while (Date.now() < deadline) {
    const handle = await open(path, 'r').catch(() => null);
    if (handle) {
      try {
        const { bytesRead } = await handle.read(observed, 0, observed.length, offset);
        if (bytesRead === expected.length && observed.equals(expected)) return;
      } finally {
        await handle.close();
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function recordPerformanceMeasurement(measurement: Readonly<Record<string, string | number>>): void {
  console.info(`[workspace-sync-performance] ${JSON.stringify(measurement)}`);
}

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

async function acquireInstalledArtifactBinaries(homeDir: string): Promise<Readonly<{
  manager: string;
  agent: string;
  custody: string;
  targetTriple: string;
}>> {
  if (!custodyPath) {
    throw new Error(
      `installed Mutagen ${MUTAGEN_ENGINE_VERSION} integration requires HAPPIER_PROCESS_CUSTODY_LIVE_BIN`,
    );
  }
  const custody = resolve(custodyPath);
  await access(custody);
  const targetTriple = resolveMutagenEngineArtifactTarget();
  const processEnv = { ...process.env, HAPPIER_HOME_DIR: homeDir };
  const validatePayload = (payloadRoot: string) => assertMutagenEngineArtifactPayload({
    payloadRoot,
    targetTriple,
    engineVersion: MUTAGEN_ENGINE_VERSION,
  });
  const installed = await ensureInstalledFirstPartyComponent({
    componentId: 'mutagen-engine',
    channel: 'stable',
    versionId: MUTAGEN_ENGINE_VERSION,
    processEnv,
    validatePayload,
  });
  const payloadRoot = installed.resolvedCurrentPath ?? installed.currentPath;
  validatePayload(payloadRoot);
  const artifactPaths = resolveMutagenEngineArtifactPaths(payloadRoot, targetTriple);
  await Promise.all([access(artifactPaths.managerPath), access(artifactPaths.agentPath)]);
  return {
    manager: artifactPaths.managerPath,
    agent: artifactPaths.agentPath,
    custody,
    targetTriple,
  };
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

type LiveConflictApprovalAuthority = Readonly<{
  assertAuthorized: ReturnType<typeof createWorkspaceSyncConflictResolutionAuthorizer>;
  approvalsCreate: NonNullable<ActionExecutorDeps['approvalsCreate']>;
  approvalsGet: NonNullable<ActionExecutorDeps['approvalsGet']>;
  approvalsUpdate: NonNullable<ActionExecutorDeps['approvalsUpdate']>;
}>;

function createLiveConflictApprovalAuthority(artifactDirectory: string): LiveConflictApprovalAuthority {
  let nextArtifactId = 1;
  const artifactPath = (artifactId: string): string => {
    if (!/^[A-Za-z0-9._-]+$/.test(artifactId)) throw new Error('Invalid live approval artifact id');
    return join(artifactDirectory, `${artifactId}.json`);
  };
  const approvalsGet: NonNullable<ActionExecutorDeps['approvalsGet']> = async ({ artifactId }) => {
    try {
      const raw = await readFile(artifactPath(artifactId), 'utf8');
      return ApprovalRequestSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  };
  const persist = async (artifactId: string, request: ApprovalRequest): Promise<void> => {
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath(artifactId), `${JSON.stringify(ApprovalRequestSchema.parse(request))}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  };
  const authority: LiveConflictApprovalAuthority = {
    approvalsCreate: async ({ request }) => {
      const artifactId = `live-conflict-approval-${nextArtifactId++}`;
      await persist(artifactId, request);
      return { artifactId };
    },
    approvalsGet,
    approvalsUpdate: async ({ artifactId, request }) => {
      await persist(artifactId, request);
      return { ok: true };
    },
    assertAuthorized: createWorkspaceSyncConflictResolutionAuthorizer({
      approvalsGet,
      serverId: 'server-1',
    }),
  };
  return authority;
}

describe('workspace sync conflict Action persistence fixture', () => {
  it('reopens the approved receipt from disk at the destructive execution boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hwsa-'));
    const artifactDirectory = join(root, 'approval-artifacts');
    const authority = createLiveConflictApprovalAuthority(artifactDirectory);
    const actionInput: WorkspaceSyncConflictResolveActionInputV1 = {
      controllerMachineId: 'local-machine',
      request: {
        relationshipId: 'relationship-1',
        path: 'conflicted.txt',
        keep: 'alpha',
        expectedKind: 'file',
        expectedDigest: 'a'.repeat(40),
      },
    };
    let executedReceiptId: string | null = null;
    try {
      const workspaceSyncConflictResolve: NonNullable<
        ActionExecutorDeps['workspaceSyncConflictResolve']
      > = async ({ actionReceiptId, input }) => {
        const reopenedAuthority = createLiveConflictApprovalAuthority(artifactDirectory);
        await reopenedAuthority.assertAuthorized(actionReceiptId, input);
        executedReceiptId = actionReceiptId;
        return {
          relationshipId: input.request.relationshipId,
          controllerMachineId: input.controllerMachineId,
          state: 'watching' as const,
          alphaPath: '/alpha',
          betaPath: '/beta',
          mode: 'keep_both_in_sync' as const,
          changedFiles: 0,
          conflictCount: 0,
          lastSuccessfulSyncAtMs: 1,
        };
      };
      const executor = createActionExecutor({
        workspaceSyncConflictResolve,
        isActionApprovalRequired: () => false,
        approvalsCreate: authority.approvalsCreate,
        approvalsGet: authority.approvalsGet,
        approvalsUpdate: authority.approvalsUpdate,
        isApprovalExecutionOriginCurrent: async () => true,
      } as unknown as ActionExecutorDeps);

      const requested = await executor.execute('workspace.sync.conflict.resolve', actionInput, {
        surface: 'ui',
        authority: 'present_user',
        serverId: 'server-1',
        defaultSessionMachineId: actionInput.controllerMachineId,
        actionRequestId: 'persisted-conflict-request',
      });
      const approvalRequest = requested.ok
        ? ActionApprovalRequestCreatedResultSchema.safeParse(requested.result)
        : null;
      expect(approvalRequest?.success).toBe(true);
      if (!approvalRequest?.success) throw new Error('Workspace conflict Action did not request approval');

      const decided = await executor.execute('approval.request.decide', {
        artifactId: approvalRequest.data.artifactId,
        decision: 'approve',
      }, {
        surface: 'ui',
        authority: 'present_user',
        serverId: 'server-1',
      });
      expect(decided).toMatchObject({
        ok: true,
        result: { ok: true, status: 'executed', execution: { ok: true } },
      });
      expect(executedReceiptId).toBe(approvalRequest.data.artifactId);
      await expect(authority.approvalsGet({
        artifactId: approvalRequest.data.artifactId,
        serverId: 'server-1',
      })).resolves.toMatchObject({ status: 'executed', execution: { ok: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function resolveConflictThroughApprovedAction(
  runtime: DaemonWorkspaceSyncRuntime,
  approvalAuthority: LiveConflictApprovalAuthority,
  actionInput: WorkspaceSyncConflictResolveActionInputV1,
): Promise<void> {
  const handlers = new Map<string, (raw: unknown, context?: RpcHandlerContext) => Promise<unknown>>();
  const rpcHandlerManager = {
    registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
      handlers.set(method, async (raw, context) => await handler(raw as TRequest, context));
    },
  } satisfies RpcHandlerRegistrar;
  const unavailableTargetOperation = async (): Promise<never> => {
    throw new Error('Unexpected target operation in local conflict Action test');
  };
  const service: MachineWorkspaceSyncRpcService = {
    controller: runtime.managedWorkspaceSync,
    relationshipOwner: {
      setEnabled: async () => undefined,
      stop: async () => undefined,
    },
    deleteConflictLoserAtTarget: unavailableTargetOperation,
    readFileAtTarget: unavailableTargetOperation,
    preflightHandoffTargetReplacement: unavailableTargetOperation,
    prepareBootstrapAtTarget: unavailableTargetOperation,
    releaseBootstrapAtTarget: unavailableTargetOperation,
    inspectRetiredState: async () => ({ status: 'absent' }),
    assertConflictResolutionAuthorized: approvalAuthority.assertAuthorized,
  };
  registerMachineWorkspaceSyncRpcHandlers({ rpcHandlerManager, service });
  const conflictDelete = handlers.get(RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICT_DELETE);
  if (!conflictDelete) throw new Error('Workspace conflict deletion RPC was not registered');

  const executor = createActionExecutor({
    workspaceSyncConflictResolve: async ({ actionReceiptId, input }: Parameters<NonNullable<ActionExecutorDeps['workspaceSyncConflictResolve']>>[0]) => await conflictDelete({
      actionReceiptId,
      actionInput: input,
    }) as Awaited<ReturnType<DaemonWorkspaceSyncRuntime['managedWorkspaceSync']['flush']>>,
    isActionApprovalRequired: () => false,
    approvalsCreate: approvalAuthority.approvalsCreate,
    approvalsGet: approvalAuthority.approvalsGet,
    approvalsUpdate: approvalAuthority.approvalsUpdate,
    isApprovalExecutionOriginCurrent: async () => true,
  } as unknown as ActionExecutorDeps);

  const requested = await executor.execute('workspace.sync.conflict.resolve', actionInput, {
    surface: 'ui',
    authority: 'present_user',
    serverId: 'server-1',
    defaultSessionMachineId: actionInput.controllerMachineId,
    actionRequestId: 'live-conflict-request',
  });
  const approvalRequest = requested.ok
    ? ActionApprovalRequestCreatedResultSchema.safeParse(requested.result)
    : null;
  if (!approvalRequest?.success) {
    throw new Error(`Workspace conflict Action did not request approval: ${JSON.stringify(requested)}`);
  }
  const decided = await executor.execute('approval.request.decide', {
    artifactId: approvalRequest.data.artifactId,
    decision: 'approve',
  }, {
    surface: 'ui',
    authority: 'present_user',
    serverId: 'server-1',
  });
  const decision = decided.ok && decided.result !== null && typeof decided.result === 'object'
    ? decided.result as Record<string, unknown>
    : null;
  if (!decision || decision.ok !== true || decision.status !== 'executed') {
    throw new Error(`Workspace conflict Action approval did not execute: ${JSON.stringify(decided)}`);
  }
}

async function startLiveRuntime(input: Readonly<{
  root: string;
  binaries: Readonly<{ manager: string; agent: string; custody: string }>;
  relationship: WorkspaceSyncRelationshipV1 | null;
  conflictApprovalAuthority?: LiveConflictApprovalAuthority;
  onSidecarSpawned?: (process: WorkspaceSyncSidecarProcess) => void | Promise<void>;
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
      input.relationship
        ? {
            workspaceRefsV1: [
              {
                id: 'alpha-ref',
                serverId: 'server-1',
                machineId: 'local-machine',
                rootPath: alphaRoot,
                createdAtMs: 1,
              },
              {
                id: 'beta-ref',
                serverId: 'server-1',
                machineId: 'local-machine',
                rootPath: betaRoot,
                createdAtMs: 1,
              },
            ],
            workspaceSyncRelationshipsV1: [input.relationship],
          }
        : {},
    ),
    settingsVersion: 1,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
    scopeKey: input.relationship?.relationshipId ?? 'live-copy-once',
  };
  const workspaceRefs = new Map([
    ['alpha-ref', { serverId: 'server-1', machineId: 'local-machine', rootPath: alphaRoot }],
    ['beta-ref', { serverId: 'server-1', machineId: 'local-machine', rootPath: betaRoot }],
  ]);
  const rootOwnershipManager = createWorkspaceRootOwnershipManager({
    lockDirectory: join(dataRoot, 'root-ownership'),
  });
  const conflictApprovalAuthority = input.conflictApprovalAuthority
    ?? createLiveConflictApprovalAuthority(join(dataRoot, 'approval-artifacts'));

  const peerIdentityEvents: string[] = [];
  const runtime = createDaemonWorkspaceSyncRuntime({
    daemonDataRoot: dataRoot,
    localServerId: 'server-1',
    localMachineId: 'local-machine',
    releaseChannel: 'publicdev',
    resolveWorkspaceRef: (id) => workspaceRefs.get(id) ?? null,
    rootOwnershipManager,
    // The production target-authority boundary is covered separately; this
    // local two-root harness starts with both authorized roots prepared.
    prepareRelationshipTarget: async () => undefined,
    bootstrap: async () => ({ release: async () => undefined }),
    deleteConflictLoserAtTarget: async (request) => {
      const target = workspaceRefs.get(request.targetWorkspaceRefId);
      if (!target || target.machineId !== request.targetMachineId) {
        throw Object.assign(new Error('Workspace sync conflict target is unavailable'), { code: 'peer_unavailable' });
      }
      // Model the receiving daemon's final authorization check immediately
      // before its confined mutation, using the same production authorizer.
      await conflictApprovalAuthority.assertAuthorized(request.actionReceiptId, request.actionInput);
      await deleteWorkspaceSyncConflictLoserAtRoot({
        rootPath: target.rootPath,
        relativePath: request.path,
        expectedKind: request.expectedKind,
        ...(request.expectedDigest === undefined ? {} : { expectedDigest: request.expectedDigest }),
      });
    },
    assertConflictResolutionAuthorized: conflictApprovalAuthority.assertAuthorized,
    createBroker: async (brokerInput) => {
      const validator = createWorkspaceSyncPeerIdentityValidator({
        resolveExecutable: () => input.binaries.custody,
      });
      return await createDaemonWorkspaceSyncBroker({
        ...brokerInput,
        openExternalStream: async (context) => await brokerInput.openExternalStream(context).catch((error: unknown) => {
          peerIdentityEvents.push(`open:${error instanceof Error ? error.message : String(error)}:${typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'untyped'}`);
          throw error;
        }),
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
    spawnSidecar: async (request) => {
      const process = await spawnWorkspaceSyncSidecar(request);
      await input.onSidecarSpawned?.(process);
      return process;
    },
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
    prepareRoots?: (roots: Readonly<{ alphaRoot: string; betaRoot: string }>) => Promise<void>;
  }>,
  run: (context: Readonly<{
    runtime: DaemonWorkspaceSyncRuntime;
    alphaRoot: string;
    betaRoot: string;
    root: string;
    conflictApprovalAuthority: LiveConflictApprovalAuthority;
  }>) => Promise<void>,
): Promise<void> {
  // The per-stream broker endpoint also appends a UUID; keep the canonical
  // fixture root below macOS's Unix-domain socket path limit.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hwsl-')));
  let runtime: DaemonWorkspaceSyncRuntime | null = null;
  try {
    const alphaRoot = join(root, 'alpha');
    const betaRoot = join(root, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    await input.prepareRoots?.({ alphaRoot, betaRoot });
    const conflictApprovalAuthority = createLiveConflictApprovalAuthority(join(root, 'approval-artifacts'));
    runtime = await startLiveRuntime({
      root,
      binaries: input.binaries,
      relationship: input.relationship,
      conflictApprovalAuthority,
    });
    await run({
      runtime,
      root,
      alphaRoot,
      betaRoot,
      conflictApprovalAuthority,
    });
  } finally {
    await runtime?.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

describe.skipIf(runInstalledArtifactIntegration)(
  'daemon workspace sync runtime with source-built Mutagen processes',
  { timeout: 150_000 },
  () => {
    it.skipIf(!runPerformanceAcceptance)(
      'records a verified large initial local copy and 4 KiB delta through the real managed process corridor',
      async () => {
        if (!Number.isSafeInteger(performanceFileSizeBytes) || performanceFileSizeBytes < performanceDeltaBytes) {
          throw new Error(`Invalid HAPPIER_WORKSPACE_SYNC_PERFORMANCE_FILE_BYTES=${performanceFileSizeBytes}`);
        }
        const binaries = await requireLiveBinaries();
        let initialWriteMs = 0;
        let initialCopyStartedAt = 0n;
        let initialDigest = '';
        await withLiveRuntime(
          {
            binaries,
            relationship: liveRelationship({ relationshipId: 'live-local-performance', mode: 'keep_synced' }),
            prepareRoots: async ({ alphaRoot }) => {
              const initialWriteStartedAt = process.hrtime.bigint();
              await writeDeterministicFile(join(alphaRoot, 'performance.bin'), performanceFileSizeBytes);
              initialWriteMs = elapsedMs(initialWriteStartedAt);
              initialDigest = await digestFile(join(alphaRoot, 'performance.bin'));
              initialCopyStartedAt = process.hrtime.bigint();
            },
          },
          async ({ alphaRoot, betaRoot }) => {
            const sourcePath = join(alphaRoot, 'performance.bin');
            const targetPath = join(betaRoot, 'performance.bin');
            await waitForFileDigest(targetPath, performanceFileSizeBytes, initialDigest, 'local initial performance copy');
            const initialCopyMs = elapsedMs(initialCopyStartedAt);

            const deltaStartedAt = process.hrtime.bigint();
            const delta = await applyDeterministicDelta(sourcePath, performanceFileSizeBytes);
            await waitForFileRegion(targetPath, delta.offset, delta.bytes, 'local 4 KiB delta region');
            const deltaMs = elapsedMs(deltaStartedAt);
            const deltaDigest = await digestFile(sourcePath);
            await waitForFileDigest(targetPath, performanceFileSizeBytes, deltaDigest, 'local 4 KiB delta');

            recordPerformanceMeasurement({
              topology: 'local',
              fileBytes: performanceFileSizeBytes,
              deltaBytes: performanceDeltaBytes,
              initialWriteMs,
              initialCopyMs,
              deltaMs,
            });
          },
        );
      },
      30 * 60_000,
    );

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

    it('keep_both_in_sync (two-way-safe) reconciles both directions and resolves a divergent edit through the conflict owner', async () => {
      const binaries = await requireLiveBinaries();
      await withLiveRuntime(
        { binaries, relationship: liveRelationship({ relationshipId: 'live-two-way-mode', mode: 'keep_both_in_sync' }) },
        async ({ runtime, alphaRoot, betaRoot, conflictApprovalAuthority }) => {
          await writeFile(join(alphaRoot, 'shared.txt'), 'two-way alpha seed\n');
          await waitForContents(join(betaRoot, 'shared.txt'), 'two-way alpha seed\n');

          await writeFile(join(betaRoot, 'beta-to-alpha.txt'), 'non-empty beta payload\n');
          await waitForContents(join(alphaRoot, 'beta-to-alpha.txt'), 'non-empty beta payload\n');

          // Divergent edits must be reported by the engine-derived projection,
          // then resolved through the same controller and guarded filesystem
          // mutation owner used below the authenticated target authority.
          await writeFile(join(alphaRoot, 'conflicted.txt'), 'alpha divergent edit\n');
          await writeFile(join(betaRoot, 'conflicted.txt'), 'beta divergent edit\n');
          await runtime.managedWorkspaceSync.flush('live-two-way-mode');

          const conflicts = await runtime.managedWorkspaceSync.listConflicts({
            relationshipId: 'live-two-way-mode',
            limit: 100,
          });
          expect(conflicts.status).toBe('page');
          if (conflicts.status !== 'page') throw new Error('conflict cursor invalidated on initial page');
          expect(conflicts.totalCount).toBeGreaterThanOrEqual(1);
          expect(conflicts.conflicts.some((entry) => entry.path.includes('conflicted.txt'))).toBe(true);

          const status = await runtime.managedWorkspaceSync.get('live-two-way-mode');
          expect(status).toMatchObject({
            relationshipId: 'live-two-way-mode',
            mode: 'keep_both_in_sync',
          });
          expect(status?.conflictCount).toBeGreaterThanOrEqual(1);
          expect(status?.state).toBe('conflicted');

          const conflict = conflicts.conflicts.find((entry) => entry.path.includes('conflicted.txt'))!;
          if (conflict.beta.kind === 'unsupported') {
            throw new Error('regular-file conflict unexpectedly reported as unsupported');
          }
          await resolveConflictThroughApprovedAction(runtime, conflictApprovalAuthority, {
            controllerMachineId: 'local-machine',
            request: {
              relationshipId: 'live-two-way-mode',
              path: conflict.path,
              keep: 'alpha',
              expectedKind: conflict.beta.kind,
              ...(conflict.beta.digest === undefined ? {} : { expectedDigest: conflict.beta.digest }),
            },
          });
          await waitForContents(join(betaRoot, 'conflicted.txt'), 'alpha divergent edit\n', 'resolved alpha conflict');

          const resolvedConflicts = await runtime.managedWorkspaceSync.listConflicts({
            relationshipId: 'live-two-way-mode',
            limit: 100,
          });
          if (resolvedConflicts.status !== 'page') throw new Error('conflict cursor invalidated on initial page');
          expect(resolvedConflicts.conflicts.some((entry) => entry.path.includes('conflicted.txt'))).toBe(false);

          // Exercise the opposite direction through the same public Action.
          // Keeping beta deletes the controller-local alpha loser, so the
          // controller itself must consume the approval receipt authority
          // rather than relying only on the registered target RPC service.
          await writeFile(join(alphaRoot, 'conflicted-beta.txt'), 'alpha losing edit\n');
          await writeFile(join(betaRoot, 'conflicted-beta.txt'), 'beta winning edit\n');
          await runtime.managedWorkspaceSync.flush('live-two-way-mode');

          const betaWinningConflicts = await runtime.managedWorkspaceSync.listConflicts({
            relationshipId: 'live-two-way-mode',
            limit: 100,
          });
          if (betaWinningConflicts.status !== 'page') throw new Error('conflict cursor invalidated on beta-winning page');
          const betaWinningConflict = betaWinningConflicts.conflicts.find((entry) => entry.path.includes('conflicted-beta.txt'));
          expect(betaWinningConflict).toBeDefined();
          if (!betaWinningConflict || betaWinningConflict.alpha.kind === 'unsupported') {
            throw new Error('regular-file conflict unexpectedly reported as unsupported');
          }
          await resolveConflictThroughApprovedAction(runtime, conflictApprovalAuthority, {
            controllerMachineId: 'local-machine',
            request: {
              relationshipId: 'live-two-way-mode',
              path: betaWinningConflict.path,
              keep: 'beta',
              expectedKind: betaWinningConflict.alpha.kind,
              ...(betaWinningConflict.alpha.digest === undefined ? {} : { expectedDigest: betaWinningConflict.alpha.digest }),
            },
          });
          await waitForContents(join(alphaRoot, 'conflicted-beta.txt'), 'beta winning edit\n', 'resolved beta conflict');

          const betaResolvedConflicts = await runtime.managedWorkspaceSync.listConflicts({
            relationshipId: 'live-two-way-mode',
            limit: 100,
          });
          if (betaResolvedConflicts.status !== 'page') throw new Error('conflict cursor invalidated after beta resolution');
          expect(betaResolvedConflicts.conflicts.some((entry) => entry.path.includes('conflicted-beta.txt'))).toBe(false);
        },
      );
    });

    it('rehydrates the persisted relationship after a full daemon runtime restart without creating another session', async () => {
      const binaries = await requireLiveBinaries();
      const root = await realpath(await mkdtemp(join(tmpdir(), 'hwsl-')));
      const relationship = liveRelationship({ relationshipId: 'live-restart-rehydrate', mode: 'keep_both_in_sync' });
      let runtime: DaemonWorkspaceSyncRuntime | null = null;
      try {
        const alphaRoot = join(root, 'alpha');
        const betaRoot = join(root, 'beta');
        await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);

        runtime = await startLiveRuntime({ root, binaries, relationship });
        await writeFile(join(alphaRoot, 'before-restart.txt'), 'persisted before restart\n');
        await waitForContents(join(betaRoot, 'before-restart.txt'), 'persisted before restart\n');
        await runtime.stop();
        runtime = null;

        runtime = await startLiveRuntime({ root, binaries, relationship });
        const relationships = await runtime.managedWorkspaceSync.list();
        expect(relationships).toHaveLength(1);
        expect(relationships[0]).toMatchObject({
          relationshipId: 'live-restart-rehydrate',
          mode: 'keep_both_in_sync',
        });

        await writeFile(join(betaRoot, 'after-restart.txt'), 'persisted after restart\n');
        await waitForContents(join(alphaRoot, 'after-restart.txt'), 'persisted after restart\n');
      } finally {
        await runtime?.stop().catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    });

    it('reconciles the persisted relationship after an unexpected real sidecar termination', async () => {
      const binaries = await requireLiveBinaries();
      const root = await realpath(await mkdtemp(join(tmpdir(), 'hwsl-')));
      const relationship = liveRelationship({ relationshipId: 'live-sidecar-restart', mode: 'keep_both_in_sync' });
      const spawned: WorkspaceSyncSidecarProcess[] = [];
      let runtime: DaemonWorkspaceSyncRuntime | null = null;
      try {
        const alphaRoot = join(root, 'alpha');
        const betaRoot = join(root, 'beta');
        await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
        runtime = await startLiveRuntime({
          root,
          binaries,
          relationship,
          onSidecarSpawned: (process) => {
            spawned.push(process);
          },
        });

        await writeFile(join(alphaRoot, 'before-sidecar-restart.txt'), 'before sidecar restart\n');
        await waitForContents(join(betaRoot, 'before-sidecar-restart.txt'), 'before sidecar restart\n');
        expect(spawned).toHaveLength(1);

        await spawned[0]!.stop();
        const deadline = Date.now() + 20_000;
        while (spawned.length < 2 && Date.now() < deadline) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
        }
        expect(spawned.length).toBeGreaterThanOrEqual(2);

        await expect(runtime.managedWorkspaceSync.list()).resolves.toEqual([
          expect.objectContaining({
            relationshipId: 'live-sidecar-restart',
            mode: 'keep_both_in_sync',
          }),
        ]);
        await writeFile(join(betaRoot, 'after-sidecar-restart.txt'), 'after sidecar restart\n');
        await waitForContents(join(alphaRoot, 'after-sidecar-restart.txt'), 'after sidecar restart\n');
      } finally {
        await runtime?.stop().catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    });

  },
);

describe.skipIf(!runInstalledArtifactIntegration)(
  `daemon workspace sync runtime with acquired Mutagen ${MUTAGEN_ENGINE_VERSION}`,
  { timeout: 10 * 60_000 },
  () => {
    it('uses the validated installed manager and rooted agent for authenticated LIST and non-empty bidirectional bytes', async () => {
      const installedHome = await realpath(await mkdtemp(join(tmpdir(), 'happier-mutagen-installed-real-')));
      try {
        const binaries = await acquireInstalledArtifactBinaries(installedHome);
        await withLiveRuntime(
          {
            binaries,
            relationship: liveRelationship({
              relationshipId: 'live-installed-artifact-byte-path',
              mode: 'keep_both_in_sync',
            }),
          },
          async ({ runtime, alphaRoot, betaRoot }) => {
            await expect(runtime.managedWorkspaceSync.list()).resolves.toEqual([
              expect.objectContaining({
                relationshipId: 'live-installed-artifact-byte-path',
                mode: 'keep_both_in_sync',
              }),
            ]);

            await writeFile(join(alphaRoot, 'installed-alpha-to-beta.txt'), 'installed alpha payload\n');
            await waitForContents(
              join(betaRoot, 'installed-alpha-to-beta.txt'),
              'installed alpha payload\n',
              'installed artifact alpha-to-beta bytes',
            );

            await writeFile(join(betaRoot, 'installed-beta-to-alpha.txt'), 'installed beta payload\n');
            await waitForContents(
              join(alphaRoot, 'installed-beta-to-alpha.txt'),
              'installed beta payload\n',
              'installed artifact beta-to-alpha bytes',
            );
          },
        );
      } catch (error) {
        const target = (() => {
          try {
            return resolveMutagenEngineArtifactTarget();
          } catch {
            return `${process.platform}-${process.arch}`;
          }
        })();
        throw new Error(
          `Installed Mutagen ${MUTAGEN_ENGINE_VERSION} (${target}) failed the authenticated manager/rooted-agent byte corridor`,
          { cause: error },
        );
      } finally {
        await rm(installedHome, { recursive: true, force: true });
      }
    });
  },
);
