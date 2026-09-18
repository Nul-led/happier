import { describe, expect, it } from 'vitest';

import {
  readEventSessionId,
  readOpenCodeToolCallKey,
  readOpenCodeToolPart,
} from './state.js';

/**
 * Bytes OpenCode minted. Surrounding whitespace, the embedded newline and the
 * `/`, `+`, `=` punctuation are part of the identity the server addresses its
 * own events with, so a correlation reader may decide presence but must never
 * re-mint the value.
 */
const PROVIDER_MINTED_SESSION_ID = '  provider\nses/AB+cd==  ';
const PROVIDER_MINTED_CALL_ID = '  provider\ncall/AB+cd==  ';
const PROVIDER_MINTED_MESSAGE_ID = '  provider\nmsg/AB+cd==  ';

describe('OpenCode provider-event identity readers', () => {
  it('reads every event session-id shape as the exact bytes OpenCode addressed', () => {
    expect(readEventSessionId({ sessionID: PROVIDER_MINTED_SESSION_ID }))
      .toBe(PROVIDER_MINTED_SESSION_ID);
    expect(readEventSessionId({ session: { id: PROVIDER_MINTED_SESSION_ID } }))
      .toBe(PROVIDER_MINTED_SESSION_ID);
    expect(readEventSessionId({ part: { sessionID: PROVIDER_MINTED_SESSION_ID } }))
      .toBe(PROVIDER_MINTED_SESSION_ID);
    expect(readEventSessionId({ info: { sessionID: PROVIDER_MINTED_SESSION_ID } }))
      .toBe(PROVIDER_MINTED_SESSION_ID);
  });

  it('treats a whitespace-only event session id as absent', () => {
    expect(readEventSessionId({ sessionID: '   ' })).toBe('');
    expect(readEventSessionId({ sessionID: '\n' })).toBe('');
    expect(readEventSessionId({ sessionID: 42 })).toBe('');
  });

  it('keeps a tool part addressed to the exact session, call and message bytes', () => {
    const part = readOpenCodeToolPart({
      type: 'tool',
      sessionID: PROVIDER_MINTED_SESSION_ID,
      callID: PROVIDER_MINTED_CALL_ID,
      messageID: PROVIDER_MINTED_MESSAGE_ID,
      tool: 'bash',
      state: { status: 'running' },
    });

    expect(part?.sessionID).toBe(PROVIDER_MINTED_SESSION_ID);
    expect(part?.callID).toBe(PROVIDER_MINTED_CALL_ID);
    expect(part?.messageID).toBe(PROVIDER_MINTED_MESSAGE_ID);
  });

  it('rejects a whitespace-only tool identity instead of keying work on a blank', () => {
    const blankSession = readOpenCodeToolPart({
      type: 'tool',
      sessionID: '   ',
      callID: PROVIDER_MINTED_CALL_ID,
      tool: 'bash',
      state: { status: 'running' },
    });
    const blankCall = readOpenCodeToolPart({
      type: 'tool',
      sessionID: PROVIDER_MINTED_SESSION_ID,
      callID: ' \t ',
      tool: 'bash',
      state: { status: 'running' },
    });

    expect(blankSession).toBeNull();
    expect(blankCall).toBeNull();
  });

  it('does not collapse two tool calls that differ only in identity whitespace', () => {
    const exact = readOpenCodeToolPart({
      type: 'tool',
      sessionID: PROVIDER_MINTED_SESSION_ID,
      callID: PROVIDER_MINTED_CALL_ID,
      tool: 'bash',
      state: { status: 'running' },
    });
    const neighbour = readOpenCodeToolPart({
      type: 'tool',
      sessionID: PROVIDER_MINTED_SESSION_ID.trim(),
      callID: PROVIDER_MINTED_CALL_ID.trim(),
      tool: 'bash',
      state: { status: 'running' },
    });

    expect(exact).not.toBeNull();
    expect(neighbour).not.toBeNull();
    expect(readOpenCodeToolCallKey(exact!)).toBe(
      `${PROVIDER_MINTED_SESSION_ID}:${PROVIDER_MINTED_CALL_ID}`,
    );
    expect(readOpenCodeToolCallKey(exact!)).not.toBe(readOpenCodeToolCallKey(neighbour!));
  });
});
