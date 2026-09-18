import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('axios', () => ({
  default: { get: http.get, post: http.post, isAxiosError: (value: unknown) => Boolean(value && typeof value === 'object' && 'response' in value) },
}));

import { createCliActionDeps } from './createCliActionDeps';

describe('createCliActionDeps workflow boundary', () => {
  const enabledFeatures = {
    status: 'ready' as const,
    provenance: 'authenticated' as const,
    features: {
      features: { automations: { enabled: true }, workflows: { enabled: true } },
      capabilities: {},
    },
  };
  beforeEach(() => {
    http.get.mockReset().mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/account/profile')) return { status: 200, data: { id: 'account-1' } };
      if (url.endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
        mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null,
        updatedAt: 1, recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' },
      } };
      throw new Error(`unexpected_get:${url}`);
    });
    http.post.mockReset().mockImplementation(async (_url: string, body: Readonly<Record<string, unknown>>) => {
      if (body.operation === 'get') throw Object.assign(new Error('not found'), { response: { status: 404 } });
      if (body.operation === 'admit') return { data: { kind: 'created', run: {
        id: body.runId, origin: { kind: 'direct', originSessionId: 'session-1' }, state: 'queued', revision: 0,
        machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
        availability: { pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
          retry: false, restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } } };
      throw new Error(`unexpected_post:${String(body.operation)}`);
    });
  });

  it('normalizes a prompt-only Workflow from the trusted calling Session context', async () => {
    const deps = createCliActionDeps({
      token: 'token', credentials: { token: 'token', encryption: null }, sessionId: 'session-1',
      rawSession: { path: process.cwd(), machineId: 'machine-1' },
      getCurrentSessionBackendTarget: () => ({ kind: 'backend', backendId: 'codex', sourceKind: 'built_in' }),
      resolveServerFeaturesSnapshot: () => enabledFeatures as never,
      mode: 'plain', ctx: null,
    });
    const result = await deps.workflowAction!({
      actionId: 'workflow.validate',
      input: { definition: { blocks: ['work'] } },
      context: { defaultSessionId: 'session-1' },
    });

    expect(result).toMatchObject({
      valid: true,
      normalizedDefinition: {
        defaults: {
          agentTarget: {
            kind: 'agent',
            identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
          },
        },
      },
    });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('does not fabricate Session ingress defaults for a non-Session caller', async () => {
    const deps = createCliActionDeps({
      token: 'token', credentials: { token: 'token', encryption: null }, sessionId: 'session-1',
      rawSession: { path: process.cwd(), machineId: 'machine-1' },
      getCurrentSessionBackendTarget: () => ({ kind: 'backend', backendId: 'codex', sourceKind: 'built_in' }),
      resolveServerFeaturesSnapshot: () => enabledFeatures as never,
      mode: 'plain', ctx: null,
    });

    await expect(deps.workflowAction!({
      actionId: 'workflow.validate',
      input: { definition: { blocks: ['work'] } },
      context: { surface: 'cli' },
    })).resolves.toMatchObject({ valid: false });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('reports the Workflow family unavailable when its authenticated host owner is absent', async () => {
    const deps = createCliActionDeps({
      token: 'token',
      sessionId: 'session-1',
      rawSession: { path: process.cwd(), machineId: 'machine-1' },
      getCurrentSessionBackendTarget: () => ({ kind: 'backend', backendId: 'codex', sourceKind: 'built_in' }),
      mode: 'plain',
      ctx: null,
    });
    const execute = deps.workflowAction;
    expect(execute).toBeDefined();
    if (!execute) throw new Error('expected Workflow Action boundary');

    await expect(execute({
      actionId: 'workflow.run.get',
      input: { runId: '33333333-3333-4333-8333-333333333333' },
      context: { surface: 'cli' },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'content_unavailable',
      error: 'content_unavailable',
    });
  });

  it.each([
    ['missing', { status: 'ready', provenance: 'authenticated', features: { features: { automations: { enabled: true } }, capabilities: {} } }],
    ['malformed', { status: 'ready', provenance: 'authenticated', features: { features: { automations: { enabled: true }, workflows: { enabled: 'yes' } }, capabilities: {} } }],
    ['disabled', { status: 'ready', provenance: 'authenticated', features: { features: { automations: { enabled: true }, workflows: { enabled: false } }, capabilities: {} } }],
  ])('fails %s workflow availability before any storage effect', async (_name, snapshot) => {
    const deps = createCliActionDeps({
      token: 'token', credentials: { token: 'token', encryption: null }, sessionId: 'session-1',
      rawSession: { path: process.cwd(), machineId: 'machine-1' },
      getCurrentSessionBackendTarget: () => ({ kind: 'backend', backendId: 'codex', sourceKind: 'built_in' }),
      resolveServerFeaturesSnapshot: () => snapshot as never,
      mode: 'plain', ctx: null,
    });

    await expect(deps.workflowAction!({
      actionId: 'workflow.run.start',
      input: { runId: '33333333-3333-4333-8333-333333333333', source: { kind: 'inline', definition: { blocks: ['work'] } } },
      context: { surface: 'agent', defaultSessionId: 'session-1' },
    })).resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
});
