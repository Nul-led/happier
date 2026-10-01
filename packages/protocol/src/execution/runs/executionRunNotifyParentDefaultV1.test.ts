import { describe, expect, it } from 'vitest';

import { resolveExecutionRunNotifyParentDefaultV1 } from './executionRunNotifyParentDefaultV1.js';

describe('resolveExecutionRunNotifyParentDefaultV1', () => {
  it('reports a bounded ask back to its Session whatever the Account preference says', () => {
    expect(resolveExecutionRunNotifyParentDefaultV1({ runClass: 'bounded', accountDefault: false })).toBe(true);
    expect(resolveExecutionRunNotifyParentDefaultV1({ runClass: 'bounded', accountDefault: undefined })).toBe(true);
  });

  it('keeps a long-lived conversation on the Account preference, off by default', () => {
    expect(resolveExecutionRunNotifyParentDefaultV1({ runClass: 'long_lived', accountDefault: undefined })).toBe(false);
    expect(resolveExecutionRunNotifyParentDefaultV1({ runClass: 'long_lived', accountDefault: false })).toBe(false);
    expect(resolveExecutionRunNotifyParentDefaultV1({ runClass: 'long_lived', accountDefault: true })).toBe(true);
  });
});
