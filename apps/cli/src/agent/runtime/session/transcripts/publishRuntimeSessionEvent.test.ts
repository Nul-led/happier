import { describe, expect, it, vi } from 'vitest';

import { commitRuntimeSessionEvent, publishRuntimeSessionEvent } from './publishRuntimeSessionEvent';

describe('publishRuntimeSessionEvent', () => {
  it('returns custody only after the canonical durable transcript enqueue persists the event', async () => {
    const enqueueAgentMessageCommitted = vi
      .fn()
      .mockResolvedValueOnce({ persisted: false, delivered: false })
      .mockResolvedValueOnce({ persisted: true, delivered: false });
    const session = {
      sessionId: 'session-durable-event',
      enqueueAgentMessageCommitted,
    };
    const event = {
      type: 'terminal-composer-draft-blocked' as const,
      reason: 'idle_draft_guard' as const,
      stateAtMs: 123,
      message: 'Clear the terminal draft.',
    };

    await expect(publishRuntimeSessionEvent({
      session,
      agentId: 'claude',
      event,
    })).rejects.toMatchObject({
      code: 'runtime_transcript_required_admission_failed',
      reason: 'durable_custody_rejected',
    });
    await expect(publishRuntimeSessionEvent({
      session,
      agentId: 'claude',
      event,
    })).resolves.toEqual({ status: 'custodied' });

    expect(enqueueAgentMessageCommitted).toHaveBeenCalledTimes(2);
    expect(enqueueAgentMessageCommitted).toHaveBeenLastCalledWith(
      'claude',
      {
        type: 'event',
        data: event,
        id: expect.any(String),
      },
      expect.objectContaining({
        localId: expect.any(String),
        provenance: { kind: 'non_dependent', source: 'external' },
      }),
    );
  });

  it('commits a caller-selected canonical event identity and returns it only after durable custody', async () => {
    const enqueueAgentMessageCommitted = vi.fn(async () => ({ persisted: true, delivered: false }));
    const localId = 'session-follow-wake:wake-1';
    const result = await commitRuntimeSessionEvent({
      session: { sessionId: 'destination', enqueueAgentMessageCommitted },
      agentId: 'claude',
      localId,
      event: {
        type: 'message',
        message: 'Followed context changed, so Happier woke this Agent with the update.',
      },
    });
    const retry = await commitRuntimeSessionEvent({
      session: { sessionId: 'destination', enqueueAgentMessageCommitted },
      agentId: 'claude',
      localId,
      event: {
        type: 'message',
        message: 'Followed context changed, so Happier woke this Agent with the update.',
      },
    });

    expect(result).toEqual({ localId });
    expect(retry).toEqual({ localId });
    expect(enqueueAgentMessageCommitted).toHaveBeenCalledTimes(2);
    expect(enqueueAgentMessageCommitted).toHaveBeenNthCalledWith(
      2,
      'claude',
      {
        type: 'event',
        data: expect.objectContaining({ type: 'message', message: expect.stringContaining('Followed context') }),
        id: localId,
      },
      expect.objectContaining({
        localId,
        provenance: { kind: 'non_dependent', source: 'external' },
      }),
    );
  });
});
