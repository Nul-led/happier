import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAutomationDefinitions, reconcileAutomationDefinition, runAutomationNow } from './automations';

const { get, post, request } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get, post, request } }));
vi.mock('@/session/transport/http/serverHttpBaseUrl', () => ({
  resolveServerHttpBaseUrl: () => 'https://api.example.test',
}));

describe('runAutomationNow', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    request.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unexpected_capability_probe')));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the canonical V3 revision conflict at the Workflow transport boundary', async () => {
    request.mockResolvedValue({ status: 409, data: { error: 'automation_template_version_conflict' } });
    await expect(reconcileAutomationDefinition({ token: 'token-1', automationId: 'automation-1', input: {
      expectedTemplateVersion: 1, name: 'Triggers', description: null, enabled: true,
      assignments: [], triggers: [], removedTriggers: [],
    } })).rejects.toMatchObject({ code: 'currentness_conflict' });
  });

  it('uses the authenticated V3 definition-list owner and validates its response', async () => {
    get.mockResolvedValue({
      status: 200,
      data: { automations: [], nextCursor: null },
    });

    await expect(listAutomationDefinitions({ token: 'token-1' })).resolves.toEqual({
      automations: [],
      nextCursor: null,
    });

    expect(get).toHaveBeenCalledWith(
      'https://api.example.test/v3/automations?limit=100',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-1' },
      }),
    );
  });

  it('forwards canonical trigger filters without probing the Home API epoch', async () => {
    get.mockResolvedValue({ status: 200, data: { automations: [], nextCursor: null } });
    const workflowDefinitionId = '11111111-1111-4111-8111-111111111111';
    await listAutomationDefinitions({ token: 'token-1', workflowDefinitionId, scopeSessionId: 'session-one' });
    expect(get).toHaveBeenLastCalledWith(
      `https://api.example.test/v3/automations?limit=100&workflowDefinitionId=${workflowDefinitionId}&scopeSessionId=session-one`,
      expect.anything());
    await expect(listAutomationDefinitions({ token: 'token-1', scope: 'account_inline' }))
      .resolves.toEqual({ automations: [], nextCursor: null });
    expect(get).toHaveBeenLastCalledWith(
      'https://api.example.test/v3/automations?limit=100&scope=account_inline', expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the V3 run-now owner and sends the caller occurrence identity', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { run: { id: 'run-1', automationId: 'automation-1', state: 'queued' } },
    });

    await expect(runAutomationNow({
      token: 'token-1',
      automationId: 'automation/1',
      idempotencyKey: 'ci-build-42',
    })).resolves.toEqual(expect.objectContaining({ id: 'run-1' }));

    expect(post).toHaveBeenCalledWith(
      'https://api.example.test/v3/automations/automation%2F1/run-now',
      undefined,
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-1',
          'Idempotency-Key': 'ci-build-42',
        },
      }),
    );
  });

  it('uses current pagination when the retired Automation API capability is absent', async () => {
    get.mockResolvedValue({
      status: 200,
      data: { automations: [], nextCursor: 'next-page' },
    });

    await expect(listAutomationDefinitions({ token: 'token-1', limit: 20, cursor: 'page-1' })).resolves.toEqual({
      automations: [],
      nextCursor: 'next-page',
    });
    expect(get).toHaveBeenCalledWith(
      'https://api.example.test/v3/automations?limit=20&cursor=page-1',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-1' } }),
    );
  });

  it('preserves authentication rejection from the current Automation list owner', async () => {
    get.mockResolvedValue({ status: 401, data: { error: 'unauthorized' } });

    await expect(listAutomationDefinitions({ token: 'token-1', limit: 20 })).rejects.toMatchObject({
      response: { status: 401 },
      code: 'not_authenticated',
    });
  });

  it('runs an ordinary Automation through V3 without an API epoch advertisement', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { run: {
        id: 'run-ordinary', automationId: 'automation-1', state: 'queued', dueAt: 10,
        claimedAt: null, startedAt: null, finishedAt: null, claimedByMachineId: null,
        leaseExpiresAt: null, attempt: 0, summaryCiphertext: null, errorCode: null,
        errorMessage: null, producedSessionId: null, createdAt: 10, updatedAt: 10,
      } },
    });

    await expect(runAutomationNow({ token: 'token-1', automationId: 'automation-1' }))
      .resolves.toMatchObject({ id: 'run-ordinary' });
    expect(post).toHaveBeenCalledWith(
      'https://api.example.test/v3/automations/automation-1/run-now',
      undefined,
      expect.any(Object),
    );
  });
});
