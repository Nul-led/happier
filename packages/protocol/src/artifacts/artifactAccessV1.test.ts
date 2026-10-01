import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '../crypto/base64.js';
import { computeContentPublicKeyFingerprint } from '../machines/identity/contentPublicKeyFingerprint.js';
import { ArtifactRecipientKeyEnvelopeInputV1Schema } from './artifactAccessV1.js';

describe('Artifact recipient envelope contract', () => {
  it('accepts the canonical content-key fingerprint and rejects an unqualified digest', () => {
    const fingerprint = computeContentPublicKeyFingerprint(new Uint8Array(32).fill(1));
    const envelope = { recipientAccountId: 'recipient', encryptedDataKey: encodeBase64(new Uint8Array(105)), recipientContentPublicKeyFingerprint: fingerprint };
    expect(ArtifactRecipientKeyEnvelopeInputV1Schema.safeParse(envelope).success).toBe(true);
    expect(ArtifactRecipientKeyEnvelopeInputV1Schema.safeParse({ ...envelope, recipientContentPublicKeyFingerprint: '0'.repeat(64) }).success).toBe(false);
  });
});
