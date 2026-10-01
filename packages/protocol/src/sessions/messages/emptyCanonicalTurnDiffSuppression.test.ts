import { describe, expect, it } from 'vitest';
import {
  createEmptyCanonicalTurnDiffSuppressionState,
  rememberSuppressedEmptyCanonicalTurnDiffCallId,
  shouldSuppressEmptyCanonicalTurnDiffToolResult,
} from './emptyCanonicalTurnDiffSuppression.js';

describe('empty canonical turn diff sequence suppression', () => {
  it('refreshes an existing id and consumes its result once', () => {
    const state = createEmptyCanonicalTurnDiffSuppressionState();
    for (let i = 0; i < 256; i++) rememberSuppressedEmptyCanonicalTurnDiffCallId(state, `call-${i}`);
    rememberSuppressedEmptyCanonicalTurnDiffCallId(state, 'call-0');
    rememberSuppressedEmptyCanonicalTurnDiffCallId(state, 'call-256');
    expect(shouldSuppressEmptyCanonicalTurnDiffToolResult(state, 'call-0', {})).toBe(true);
    expect(shouldSuppressEmptyCanonicalTurnDiffToolResult(state, 'call-0', {})).toBe(false);
    expect(shouldSuppressEmptyCanonicalTurnDiffToolResult(state, 'call-1', {})).toBe(false);
  });

  it('consumes all matches in a row before forgetting the call id', () => {
    const state = createEmptyCanonicalTurnDiffSuppressionState();
    rememberSuppressedEmptyCanonicalTurnDiffCallId(state, 'same');
    const consumed = new Set<string>();
    expect(shouldSuppressEmptyCanonicalTurnDiffToolResult(state, 'same', {}, consumed)).toBe(true);
    expect(shouldSuppressEmptyCanonicalTurnDiffToolResult(state, 'same', {}, consumed)).toBe(true);
    for (const id of consumed) state.suppressedEmptyCanonicalTurnDiffCallIds.delete(id);
    expect(shouldSuppressEmptyCanonicalTurnDiffToolResult(state, 'same', {})).toBe(false);
  });
});
