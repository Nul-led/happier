import { describe, expect, it } from 'vitest';
import { encodeBase64, signAccountContentKeyBindingV1 } from '@happier-dev/protocol';
import tweetnacl from 'tweetnacl';

import { resolveVerifiedSessionRecipientContentPublicKey } from './sessionRecipientEnvelopeBinding';

function user(overrides: Readonly<Record<string, unknown>>): unknown {
  return { user: {
    id: 'recipient-account', firstName: 'Recipient', lastName: null, avatar: null,
    username: 'recipient', bio: null, badges: [], status: 'none',
    ...overrides,
  } };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe('resolveVerifiedSessionRecipientContentPublicKey', () => {
  it('returns the exact currently signed content key for a ready recipient', () => {
    const content = tweetnacl.box.keyPair();
    const signing = tweetnacl.sign.keyPair();
    const signature = signAccountContentKeyBindingV1({
      accountSigningSecretKey: signing.secretKey,
      contentPublicKey: content.publicKey,
    });
    expect(resolveVerifiedSessionRecipientContentPublicKey(user({
      publicKey: Buffer.from(signing.publicKey).toString('hex'),
      contentPublicKey: encodeBase64(content.publicKey),
      contentPublicKeySig: encodeBase64(signature),
      recipientEnvelopeReadiness: { status: 'available' },
    }))).toEqual(content.publicKey);
  });

  it('keeps canonical setup-pending readiness key-free', () => {
    expect(resolveVerifiedSessionRecipientContentPublicKey(user({
      publicKey: null,
      contentPublicKey: null,
      contentPublicKeySig: null,
      recipientEnvelopeReadiness: { status: 'unavailable', reason: 'encryption_setup_required' },
    }))).toBeNull();
  });

  it('does not infer readiness from key columns when the server omits the projection', () => {
    expect(captureError(() => resolveVerifiedSessionRecipientContentPublicKey(user({
      publicKey: null,
      contentPublicKey: null,
      contentPublicKeySig: null,
    })))).toMatchObject({ code: 'unsupported_action' });
  });

  it('keeps a Plain recipient key-free even when legacy binding columns remain', () => {
    expect(resolveVerifiedSessionRecipientContentPublicKey(user({
      publicKey: '00'.repeat(32),
      contentPublicKey: encodeBase64(new Uint8Array(32).fill(5)),
      contentPublicKeySig: encodeBase64(new Uint8Array(64).fill(6)),
      recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' },
    }))).toBeNull();
  });

  it('withholds key material when canonical readiness requires recipient repair', () => {
    expect(resolveVerifiedSessionRecipientContentPublicKey(user({
      publicKey: null,
      contentPublicKey: null,
      contentPublicKeySig: null,
      recipientEnvelopeReadiness: { status: 'unavailable', reason: 'encryption_inconsistent' },
    }))).toBeNull();
  });

  it.each(['malformed', 'stale'] as const)('rejects %s ready binding material', (kind) => {
    const content = tweetnacl.box.keyPair();
    const otherContent = tweetnacl.box.keyPair();
    const signing = tweetnacl.sign.keyPair();
    const signature = signAccountContentKeyBindingV1({
      accountSigningSecretKey: signing.secretKey,
      contentPublicKey: content.publicKey,
    });
    expect(captureError(() => resolveVerifiedSessionRecipientContentPublicKey(user({
      publicKey: kind === 'malformed' ? 'not-hex' : Buffer.from(signing.publicKey).toString('hex'),
      contentPublicKey: kind === 'malformed' ? 'not-base64' : encodeBase64(otherContent.publicKey),
      contentPublicKeySig: kind === 'malformed' ? 'not-base64' : encodeBase64(signature),
      recipientEnvelopeReadiness: { status: 'available' },
    })))).toMatchObject({ code: 'session_access_invalid_recipient_envelope' });
  });
});
