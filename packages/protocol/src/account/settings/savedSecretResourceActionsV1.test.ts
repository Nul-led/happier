import { describe, expect, it } from 'vitest';

import { ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES } from '../../crypto/encryptedDataKeyEnvelopeFormatV1.js';
import {
  SavedSecretResourceEnvelopeRepairInputV1Schema,
  SharedSavedSecretCreateInputV1Schema,
  SharedSavedSecretDeleteInputV1Schema,
  SharedSavedSecretGrantsSetInputV1Schema,
  SharedSavedSecretPromoteInputV1Schema,
} from './savedSecretResourceActionsV1.js';

describe('shared Saved Secret complete audience inputs', () => {
  it('accepts 257 structurally valid grants and envelopes without a semantic collection cap', () => {
    const ids = Array.from({ length: 257 }, (_, index) => `subject-${index}`);
    const encryptedDataKey = Buffer.alloc(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES).toString('base64');
    const keyEnvelopes = ids.map((recipientAccountId) => ({
      recipientAccountId,
      encryptedDataKey,
      recipientContentPublicKeyFingerprint: `fingerprint-${recipientAccountId}`,
    }));
    const createInput = {
      resourceId: 'resource-257',
      displayName: 'Complete audience',
      kind: 'token' as const,
      encryptionMode: 'e2ee' as const,
      storedContent: { t: 'encrypted' as const, c: Buffer.alloc(40).toString('base64') },
      accountGrants: ids,
      teamGrants: ids,
      groupGrants: ids,
      keyEnvelopes,
    };

    expect(SharedSavedSecretCreateInputV1Schema.safeParse(createInput).success).toBe(true);
    expect(SharedSavedSecretPromoteInputV1Schema.safeParse({
      ...createInput,
      expectedSettingsVersion: 1,
      nextSettings: null,
    }).success).toBe(true);
    expect(SharedSavedSecretGrantsSetInputV1Schema.safeParse({
      resourceId: createInput.resourceId,
      expectedRevision: 1,
      accountGrants: ids,
      teamGrants: ids,
      groupGrants: ids,
      keyEnvelopes,
    }).success).toBe(true);
    expect(SavedSecretResourceEnvelopeRepairInputV1Schema.safeParse({
      resourceId: createInput.resourceId,
      expectedRevision: 1,
      keyEnvelopes,
    }).success).toBe(true);
  });

  it('retains structural validation for entries in uncapped complete arrays', () => {
    expect(SharedSavedSecretGrantsSetInputV1Schema.safeParse({
      resourceId: 'resource-structural-check',
      expectedRevision: 1,
      accountGrants: [''],
      teamGrants: [],
      groupGrants: [],
    }).success).toBe(false);
  });

  it('accepts an opaque retained identity for the existing delete recovery action', () => {
    expect(SharedSavedSecretDeleteInputV1Schema.safeParse({
      resourceId: ` ${'retained-corrupt-id'.repeat(10)}`,
      expectedRevision: -4,
    }).success).toBe(true);
    expect(SharedSavedSecretDeleteInputV1Schema.safeParse({
      resourceId: '',
      expectedRevision: -4,
    }).success).toBe(true);
  });
});
