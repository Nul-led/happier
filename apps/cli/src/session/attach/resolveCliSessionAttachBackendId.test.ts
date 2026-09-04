import { describe, expect, it } from 'vitest';

import { resolveCliSessionAttachBackendId } from './resolveCliSessionAttachBackendId';

describe('resolveCliSessionAttachBackendId', () => {
  it('accepts a concrete legacy ACP flavor but rejects the nested customAcp placeholder', () => {
    expect(resolveCliSessionAttachBackendId({ flavor: 'acp:review-bot' })).toBe('review-bot');
    expect(resolveCliSessionAttachBackendId({ flavor: 'acp:customAcp' })).toBeNull();
  });
});
