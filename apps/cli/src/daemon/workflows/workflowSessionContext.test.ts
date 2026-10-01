import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createProductionWorkflowSessionContextReader } from './workflowSessionContext';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), isAxiosError: () => false } }));

const sessionId = 'c123456789012345678901234';
const credentials = { token: 'token', encryption: null } as const;
const tokens = { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 3 };
const cost = { reportedUsd: 0, estimatedUsd: 0, currency: 'USD' };
let goal: Record<string, unknown>;

describe('production workflow session context', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.post).mockReset();
    goal = { id: 'goal', kind: 'goal', origin: 'happier', status: 'active', title: 'Ship', updatedAt: 10,
      tokenBudget: 50, tokensUsed: 9999, startedAt: 5, createdAt: 1 };
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
        mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
      } };
      if (String(url).includes('/messages')) return { status: 200, data: { messages: [
        { id: 'new', seq: 3, createdAt: 3, messageRole: 'agent', content: { t: 'plain', v: { role: 'agent', content: { type: 'text', text: 'new' } } } },
        { id: 'old', seq: 1, createdAt: 1, messageRole: 'user', content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'old' } } } },
      ], hasMore: false } };
      if (String(url).endsWith('/turns')) return { status: 200, data: { v: 1, sessionId, updatedAt: 4, turns: [
        { turnId: 'turn-1', initiator: 'workflow', status: 'completed', startedAt: 1, updatedAt: 4,
          transcriptAnchors: { startSeqInclusive: 1, endSeqInclusive: 3 } },
      ] } };
      return { status: 200, data: { session: { id: sessionId, seq: 0, createdAt: 0, updatedAt: 0, active: true,
        activeAt: 0, metadataVersion: 0, agentStateVersion: 0, agentState: null, dataEncryptionKey: null,
        encryptionMode: 'plain', metadata: JSON.stringify({ machineId: 'machine', sessionWorkStateV1: {
          v: 1, backendId: 'test', updatedAt: 10, primaryItemId: 'goal', items: [goal],
        } }) } } };
    });
    vi.mocked(axios.post).mockResolvedValue({ status: 200, data: { v: 1, totals: { eventCount: 1, tokens, cost } } });
  });

  it('reads real owner metadata and transcript with persisted initiators and scoped accounted usage', async () => {
    const reader = createProductionWorkflowSessionContextReader({ credentials, machineId: 'machine', originSessionId: sessionId });
    const value = await reader.resolveSessionContext(1);
    expect(value).toMatchObject({ goal: { title: 'Ship', tokenBudget: 50 }, usage: { kind: 'accounted', tokensUsed: 3 },
      turns: [{ initiator: 'workflow', text: 'old\n\nnew' }], truncated: false });
    expect(value.goal).not.toHaveProperty('tokensUsed');
    expect(vi.mocked(axios.post).mock.calls[0]?.[1]).toMatchObject({ filters: { sessionIds: [sessionId] }, dateRange: { startMs: 5 } });
    await expect(reader.resolveSessionContextField('goal.tokenBudget')).resolves.toBe(50);
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('usage unavailable'));
    await expect(reader.resolveSessionContextField('goal.tokenBudget')).resolves.toBe(50);
  });

  it('retains a committed tool-only turn without inventing transcript text', async () => {
    const get = vi.mocked(axios.get).getMockImplementation()!;
    vi.mocked(axios.get).mockImplementation(async (url, config) => {
      if (String(url).includes('/messages')) return { status: 200, data: { messages: [], hasMore: false } };
      return get(url, config);
    });
    await expect(createProductionWorkflowSessionContextReader({ credentials, machineId: 'machine', originSessionId: sessionId })
      .resolveSessionContext(1)).resolves.toMatchObject({ turns: [{ initiator: 'workflow', text: '' }], truncated: false });
  });

  it('selects the most recent committed turns and returns them oldest first', async () => {
    const get = vi.mocked(axios.get).getMockImplementation()!;
    vi.mocked(axios.get).mockImplementation(async (url, config) => {
      if (String(url).endsWith('/turns')) return { status: 200, data: { v: 1, sessionId, updatedAt: 6, turns: [
        { turnId: 'active', initiator: 'user', status: 'in_progress', startedAt: 5, updatedAt: 6,
          transcriptAnchors: { startSeqInclusive: 5, endSeqInclusive: null } },
        { turnId: 'new', initiator: 'workflow', status: 'completed', startedAt: 3, updatedAt: 4,
          transcriptAnchors: { startSeqInclusive: 3, endSeqInclusive: 3 } },
        { turnId: 'old', initiator: 'user', status: 'completed', startedAt: 1, updatedAt: 2,
          transcriptAnchors: { startSeqInclusive: 1, endSeqInclusive: 1 } },
      ] } };
      return get(url, config);
    });
    const reader = createProductionWorkflowSessionContextReader({ credentials, machineId: 'machine', originSessionId: sessionId });
    await expect(reader.resolveSessionContext(1)).resolves.toMatchObject({ turns: [{ initiator: 'workflow', text: 'new' }] });
    await expect(reader.resolveSessionContext(2)).resolves.toMatchObject({ turns: [
      { initiator: 'user', text: 'old' }, { initiator: 'workflow', text: 'new' },
    ] });
  });

  it('fails preparation for unknown committed turn facts or an origin on a different Machine', async () => {
    const otherMachine = createProductionWorkflowSessionContextReader({ credentials, machineId: 'other', originSessionId: sessionId });
    await expect(otherMachine.resolveSessionContext(0)).rejects.toMatchObject({ code: 'workflow_session_context_unavailable' });
    const get = vi.mocked(axios.get).getMockImplementation()!;
    vi.mocked(axios.get).mockImplementation(async (url, config) => {
      const response = await get(url, config);
      if (String(url).endsWith('/turns')) return { status: 200, data: { v: 1, sessionId, updatedAt: 4, turns: [
        { turnId: 'legacy', status: 'completed', startedAt: 1, updatedAt: 4,
          transcriptAnchors: { startSeqInclusive: 1, endSeqInclusive: 3 } },
      ] } };
      return response;
    });
    await expect(createProductionWorkflowSessionContextReader({ credentials, machineId: 'machine', originSessionId: sessionId })
      .resolveSessionContext(2)).rejects.toMatchObject({ code: 'workflow_session_context_unavailable' });
  });

  it('distinguishes no usage and missing goal times from a failed usage read', async () => {
    const reader = createProductionWorkflowSessionContextReader({ credentials, machineId: 'machine', originSessionId: sessionId });
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: { v: 1, totals: { eventCount: 0, tokens: { ...tokens, total: 0 }, cost } } });
    await expect(reader.resolveSessionContext(0)).resolves.toMatchObject({ usage: { kind: 'unavailable' }, turns: [] });
    delete goal.startedAt;
    delete goal.createdAt;
    await expect(reader.resolveSessionContextField('usage.tokensUsed')).rejects.toMatchObject({ code: 'missing_reference' });
    goal.createdAt = 1;
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('transport offline'));
    await expect(reader.resolveSessionContext(0)).rejects.toMatchObject({ code: 'workflow_session_context_unavailable' });
  });
});
