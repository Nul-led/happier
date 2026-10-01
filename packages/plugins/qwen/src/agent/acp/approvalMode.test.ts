import { describe, expect, it } from 'vitest';

import { QWEN_APPROVAL_MODE_BY_PERMISSION_INTENT } from './approvalMode.js';

describe('Qwen ACP approval mode mapping', () => {
  it('maps canonical permission intent to the provider modes advertised by Qwen ACP', () => {
    expect(QWEN_APPROVAL_MODE_BY_PERMISSION_INTENT).toEqual({
      default: null,
      'read-only': 'plan',
      'safe-yolo': 'auto-edit',
      yolo: 'yolo',
      plan: 'plan',
    });
  });
});
