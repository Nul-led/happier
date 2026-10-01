import { describe, expect, it } from 'vitest';

import { AccountEncryptionMigrateAuthoringMemoryDirectiveSchema } from './encryptionMigrate.js';

describe('Account authoring memory migration directive', () => {
  it('requires each canonical row exactly once and rejects unknown mutation input', () => {
    const item = { key: 'lastUsedProfile', expectedRevision: 3, content: { t: 'plain', v: 'profile-a' } };
    expect(AccountEncryptionMigrateAuthoringMemoryDirectiveSchema.parse({ items: [item] })).toEqual({ items: [item] });
    expect(AccountEncryptionMigrateAuthoringMemoryDirectiveSchema.safeParse({ items: [item, item] }).success).toBe(false);
    expect(AccountEncryptionMigrateAuthoringMemoryDirectiveSchema.safeParse({ items: [{ ...item, key: 'other-settings-key' }] }).success).toBe(false);
    expect(AccountEncryptionMigrateAuthoringMemoryDirectiveSchema.safeParse({ items: [{ ...item, extra: true }] }).success).toBe(false);
  });
});
