import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import { createPluginStateStore } from '@/plugins/store/state.testkit';
import { createEphemeralPluginRuntimeRegistryLease } from '@/plugins/runtime/reload/runtimeLease';
import { resolveExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';
import {
  SAMPLE_PLUGIN_BACKEND_ID,
  SAMPLE_PLUGIN_ID,
  materializeSamplePluginFixture,
} from '@/plugins/testkit/samplePackage';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import type { Credentials } from '@/persistence';

import { SessionHostBridge } from './SessionHostBridge';

const envScope = createEnvKeyScope(['HAPPIER_HOME_DIR', 'PATH']);

function createTestCredentials(): Credentials {
  return {
    token: 'test-token',
    encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
  };
}

async function installSample(params: Readonly<{
  happyHomeDir: string;
  pluginRoot: string;
  trustPolicy: 'local_trusted' | 'prompt';
}>): Promise<void> {
  await materializeSamplePluginFixture(params.pluginRoot);
  await createPluginStateStore({ happyHomeDir: params.happyHomeDir }).write({
    t: 'happier_plugin_state_v1',
    schemaVersion: 1,
    plugins: {
      [SAMPLE_PLUGIN_ID]: {
        source: {
          kind: 'path',
          locator: params.pluginRoot,
          trustPolicy: params.trustPolicy,
          installPolicy: 'link',
          resolvedPath: params.pluginRoot,
          manifestPath: join(params.pluginRoot, '.happier-plugin', 'plugin.json'),
        },
        compatibility: { status: 'unknown', diagnostics: [] },
        install: {
          mode: 'link',
          manifestVersion: '1.0.0',
          installedPath: null,
        },
        state: { enabled: true },
      },
    },
  });
}

afterEach(() => {
  envScope.restore();
  reloadConfiguration();
});

describe('SessionHostBridge current custom Agent (integration)', () => {
  it('uses an explicitly held Runner-local registry lease without consulting the daemon singleton', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-session-bridge-runner-home-'));
    const pluginRoot = await mkdtemp(join(tmpdir(), 'happier-session-bridge-runner-plugin-'));
    try {
      await installSample({ happyHomeDir, pluginRoot, trustPolicy: 'local_trusted' });
      const lease = createEphemeralPluginRuntimeRegistryLease(
        await resolveExecutablePluginRuntimeRegistry({ happyHomeDir, generation: 1 }),
      );
      try {
        const plan = await new SessionHostBridge().createSessionRuntime(
          SAMPLE_PLUGIN_BACKEND_ID,
          {
            credentials: createTestCredentials(),
            directory: pluginRoot,
            happyHomeDir,
          },
          { pluginRuntimeRegistryLease: lease },
        );
        expect(plan.agentId).toBe(SAMPLE_PLUGIN_BACKEND_ID);
        expect(plan.config.createSessionRuntime).toBeTypeOf('function');
      } finally {
        await lease.release();
      }
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
      await rm(pluginRoot, { recursive: true, force: true });
    }
  });

  it('creates and opens a native session through the generation-bound Agent runtime lease', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-session-bridge-current-home-'));
    const pluginRoot = await mkdtemp(join(tmpdir(), 'happier-session-bridge-current-plugin-'));
    try {
      await installSample({ happyHomeDir, pluginRoot, trustPolicy: 'local_trusted' });
      envScope.patch({ HAPPIER_HOME_DIR: happyHomeDir, PATH: process.env.PATH ?? '' });
      reloadConfiguration();

      const plan = await new SessionHostBridge().createSessionRuntime(SAMPLE_PLUGIN_BACKEND_ID, {
        credentials: createTestCredentials(),
        directory: pluginRoot,
        happyHomeDir,
      });
      expect(plan.agentId).toBe(SAMPLE_PLUGIN_BACKEND_ID);
      expect(plan.config.createSessionRuntime).toBeTypeOf('function');

      const runtime = await plan.config.createSessionRuntime?.({
        directory: pluginRoot,
        metadata: {},
        machineId: 'machine-plugin',
        session: { sessionId: 'happy-session-1' },
        transcriptSession: {},
        messageBuffer: {},
        mcpServers: {},
        permissionHandler: {},
        getPermissionMode: () => 'default',
        memoryRecallGuidanceEnabled: false,
      } as never);
      expect(runtime).toMatchObject({
        operations: {
          sendTurnPrompt: expect.any(Function),
          subscribeRuntimeEvents: expect.any(Function),
          resetOrDisposeRuntime: expect.any(Function),
        },
      });
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
      await rm(pluginRoot, { recursive: true, force: true });
    }
  });

  it('uses the host-owned Team credential preparation callback for a direct pinned plugin runtime', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-session-bridge-team-credential-home-'));
    const pluginRoot = await mkdtemp(join(tmpdir(), 'happier-session-bridge-team-credential-plugin-'));
    try {
      await installSample({ happyHomeDir, pluginRoot, trustPolicy: 'local_trusted' });
      const lease = createEphemeralPluginRuntimeRegistryLease(
        await resolveExecutablePluginRuntimeRegistry({ happyHomeDir, generation: 1 }),
      );
      const prepareTeamCredentialProviderBinding = vi.fn(async () => ({
        providerBinding: {
          source: {
            kind: 'team_resource' as const,
            resourceId: 'resource-1',
            resourceRevision: 3,
          },
          model: { id: 'team-model', name: 'Team model' },
          upstream: {
            protocol: 'openai',
            normalizedUrl: 'http://127.0.0.1:43123/v1',
            credential: 'apiKey' as const,
          },
          materialization: { v: 1 as const, kind: 'spawnEnv' as const },
        },
        environmentOverlay: [{
          name: 'OPENAI_BASE_URL',
          value: 'http://127.0.0.1:43123/v1',
          source: 'provider' as const,
        }],
        additionalRedactionValues: ['http://127.0.0.1:43123/v1'],
      }));
      try {
        const plan = await new SessionHostBridge().createSessionRuntime(
          SAMPLE_PLUGIN_BACKEND_ID,
          {
            credentials: createTestCredentials(),
            directory: pluginRoot,
            happyHomeDir,
            backendTarget: {
              kind: 'agent',
              identity: {
                pluginId: SAMPLE_PLUGIN_ID,
                localId: SAMPLE_PLUGIN_BACKEND_ID,
              },
            },
            teamCredentialBindings: [{
              v: 1,
              slot: { kind: 'provider_model' },
              resourceId: 'resource-1',
              expectedResourceRevision: 3,
            }],
            modelSelection: {
              v: 1,
              updatedAt: 1,
              ref: {
                agentTargetKey: `agent:${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_BACKEND_ID}`,
                providerConnectionId: null,
                modelId: 'team-model',
              },
            },
          },
          {
            pluginRuntimeRegistryLease: lease,
            prepareTeamCredentialProviderBinding,
          },
        );

        const runtime = await plan.config.createSessionRuntime?.({
          directory: pluginRoot,
          metadata: {},
          machineId: 'runner-machine-1',
          session: { sessionId: 'runner-session-1' },
          transcriptSession: {},
          messageBuffer: {},
          mcpServers: {},
          permissionHandler: {},
          getPermissionMode: () => 'safe-yolo',
          memoryRecallGuidanceEnabled: false,
        } as never);

        expect(runtime).toMatchObject({
          operations: {
            sendTurnPrompt: expect.any(Function),
            resetOrDisposeRuntime: expect.any(Function),
          },
        });
        const operations = (runtime as Readonly<{ operations: Readonly<{
          sendTurnPrompt(prompt: string, input: Readonly<{
            turnId: string;
            localId: string;
            userMessageSeq: number;
          }>): Promise<void>;
          subscribeRuntimeEvents(listener: (event: Readonly<{ kind?: string; turnId?: string }>) => void): (() => void) | void;
          prepareRunTeamCredentialProviderBinding?(request: Readonly<{
            runId: string;
            agentId: string;
            resourceId: string;
            modelId: string;
            selection?: import('@happier-dev/protocol').TeamCredentialProviderModelSelectionV1;
          }>): Promise<unknown>;
          resetOrDisposeRuntime(): Promise<void>;
        }> }>).operations;
        const events: Readonly<{ kind?: string; turnId?: string }>[] = [];
        const unsubscribe = operations.subscribeRuntimeEvents((event) => events.push(event));
        await operations.sendTurnPrompt('brokered turn through external plugin', {
          turnId: 'runner-external-turn-1',
          localId: 'runner-external-input-1',
          userMessageSeq: 1,
        });
        expect(events).toContainEqual(expect.objectContaining({
          kind: 'input-accepted',
          turnId: 'runner-external-turn-1',
        }));
        await expect(operations.prepareRunTeamCredentialProviderBinding?.({
          runId: 'run-1',
          agentId: SAMPLE_PLUGIN_BACKEND_ID,
          resourceId: 'resource-1',
          modelId: 'team-model',
        })).resolves.toMatchObject({
          providerBinding: {
            source: { kind: 'team_resource', resourceId: 'resource-1', resourceRevision: 3 },
          },
        });
        expect(prepareTeamCredentialProviderBinding).toHaveBeenLastCalledWith({
          sessionId: 'runner-session-1',
          resourceId: 'resource-1',
          expectedResourceRevision: 3,
          agentTargetKey: `agent:${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_BACKEND_ID}`,
          modelId: 'team-model',
          consumer: { kind: 'execution_run', executionRunId: 'run-1' },
          executionRunAgentId: SAMPLE_PLUGIN_BACKEND_ID,
          signal: expect.any(AbortSignal),
        });
        // An attached Run that independently selected a direct resource for
        // another Agent opens its own selection for its own Agent.
        await operations.prepareRunTeamCredentialProviderBinding?.({
          runId: 'run-direct',
          agentId: 'run-agent',
          resourceId: 'resource-direct',
          modelId: 'direct-model',
          selection: {
            kind: 'team_credential_provider_model',
            resourceId: 'resource-direct',
            teamId: 'team-direct',
            expectedResourceRevision: 9,
            deliveryMode: 'direct',
            agentTargetKey: 'agent:other.plugin/run-agent' as never,
            modelId: 'direct-model' as never,
          },
        });
        expect(prepareTeamCredentialProviderBinding).toHaveBeenLastCalledWith({
          sessionId: 'runner-session-1',
          resourceId: 'resource-direct',
          expectedResourceRevision: 9,
          agentTargetKey: 'agent:other.plugin/run-agent',
          modelId: 'direct-model',
          consumer: { kind: 'execution_run', executionRunId: 'run-direct' },
          executionRunSelection: { teamId: 'team-direct', deliveryMode: 'direct' },
          executionRunAgentId: 'run-agent',
          signal: expect.any(AbortSignal),
        });
        unsubscribe?.();
        await operations.resetOrDisposeRuntime();
        expect(prepareTeamCredentialProviderBinding).toHaveBeenCalledWith({
          sessionId: 'runner-session-1',
          resourceId: 'resource-1',
          expectedResourceRevision: 3,
          agentTargetKey: `agent:${SAMPLE_PLUGIN_ID}/${SAMPLE_PLUGIN_BACKEND_ID}`,
          modelId: 'team-model',
          signal: expect.any(AbortSignal),
        });
      } finally {
        await lease.release();
      }
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
      await rm(pluginRoot, { recursive: true, force: true });
    }
  });

  it('fails before runtime creation when the current Agent plugin still requires trust approval', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-session-bridge-prompt-home-'));
    const pluginRoot = await mkdtemp(join(tmpdir(), 'happier-session-bridge-prompt-plugin-'));
    try {
      await installSample({ happyHomeDir, pluginRoot, trustPolicy: 'prompt' });
      envScope.patch({ HAPPIER_HOME_DIR: happyHomeDir, PATH: process.env.PATH ?? '' });
      reloadConfiguration();

      await expect(new SessionHostBridge().createSessionRuntime(SAMPLE_PLUGIN_BACKEND_ID, {
        credentials: createTestCredentials(),
        directory: pluginRoot,
        happyHomeDir,
      })).rejects.toThrow(/trust approval/i);
    } finally {
      await rm(happyHomeDir, { recursive: true, force: true });
      await rm(pluginRoot, { recursive: true, force: true });
    }
  });
});
