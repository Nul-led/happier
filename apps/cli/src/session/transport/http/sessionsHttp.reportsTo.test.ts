import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as sessionsHttp from './sessionsHttp';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

describe('reportsTo HTTP mutation', () => {
  it.each([
    { status: 409, result: { ok: false, error: 'reports_to_cas_conflict' } },
    { status: 400, result: { ok: false, error: 'reports_to_cycle' } },
    { status: 403, result: { ok: false, error: 'reports_to_forbidden', reason: 'pairwise' } },
  ])('preserves the closed typed refusal from HTTP $status', async ({ status, result }) => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status, data: result });
    await expect(sessionsHttp.setSessionReportsTo({
      token: 'token', sessionId: 'worker/a', leadSessionId: 'lead', expectedLeadSessionId: null,
    })).resolves.toEqual(result);
    expect(axios.post).toHaveBeenLastCalledWith(expect.stringContaining('/v1/sessions/worker%2Fa/reports-to'), {
      leadSessionId: 'lead', expectedLeadSessionId: null,
    }, expect.objectContaining({ validateStatus: expect.any(Function) }));
  });

  it('rejects a success for the wrong child or lead instead of accepting a mismatched attachment', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {
      ok: true, sessionId: 'worker', leadSessionId: 'wrong-lead', attachedAt: 1,
    } });
    await expect(sessionsHttp.setSessionReportsTo({ token: 'token', sessionId: 'worker', leadSessionId: 'lead', expectedLeadSessionId: null }))
      .rejects.toThrow();
  });
});
