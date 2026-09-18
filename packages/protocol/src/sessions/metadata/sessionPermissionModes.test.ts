import { describe, expect, it } from 'vitest';

import {
  SESSION_PERMISSION_INTENT_INPUTS,
  SessionPermissionModeInputSchema,
  SessionPermissionModeSchema,
} from './sessionPermissionModes.js';

describe('SessionPermissionModeInputSchema', () => {
  it('advertises provider-neutral permission inputs and projects compatibility aliases to persisted values', () => {
    expect(SESSION_PERMISSION_INTENT_INPUTS).toEqual(['read_only', 'default', 'auto', 'yolo']);
    expect(SessionPermissionModeInputSchema.parse('read_only')).toBe('read-only');
    expect(SessionPermissionModeInputSchema.parse('auto')).toBe('safe-yolo');
    expect(SessionPermissionModeInputSchema.parse('workspace_write')).toBe('safe-yolo');
    expect(SessionPermissionModeInputSchema.parse('acceptEdits')).toBe('acceptEdits');
    expect(SessionPermissionModeInputSchema.parse('bypassPermissions')).toBe('bypassPermissions');
  });

  it('rejects unknown user input without changing the forward-compatible persisted reader', () => {
    expect(SessionPermissionModeInputSchema.safeParse('surprise-me').success).toBe(false);
    expect(SessionPermissionModeSchema.parse('future-mode')).toBe('default');
  });
});
