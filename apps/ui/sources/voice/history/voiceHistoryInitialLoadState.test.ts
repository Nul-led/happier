import { describe, expect, it } from 'vitest';

import {
  resolveVoiceHistoryInitialLoadFailureState,
} from './voiceHistoryInitialLoadState';

describe('resolveVoiceHistoryInitialLoadFailureState', () => {
  it('uses ordinary error recovery for a stored-content server refusal', () => {
    expect(resolveVoiceHistoryInitialLoadFailureState(
      { code: 'client-upgrade-required' },
    )).toBe('error');
  });

  it('does not infer compatibility from an arbitrary error message', () => {
    expect(resolveVoiceHistoryInitialLoadFailureState(
      new Error('client-upgrade-required'),
    )).toBe('error');
  });
});
