import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { DaemonContributionRegistryProjectionDescribeResponseSchema, resolveRoleSelectionV1 } from '@happier-dev/protocol';
import { createCredentialedWorkflowMaterializationHostV1, createWorkflowMaterializationHostV1 } from './workflowMaterializationHost';
import { resetInMemoryAccountSettingsContextForTests } from '@/settings/accountSettings/bootstrapAccountSettingsContext';

describe('exact-machine workflow materialization effects', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); resetInMemoryAccountSettingsContextForTests(); });

  it('does not admit with invented policy defaults when Account settings are unavailable', async () => {
    resetInMemoryAccountSettingsContextForTests();
    vi.stubEnv('HAPPIER_ACCOUNT_SETTINGS_MODE', 'never');
    // The HTTP transport is unavailable; the real settings owner must not be
    // replaced by the caller's environment opt-out or a factory-local policy.
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('account_settings_network_unavailable'));
    const resolve = createCredentialedWorkflowMaterializationHostV1({
      credentials: { token: 'unavailable-workflow-account', encryption: null },
      serverHttpBaseUrl: 'http://127.0.0.1:41371', readRoleSources: async () => [],
      readWorkflowDefinition: async () => null, callMachineAction: async () => { throw new Error('must_not_probe_unadmitted_account'); },
    });
    await expect(resolve({ machineId: 'run-machine', directory: '/repo' })).rejects.toMatchObject({ code: 'source_unavailable' });
  });
  it.each([true, false])('uses the run machine readiness and detached capability: %s', async (detachedAvailable) => {
    const calls: string[] = [];
    const resolve = createWorkflowMaterializationHostV1({
      readRoleSelection: async () => ({}), readLaunchProfile: async () => null, readWorkflowDefinition: async () => null,
      callMachineAction: async ({ machineId, method }) => {
        expect(machineId).toBe('run-machine');
        calls.push(method);
        if (method === RPC_METHODS.DAEMON_MERGED_CONTRIBUTION_REGISTRY_PROJECTION_DESCRIBE) return {
          protocolVersion: 1, projection: { v: 2, generation: 3, agentsById: { installed: {
            id: 'installed', identity: { pluginId: 'test.agent', localId: 'agent' }, catalogAgentId: 'installed',
            capabilities: { sessions: { open: ['create'], delivery: ['newTurn'], cancel: true } },
          }, nativeOnly: {
            id: 'nativeOnly', identity: { pluginId: 'native.agent', localId: 'agent' }, catalogAgentId: 'nativeOnly',
            capabilities: { executionRuns: { open: ['create'], checkpoint: false, stop: true } },
          } } },
        };
        if (method === RPC_METHODS.CAPABILITIES_DETECT) return { protocolVersion: 1, results: {
          'cli.installed': { ok: true, data: { installed: true, version: '1', latestVersion: null,
            update: { supported: false, command: null }, signIn: { status: 'unknown', loginSupport: 'unsupported' },
            platform: { supported: true }, install: { available: false, mode: 'none', sizeBytes: null, guideUrl: null }, dependencies: [] } },
          'tool.executionRuns': { ok: true, data: { available: detachedAvailable, features: { detachedScope: true }, backends: { installed: { available: true }, nativeOnly: { available: true } } } },
        } };
        throw new Error('unexpected_machine_method');
      },
    });
    const context = await resolve({ machineId: 'run-machine', directory: '/repo', roleSelection: {
      defaultEngine: { agentTargetKey: 'agent:caller.agent/agent' },
    } });
    // Catalog effects occur in the materializer's availability phase, after policy.
    const secondOpinion = resolveRoleSelectionV1({ ...context.roleSelection, roleId: 'second_opinion' });
    expect(secondOpinion).toMatchObject({ ok: true, selection: { engine: { agentTargetKey: 'agent:test.agent/agent' } } });
    const leaf = { blockId: 'work', selection: { agentTarget: { kind: 'agent' as const, identity: { pluginId: 'test.agent', localId: 'agent' } } } };
    await expect(context.effects.resolveTargetAvailability({ ...leaf, executionTarget: { kind: 'session' } })).resolves.toBe(true);
    await expect(context.effects.resolveTargetAvailability({ ...leaf, executionTarget: { kind: 'detached_run' } })).resolves.toBe(detachedAvailable);
    const nativeLeaf = { ...leaf, selection: { agentTarget: { kind: 'agent' as const, identity: { pluginId: 'native.agent', localId: 'agent' } } } };
    await expect(context.effects.resolveTargetAvailability({ ...nativeLeaf, executionTarget: { kind: 'session' } })).resolves.toBe(false);
    await expect(context.effects.resolveTargetAvailability({ ...nativeLeaf, executionTarget: { kind: 'detached_run' } })).resolves.toBe(detachedAvailable);
    await expect(context.effects.resolveTargetAvailability({ ...leaf, selection: { agentTarget: { kind: 'agent', identity: { pluginId: 'relay.agent', localId: 'agent' } } }, executionTarget: { kind: 'session' } })).resolves.toBe(false);
    expect(calls).toEqual([RPC_METHODS.DAEMON_MERGED_CONTRIBUTION_REGISTRY_PROJECTION_DESCRIBE, RPC_METHODS.CAPABILITIES_DETECT]);
  });

  it('fails unavailable machine observations closed at the leaf boundary', async () => {
    const resolve = createWorkflowMaterializationHostV1({
      readRoleSelection: async () => ({}), readLaunchProfile: async () => null, readWorkflowDefinition: async () => null,
      callMachineAction: async () => { throw new Error('machine_offline'); },
    });
    const context = await resolve({ machineId: 'offline-machine', directory: '/repo' });
    await expect(context.effects.resolveTargetAvailability({ blockId: 'work', selection: { agentTarget: { kind: 'agent', identity: { pluginId: 'test.agent', localId: 'agent' } } }, executionTarget: { kind: 'session' } })).resolves.toBe(false);
  });

  it.each(['schema_rejected', 'schema_malformed', 'core_rejected', 'schema_aborted', 'core_aborted'])
    ('returns unavailable for a missing Action contract but preserves cancellation: %s', async (failure) => {
      const controller = new AbortController();
      const aborted = new Error('caller_aborted_action_schema_read');
      const actionId = failure.startsWith('core_') ? 'session.inspect' : 'test.action/check';
      const roster = DaemonContributionRegistryProjectionDescribeResponseSchema.parse({
        protocolVersion: 1, projection: { v: 2, generation: 1, actionsById: {
          'test.action/check': { id: 'test.action/check', pluginId: 'test.action', occurrenceId: 'action-occurrence',
            title: 'Check', scopes: ['machine'], surfaces: ['cli'], execution: { target: 'daemon' }, dangerLevel: 'safe' },
        } },
      });
      const unavailable = () => {
        if (failure.endsWith('aborted')) { controller.abort(aborted); throw aborted; }
        throw new Error('action_contract_transport_unavailable');
      };
      const resolve = createWorkflowMaterializationHostV1({
        readRoleSelection: async () => ({}), readLaunchProfile: async () => null, readWorkflowDefinition: async () => null,
        readHostActionContract: async () => unavailable(),
        callMachineAction: async ({ method }) => {
          if (method === RPC_METHODS.DAEMON_MERGED_CONTRIBUTION_REGISTRY_PROJECTION_DESCRIBE) return roster;
          if (method === RPC_METHODS.CAPABILITIES_DETECT) return { protocolVersion: 1, results: {} };
          if (method === RPC_METHODS.DAEMON_PLUGIN_ACTION_SCHEMAS_READ) {
            return failure === 'schema_malformed' ? { ok: true, inputSchema: 'not_a_schema' } : unavailable();
          }
          throw new Error('unexpected_machine_method');
        },
      });
      const context = await resolve({ machineId: 'run-machine', directory: '/repo', signal: controller.signal });
      const result = context.effects.readActionContract!(actionId);
      if (failure.endsWith('aborted')) await expect(result).rejects.toBe(aborted);
      else await expect(result).resolves.toBeNull();
    });
});
