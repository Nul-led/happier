import { describe, expect, it } from 'vitest';

import {
  AccountEncryptionCurrentnessResponseSchema,
  AccountEncryptionCurrentnessErrorResponseSchema,
  AccountRecipientEnvelopeReadinessSchema,
  AccountEncryptionModeResponseSchema,
  AccountEncryptionModeUpdateRequestSchema,
} from './encryptionMode.js';

describe('account/encryptionMode', () => {
  it('parses GET /v1/account/encryption response payloads', () => {
    const parsed = AccountEncryptionModeResponseSchema.safeParse({
      mode: 'plain',
      updatedAt: 123,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mode).toBe('plain');
    expect(AccountEncryptionModeResponseSchema.safeParse({
      mode: 'plain',
      version: 7,
      updatedAt: 123,
    }).success).toBe(false);
    expect(AccountEncryptionCurrentnessResponseSchema.parse({
      mode: 'plain',
      version: 7,
      settingsVersion: 11,
      signingKeyFingerprint: 'aemk1_signing',
      contentKeyFingerprint: null,
      updatedAt: 123,
      recipientEnvelopeReadiness: {
        status: 'unavailable',
        reason: 'plain_account',
      },
    }).settingsVersion).toBe(11);
  });

  it('rejects invalid account encryption mode updates', () => {
    const parsed = AccountEncryptionModeUpdateRequestSchema.safeParse({
      mode: 'nope',
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps recipient readiness separate from migration admission and binding material', () => {
    expect(AccountRecipientEnvelopeReadinessSchema.parse({ status: 'available' }))
      .toEqual({ status: 'available' });
    expect(AccountRecipientEnvelopeReadinessSchema.safeParse({ status: 'available', binding: {} }).success)
      .toBe(false);
    for (const reason of ['encryption_setup_required', 'encryption_inconsistent'] as const) {
      expect(AccountEncryptionCurrentnessErrorResponseSchema.parse({
        error: 'migration-required',
        recipientEnvelopeReadiness: { status: 'unavailable', reason },
      }).recipientEnvelopeReadiness.reason).toBe(reason);
    }
    for (const readiness of [
      { status: 'available' },
      { status: 'unavailable', reason: 'plain_account' },
      { status: 'unavailable', reason: 'unknown' },
    ]) {
      expect(AccountEncryptionCurrentnessErrorResponseSchema.safeParse({
        error: 'migration-required', recipientEnvelopeReadiness: readiness,
      }).success).toBe(false);
    }
  });
});
