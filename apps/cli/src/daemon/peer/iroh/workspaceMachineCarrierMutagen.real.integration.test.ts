import {
  AccountSettingsSchema,
  computeWorkspaceSyncPolicyDigest,
  createDirectRouteGrantSigningInputV2,
  WorkspaceSyncTargetBootstrapPrepareV1Schema,
  WorkspaceSyncTargetBootstrapReleaseV1Schema,
  type AccountSettingsMutationResult,
  type DirectRouteGrantRequestV2,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createIrohNodeNativeModule, loadIrohNodeNativeAddon } from '@happier-dev/iroh-native/node';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import tweetnacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';

import {
  createDaemonWorkspaceSyncRuntime,
} from '@/daemon/startup/createDaemonWorkspaceSyncRuntime';
import {
  createProductionDaemonWorkspaceSyncRuntime,
  type ProductionDaemonWorkspaceSyncFactories,
  type ProductionDaemonWorkspaceSyncRuntime,
} from '@/daemon/startup/createProductionDaemonWorkspaceSyncRuntime';
import { createTrackedSessionHandoffCoordinator } from '@/daemon/actionOperations/createTrackedSessionHandoffCoordinator';
import {
  launchWorkspaceSyncLocalAgent,
  spawnWorkspaceSyncSidecar,
} from '@/daemon/startup/workspaceSyncNativeProcessLaunchers';
import type { ActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { createWorkspaceRootOwnershipManager } from '@/workspaces/sync/workspaceSyncRootOwnership';
import { createWorkspaceSyncTargetAuthority } from '@/workspaces/sync/workspaceSyncTargetAuthority';
import { createWorkspaceSyncPeerIdentityValidator } from '@/workspaces/sync/transport/workspaceSyncPeerIdentity';
import { createWorkspaceSyncRelationshipOwner } from '@/workspaces/sync/workspaceSyncRelationshipOwner';
import { startPeerMediationLoopbackServer } from '../mediation/loopback/server';
import { createDaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';
import { createWorkspaceMachineCarrierTunnelOpen } from './workspaceMachineCarrierTunnelOpen';

const accountId = 'account-mutagen-machine-composed';
const sourceMachineId = 'machine-mutagen-source';
const targetMachineId = 'machine-mutagen-target';
const relationshipId = 'relationship-mutagen-machine-composed';
const sourceWorkspaceRefId = 'workspace-mutagen-source';
const targetWorkspaceRefId = 'workspace-mutagen-target';
const nowMs = 2_000;
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

type NativeIrohTestController = Readonly<{
  forceDirectOnly(): Promise<string>;
  forceRelayOnly(): Promise<string>;
  restoreAutomatic(): Promise<string>;
  getObservedPath(): 'direct' | 'relay' | 'unknown';
}>;

type LiveBinaries = Readonly<{
  manager: string;
  agent: string;
  custody: string;
}>;

function requireSuccessfulTestControllerOperation(raw: string): void {
  const envelope = JSON.parse(raw) as { ok?: unknown; error?: { message?: unknown } };
  if (envelope.ok !== true) {
    throw new Error(
      typeof envelope.error?.message === 'string'
        ? envelope.error.message
        : 'Iroh native test controller operation failed',
    );
  }
}

async function setTestTopology(
  controller: NativeIrohTestController,
  topology: 'direct' | 'relay',
): Promise<void> {
  requireSuccessfulTestControllerOperation(
    topology === 'direct'
      ? await controller.forceDirectOnly()
      : await controller.forceRelayOnly(),
  );
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function requireLiveBinaries(): Promise<LiveBinaries> {
  const values = {
    manager: process.env.HAPPIER_MUTAGEN_LIVE_MANAGER_BIN,
    agent: process.env.HAPPIER_MUTAGEN_LIVE_AGENT_BIN,
    custody: process.env.HAPPIER_PROCESS_CUSTODY_LIVE_BIN,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`The composed Mutagen/Iroh fixture requires source-built binaries; missing ${missing.join(', ')}`);
  }
  const binaries = {
    manager: resolve(values.manager!),
    agent: resolve(values.agent!),
    custody: resolve(values.custody!),
  };
  await Promise.all(Object.values(binaries).map(async (path) => await access(path)));
  return binaries;
}

const contentPolicyInput = Object.freeze({
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [] as const,
  extraIncludePatterns: [] as const,
  includeGitDirectory: false,
});

function settingsSnapshot(
  settings: ActiveAccountSettingsSnapshot['settings'],
  settingsVersion: number,
): ActiveAccountSettingsSnapshot {
  return {
    source: 'network',
    settings,
    settingsVersion,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
    scopeKey: relationshipId,
  };
}

function createGrantMint(
  signingSecretKey: Uint8Array,
  options: Readonly<{ corruptSignature?: boolean }> = {},
) {
  return async (request: DirectRouteGrantRequestV2) => {
    const { kind, ttlMs: _ttlMs, ...binding } = request;
    const grantScopeId = request.scope.kind === 'machine_rpc'
      ? request.scope.rpcScopeId
      : request.scope.kind === 'bounded_transfer'
        ? request.scope.mode === 'single'
          ? request.scope.transferId
          : request.scope.transferScopeId
        : request.scope.kind;
    const payload = {
      ...binding,
      grantId: `grant-${options.corruptSignature ? 'invalid' : 'valid'}-${grantScopeId}`,
      accountId,
      iat: 1_000,
      exp: 301_000,
      aud: 'happier-daemon-route-grant' as const,
      proofKind: kind,
    };
    const signature = tweetnacl.sign.detached(
      Buffer.from(createDirectRouteGrantSigningInputV2(payload), 'utf8'),
      signingSecretKey,
    );
    if (options.corruptSignature) signature[0] ^= 0xff;
    return {
      payload,
      signature: {
        keyId: 'mutagen-composed-signing-key',
        alg: 'Ed25519' as const,
        valueBase64Url: base64url(signature),
      },
    };
  };
}

async function waitForContents(
  path: string,
  expected: string,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = await readFile(path, 'utf8').catch(() => null);
    if (last === expected) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

describe('production handoff -> Mutagen manager -> broker -> controller -> native machine/1 -> rooted agent', () => {
  it.each([
    { topology: 'direct' as const, expectedPath: 'direct' as const },
    { topology: 'relay' as const, expectedPath: 'relay' as const },
  ])(
    'creates one bidirectional relationship over $topology, cancels it, and rejects invalid grants without fallback',
    async ({ topology, expectedPath }) => {
      if (runPerformanceAcceptance
        && (!Number.isSafeInteger(performanceFileSizeBytes) || performanceFileSizeBytes < performanceDeltaBytes)) {
        throw new Error(`Invalid HAPPIER_WORKSPACE_SYNC_PERFORMANCE_FILE_BYTES=${performanceFileSizeBytes}`);
      }
      const binaries = await requireLiveBinaries();
      // Keep the nested broker socket below the macOS Unix-domain socket path limit.
      const fixtureRoot = await realpath(await mkdtemp('/tmp/hmic-'));
      const sourceHome = join(fixtureRoot, 's');
      const targetHome = join(fixtureRoot, 't');
      const sourceRoot = join(fixtureRoot, 'a');
      const targetRoot = join(fixtureRoot, 'b');
      let currentSettings = AccountSettingsSchema.parse({
        workspaceRefsV1: [],
        workspaceSyncRelationshipsV1: [],
      });
      let currentSettingsVersion = 1;
      const settingsListeners = new Set<(
        previous: ActiveAccountSettingsSnapshot | null,
        next: ActiveAccountSettingsSnapshot | null,
      ) => void>();
      const getSettingsSnapshot = () => settingsSnapshot(currentSettings, currentSettingsVersion);
      await Promise.all([
        mkdir(sourceHome, { recursive: true }),
        mkdir(targetHome, { recursive: true }),
        mkdir(sourceRoot, { recursive: true }),
        mkdir(targetRoot, { recursive: true }),
      ]);
      const performanceSourcePath = join(sourceRoot, 'performance.bin');
      const performanceTargetPath = join(targetRoot, 'performance.bin');
      let performanceInitialWriteMs = 0;
      let performanceInitialDigest = '';
      if (runPerformanceAcceptance) {
        const initialWriteStartedAt = process.hrtime.bigint();
        await writeDeterministicFile(performanceSourcePath, performanceFileSizeBytes);
        performanceInitialWriteMs = elapsedMs(initialWriteStartedAt);
        performanceInitialDigest = await digestFile(performanceSourcePath);
      }

      const addonPath = process.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH?.trim();
      if (!addonPath) throw new Error('The composed Mutagen/Iroh fixture requires an explicit test-feature addon path');
      const rawAddon = loadIrohNodeNativeAddon(addonPath);
      const testController = rawAddon as unknown as NativeIrohTestController;
      for (const operation of ['forceDirectOnly', 'forceRelayOnly', 'restoreAutomatic', 'getObservedPath'] as const) {
        if (typeof testController[operation] !== 'function') {
          throw new Error(`Iroh addon is not a test-relay-fixture build: missing ${operation}`);
        }
      }
      await setTestTopology(testController, topology);
      const native = createIrohNodeNativeModule(rawAddon);
      const nativeStartMachineTunnel = vi.spyOn(native, 'startMachineTunnel');
      const signingKeyPair = tweetnacl.sign.keyPair();
      const trustRoots = [{
        keyId: 'mutagen-composed-signing-key',
        publicKey: base64url(signingKeyPair.publicKey),
      }];
      const sourceRootOwnership = createWorkspaceRootOwnershipManager({
        lockDirectory: join(sourceHome, 'daemon', 'workspace-sync', 'root-ownership'),
      });
      const targetRootOwnership = createWorkspaceRootOwnershipManager({
        lockDirectory: join(targetHome, 'daemon', 'workspace-sync', 'root-ownership'),
      });
      const targetAgentStreams: Duplex[] = [];
      const callMachineRpc = vi.fn(async () => {
        throw new Error('The composed target ingress must remain on the authenticated machine carrier');
      });
      const targetAuthority = createWorkspaceSyncTargetAuthority({
        localServerId: 'server-1',
        localMachineId: targetMachineId,
        getSettingsSnapshot,
        callMachineRpc,
        bootstrap: {
          stagingDirectory: join(targetHome, 'daemon', 'workspace-sync', 'bootstrap'),
          rootOwnershipManager: targetRootOwnership,
        },
        openRootedAgent: async (request) => {
          const stream = await launchWorkspaceSyncLocalAgent({
            executablePath: binaries.agent,
            args: ['synchronizer', '--external', '--root', request.canonicalRoot],
            ...(request.signal ? { signal: request.signal } : {}),
          });
          targetAgentStreams.push(stream);
          return stream;
        },
      });
      let sourceIroh: Awaited<ReturnType<typeof createDaemonMachineIrohRuntime>> | null = null;
      let targetIroh: Awaited<ReturnType<typeof createDaemonMachineIrohRuntime>> | null = null;
      let admission: Awaited<ReturnType<typeof startPeerMediationLoopbackServer>> | null = null;
      let sourceWorkspaceRuntime: ProductionDaemonWorkspaceSyncRuntime | null = null;
      try {
        sourceIroh = await createDaemonMachineIrohRuntime({
          happyHomeDir: sourceHome,
          relayConfig: { relayPolicy: 'disabled', relayUrls: [] },
          native,
        });
        targetIroh = await createDaemonMachineIrohRuntime({
          happyHomeDir: targetHome,
          relayConfig: { relayPolicy: 'disabled', relayUrls: [] },
          native,
        });
        expect(sourceIroh.available).toBe(true);
        expect(targetIroh.available).toBe(true);
        if (!sourceIroh.available || !targetIroh.available) return;

        admission = await startPeerMediationLoopbackServer({
          nowMs: () => nowMs,
          expected: {
            accountId,
            machineId: targetMachineId,
            flowKind: 'machine_rpc',
            routeKind: 'loopback_direct',
            endpointFingerprint: targetIroh.endpoint.endpointId,
          },
          trustRoots,
          endpointExpiresAt: 301_000,
          irohMachineAdmission: {
            localEndpointId: targetIroh.endpoint.endpointId,
            role: 'acceptor',
            allowedFlows: ['workspace_sync'],
            resolveApplicationTarget: async ({ handshake }) => {
              if (handshake.initiator.kind !== 'machine') return null;
              const ingress = await targetAuthority.acquireWorkspaceSyncMachineIngress({
                operationId: handshake.operationId,
                sourceMachineId: handshake.initiator.machineId,
                targetMachineId: handshake.target.machineId,
              }).catch((error: unknown) => {
                throw Object.assign(new Error(
                  `Target rooted-agent ingress failed: ${error instanceof Error ? error.message : String(error)}`,
                ), { code: 'peer_unavailable' });
              });
              return {
                port: ingress.port,
                localCapability: ingress.localCapability,
              };
            },
          },
        });
        await targetIroh.startAttemptAcceptor({
          admissionPort: Number(new URL(admission.url).port),
        });

        const targetMachine = {
          id: targetMachineId,
          daemonStateVersion: 7,
          daemonState: { peerMediation: { iroh: { endpoint: targetIroh.endpoint } } },
        };
        const readTargetMachine = vi.fn(async () => targetMachine);
        const productionOpen = createWorkspaceMachineCarrierTunnelOpen({
          accountId,
          localMachineId: sourceMachineId,
          runtime: sourceIroh,
          trustRoots,
          readTargetMachine,
          mintGrant: createGrantMint(signingKeyPair.secretKey),
          nowMs: () => nowMs,
        });
        const observedPaths: Array<'direct' | 'relay' | 'unknown'> = [];
        const openMachineCarrierTunnel = async (
          input: Parameters<typeof productionOpen>[0],
        ) => {
          const tunnel = await productionOpen(input).catch((error: unknown) => {
            throw Object.assign(new Error(
              `Production machine opener failed: ${error instanceof Error ? error.message : String(error)}`,
            ), { code: 'peer_unavailable' });
          });
          observedPaths.push(tunnel.observedPath);
          return tunnel;
        };

        const publishSettings = (settings: ActiveAccountSettingsSnapshot['settings']): void => {
          const previous = getSettingsSnapshot();
          currentSettings = AccountSettingsSchema.parse(settings);
          currentSettingsVersion += 1;
          const next = getSettingsSnapshot();
          for (const listener of settingsListeners) listener(previous, next);
        };
        const mutateSettings = async (
          mutate: (settings: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>,
          signal?: AbortSignal,
        ): Promise<AccountSettingsMutationResult> => {
          signal?.throwIfAborted();
          publishSettings(AccountSettingsSchema.parse(await mutate(currentSettings)));
          return { status: 'applied', version: currentSettingsVersion, settings: currentSettings };
        };
        const productionCallMachineRpc: ProductionDaemonWorkspaceSyncFactories['callMachineRpc'] = async (request) => {
          if (request.machineId !== targetMachineId) throw new Error(`Unexpected workspace-sync RPC target ${request.machineId}`);
          if (request.method === RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_PREPARE) {
            return await targetAuthority.prepareBootstrapHere(
              WorkspaceSyncTargetBootstrapPrepareV1Schema.parse(request.request),
              request.signal,
            );
          }
          if (request.method === RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_RELEASE) {
            return await targetAuthority.releaseBootstrapHere(
              WorkspaceSyncTargetBootstrapReleaseV1Schema.parse(request.request),
              request.signal,
            );
          }
          throw new Error(`Unexpected workspace-sync RPC method ${request.method}`);
        };
        const productionFactories: Partial<ProductionDaemonWorkspaceSyncFactories> = {
          createDaemonRuntime: (dependencies) => createDaemonWorkspaceSyncRuntime({
            ...dependencies,
            resolveInstalledComponentPaths: () => ({
              currentPath: binaries.manager,
              resolvedCurrentPath: null,
            }),
            resolveArtifactPaths: () => ({
              managerPath: binaries.manager,
              agentPath: binaries.agent,
            }),
            assertArtifactPayload: () => ({
              engineVersion: 'source-built-mutagen-iroh-production-composed',
              protocolEpoch: 'external-stream-v1',
            }),
            resolveDataLayout: () => ({
              rootDir: join(sourceHome, 'm'),
              dataDir: join(sourceHome, 'm', 'd'),
              brokerDir: join(sourceHome, 'm', 'b'),
              stagingDir: join(sourceHome, 'm', 's'),
            }),
          }),
          createRootOwnershipManager: () => sourceRootOwnership,
          resolveRootOwnershipDirectory: () => join(sourceHome, 'daemon', 'workspace-sync', 'root-ownership'),
          createPeerIdentityValidator: () => createWorkspaceSyncPeerIdentityValidator({
            resolveExecutable: () => binaries.custody,
          }),
          getSettingsSnapshot,
          subscribeSettingsSnapshot: (listener) => {
            settingsListeners.add(listener);
            return () => settingsListeners.delete(listener);
          },
          callMachineRpc: productionCallMachineRpc,
          inspectLegacyState: async ({ activeServerDir }) => ({
            status: 'absent' as const,
            path: join(activeServerDir, 'workspace-replication'),
          }),
          refreshSettings: async () => ({
            ...getSettingsSnapshot(),
            rawSettings: currentSettings,
            whenRefreshed: null,
          }),
          createRelationshipOwner: (options) => createWorkspaceSyncRelationshipOwner({
            ...options,
            mutateSettings,
            readSettings: async () => currentSettings,
            createId: (() => {
              const ids = [sourceWorkspaceRefId, targetWorkspaceRefId];
              return () => ids.shift() ?? `workspace-ref-${ids.length}`;
            })(),
            deriveRelationshipId: () => relationshipId,
            nowMs: () => nowMs,
          }),
        };
        sourceWorkspaceRuntime = await createProductionDaemonWorkspaceSyncRuntime({
          happyHomeDir: sourceHome,
          activeServerDir: join(sourceHome, 'servers', 'server-1'),
          localMachineId: sourceMachineId,
          releaseChannel: 'publicdev',
          credentials: { token: 'test-token', encryption: null },
          openMachineCarrierTunnel,
        }, productionFactories);

        const alphaPayload = `alpha-to-beta-${topology}-non-empty\n`;
        await writeFile(join(sourceRoot, 'alpha-to-beta.txt'), alphaPayload);
        const handoffStatus = (status: 'in_progress' | 'ready_for_cutover' | 'completed', phase: string) => ({
          handoffId: 'handoff-production-composed',
          sessionId: 'session-production-composed',
          sourceMachineId,
          targetMachineId,
          status,
          phase,
          transportStrategy: 'server_routed_stream' as const,
          recoveryActions: [],
        });
        type HandoffMachineCall = NonNullable<
          Parameters<typeof createTrackedSessionHandoffCoordinator>[0]['callMachine']
        >;
        const callHandoffMachine: HandoffMachineCall = vi.fn(async (request) => {
          if (request.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3) {
            return {
              handoffId: 'handoff-production-composed',
              status: handoffStatus('ready_for_cutover', 'staging_target'),
              remoteSessionId: 'remote-production-composed',
              directSource: { kind: 'claudeConfig', configDir: null, projectId: null },
              resume: {
                directory: targetRoot,
                agent: 'claude',
                agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
                resume: 'remote-production-composed',
                transcriptStorage: 'persisted',
                approvedNewDirectoryCreation: true,
              },
            };
          }
          if (request.method === RPC_METHODS.SPAWN_HAPPY_SESSION) {
            return { type: 'success', spawnNonce: 'handoff:handoff-production-composed', sessionIdStatus: 'pending' };
          }
          if (request.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3) {
            return {
              handoffId: 'handoff-production-composed',
              status: handoffStatus('completed', 'finalizing'),
            };
          }
          if (request.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_ABORT_V3) {
            return {
              handoffId: 'handoff-production-composed',
              status: { ...handoffStatus('completed', 'finalizing'), status: 'aborted' },
            };
          }
          throw new Error(`Unexpected handoff RPC method ${request.method}`);
        });
        const coordinate = createTrackedSessionHandoffCoordinator({
          expectedAccountServerId: 'server-1',
          readCredentials: async () => ({ token: 'test-token', encryption: null }),
          resolveSource: async () => ({
            ok: true,
            sourceMachineId,
            sourceRootPath: sourceRoot,
            sessionStorageMode: 'persisted',
          }),
          callMachine: callHandoffMachine,
          awaitTargetCustody: async () => ({ type: 'success', sessionId: 'session-production-composed' }),
          wait: async () => undefined,
          workspaceSyncAdapter: sourceWorkspaceRuntime.handoffAdapter,
        });
        const performanceInitialCopyStartedAt = process.hrtime.bigint();
        const handoffResult = await coordinate({
          operationId: 'action-production-composed',
          actionInput: {
            sessionId: 'session-production-composed',
            targetMachineId,
            targetPath: targetRoot,
            accountServerId: 'server-1',
            workspaceAction: {
              kind: 'create_relationship',
              mode: 'keep_both_in_sync',
              contentPolicy: {
                ...contentPolicyInput,
                policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicyInput),
              },
              flushBeforeCommit: true,
            },
          },
          start: async () => ({
            ok: true,
            result: {
              handoffId: 'handoff-production-composed',
              targetPath: sourceRoot,
              endpointCandidates: [],
              status: handoffStatus('in_progress', 'preparing'),
            },
          }),
          signal: new AbortController().signal,
          publishOwnerUpdate: vi.fn(),
        });
        if (!handoffResult.ok) throw new Error(JSON.stringify(handoffResult));
        expect(handoffResult.result).toMatchObject({
          workspace: { kind: 'create_relationship', relationshipId },
        });
        expect(currentSettings.workspaceSyncRelationshipsV1).toEqual([
          expect.objectContaining({ relationshipId, mode: 'keep_both_in_sync', enabled: true }),
        ]);

        if (runPerformanceAcceptance) {
          await waitForFileDigest(
            performanceTargetPath,
            performanceFileSizeBytes,
            performanceInitialDigest,
            `${topology} initial performance copy`,
          );
          const initialCopyMs = elapsedMs(performanceInitialCopyStartedAt);

          const deltaStartedAt = process.hrtime.bigint();
          const delta = await applyDeterministicDelta(performanceSourcePath, performanceFileSizeBytes);
          await waitForFileRegion(
            performanceTargetPath,
            delta.offset,
            delta.bytes,
            `${topology} 4 KiB delta region`,
          );
          const deltaMs = elapsedMs(deltaStartedAt);
          const deltaDigest = await digestFile(performanceSourcePath);
          await waitForFileDigest(
            performanceTargetPath,
            performanceFileSizeBytes,
            deltaDigest,
            `${topology} 4 KiB delta`,
          );
          recordPerformanceMeasurement({
            topology,
            fileBytes: performanceFileSizeBytes,
            deltaBytes: performanceDeltaBytes,
            initialWriteMs: performanceInitialWriteMs,
            initialCopyMs,
            deltaMs,
          });
        }
        await waitForContents(
          join(targetRoot, 'alpha-to-beta.txt'),
          alphaPayload,
          `${topology} alpha-to-beta Mutagen bytes`,
        );
        const betaPayload = `beta-to-alpha-${topology}-non-empty\n`;
        await writeFile(join(targetRoot, 'beta-to-alpha.txt'), betaPayload);
        await waitForContents(
          join(sourceRoot, 'beta-to-alpha.txt'),
          betaPayload,
          `${topology} beta-to-alpha Mutagen bytes`,
        );

        const status = await sourceWorkspaceRuntime.workspaceSync.controller.get(relationshipId);
        expect(status).toMatchObject({
          relationshipId,
          mode: 'keep_both_in_sync',
        });
        expect(observedPaths.length).toBeGreaterThan(0);
        expect(observedPaths.every((path) => path === expectedPath)).toBe(true);
        expect(targetAgentStreams.length).toBeGreaterThan(0);
        expect(nativeStartMachineTunnel.mock.calls.length).toBeGreaterThan(0);

        const tunnelsBeforeInvalidGrant = nativeStartMachineTunnel.mock.calls.length;
        const agentsBeforeInvalidGrant = targetAgentStreams.length;
        const invalidOpen = createWorkspaceMachineCarrierTunnelOpen({
          accountId,
          localMachineId: sourceMachineId,
          runtime: sourceIroh,
          trustRoots,
          readTargetMachine,
          mintGrant: createGrantMint(signingKeyPair.secretKey, { corruptSignature: true }),
          nowMs: () => nowMs,
        });
        await expect(invalidOpen({
          operationId: relationshipId,
          sourceMachineId,
          targetMachineId,
          flow: 'workspace_sync',
        })).rejects.toMatchObject({ code: 'grant_bad_signature' });
        expect(nativeStartMachineTunnel).toHaveBeenCalledTimes(tunnelsBeforeInvalidGrant);
        expect(targetAgentStreams).toHaveLength(agentsBeforeInvalidGrant);
        expect(callMachineRpc).not.toHaveBeenCalled();

        await sourceWorkspaceRuntime.workspaceSync.controller.terminate(relationshipId);
        await expect(sourceWorkspaceRuntime.workspaceSync.controller.get(relationshipId)).resolves.toBeNull();
        await waitFor(
          () => targetAgentStreams.every((stream) => stream.destroyed),
          'Target rooted Mutagen agent remained alive after relationship cancellation/half-close',
        );
        await sourceWorkspaceRuntime.stop();
        sourceWorkspaceRuntime = null;
      } finally {
        await sourceWorkspaceRuntime?.stop().catch(() => undefined);
        await sourceIroh?.shutdown().catch(() => undefined);
        await targetIroh?.shutdown().catch(() => undefined);
        await admission?.stop().catch(() => undefined);
        await targetAuthority.releaseAllRetainedBootstraps().catch(() => undefined);
        await rm(fixtureRoot, { recursive: true, force: true });
        requireSuccessfulTestControllerOperation(await testController.restoreAutomatic());
      }
    },
    runPerformanceAcceptance ? 30 * 60_000 : 180_000,
  );
});
