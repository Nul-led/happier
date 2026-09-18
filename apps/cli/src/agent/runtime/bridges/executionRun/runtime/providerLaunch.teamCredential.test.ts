import { describe, expect, it, vi } from 'vitest';
import { buildBackendTargetKeyV2 } from '@happier-dev/protocol';

import { prepareExecutionRunProviderLaunch } from './providerLaunch';

describe('Execution Run Team credential Provider launch', () => {
  it('consumes the parent Session owner with the exact Run identity and retains cleanup', async () => {
    const cleanup = vi.fn(async () => undefined);
    const prepare = vi.fn(async () => ({
      providerBinding: {
        source: { kind: 'team_resource' as const, resourceId: 'resource-1', resourceRevision: 3 },
        model: { id: 'model-1', name: 'Model 1' },
        upstream: { protocol: 'openai-responses' as const, normalizedUrl: 'http://127.0.0.1:43123/v1', credential: 'apiKey' as const },
        materialization: { v: 1 as const, kind: 'spawnEnv' as const },
      },
      environmentOverlay: [{ name: 'OPENAI_API_KEY', value: 'scoped-authority', source: 'provider' as const }],
      additionalRedactionValues: ['scoped-authority'],
      cleanup,
    }));

    const launch = await prepareExecutionRunProviderLaunch({
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      agentId: 'codex', runId: 'run-1', featureEnabled: true, happyHomeDir: '/tmp/happier',
      connectedServices: {
        v: 2,
        bindingsByServiceId: {
          github: { source: 'connected', selection: 'profile', profileId: 'profile-1' },
        },
      },
      prepareTeamCredentialProviderBinding: prepare,
    });

    expect(prepare).toHaveBeenCalledWith({ runId: 'run-1', agentId: 'codex' });
    expect(launch.providerBinding?.source).toEqual({ kind: 'team_resource', resourceId: 'resource-1', resourceRevision: 3 });
    expect(launch.environment).toEqual({ OPENAI_API_KEY: 'scoped-authority' });
    expect(launch.unsetEnvKeys).toEqual([]);
    expect(launch.connectedServices).toEqual({
      v: 2,
      bindingsByServiceId: {
        github: { source: 'connected', selection: 'profile', profileId: 'profile-1' },
      },
    });
    expect(launch.sanitizeDiagnosticText('scoped-authority failed')).toBe('[REDACTED] failed');
    await launch.cleanupOnExit?.();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('forwards one explicit Team model selection without consulting parent model state', async () => {
    const selection = {
      kind: 'team_credential_provider_model' as const,
      resourceId: 'resource-explicit',
      teamId: 'team-explicit',
      expectedResourceRevision: 9,
      agentTargetKey: buildBackendTargetKeyV2({ kind: 'backend', backendId: 'codex' }),
      modelId: 'model-explicit',
      deliveryMode: 'brokered' as const,
    };
    const prepare = vi.fn(async () => ({
      providerBinding: {
        source: { kind: 'team_resource' as const, resourceId: selection.resourceId, resourceRevision: 9 },
        model: { id: selection.modelId, name: 'Explicit model' },
        upstream: { protocol: 'openai-responses' as const, normalizedUrl: 'http://127.0.0.1:43123/v1', credential: 'apiKey' as const },
        materialization: { v: 1 as const, kind: 'spawnEnv' as const },
      },
      environmentOverlay: [],
      additionalRedactionValues: [],
      cleanup: vi.fn(),
    }));

    await prepareExecutionRunProviderLaunch({
      teamCredentialModel: selection,
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      agentId: 'codex',
      runId: 'run-explicit',
      featureEnabled: true,
      happyHomeDir: '/tmp/happier',
      prepareTeamCredentialProviderBinding: prepare,
    });

    expect(prepare).toHaveBeenCalledWith({
      runId: 'run-explicit',
      agentId: 'codex',
      selection,
    });
  });

  it('fails closed when an explicit Team selection has no live preparation owner', async () => {
    await expect(prepareExecutionRunProviderLaunch({
      teamCredentialModel: {
        kind: 'team_credential_provider_model',
        resourceId: 'resource-missing',
        teamId: 'team-missing',
        expectedResourceRevision: 1,
        agentTargetKey: buildBackendTargetKeyV2({ kind: 'backend', backendId: 'codex' }),
        modelId: 'model-missing',
        deliveryMode: 'brokered',
      },
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      agentId: 'codex',
      runId: 'run-missing',
      featureEnabled: true,
      happyHomeDir: '/tmp/happier',
    })).rejects.toMatchObject({
      code: 'provider_connection_not_found',
    });
  });
});
