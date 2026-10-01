import { describe, expect, it } from 'vitest';

import { encodeBase64 } from '../crypto/base64.js';
import { ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES, ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE } from '../crypto/encryptedDataKeyEnvelopeFormatV1.js';
import {
  EmbedCredentialRequestV1Schema,
  EmbedCredentialV1Schema,
  EmbedFrameToHostEnvelopeV1Schema,
  EmbedHostToFrameEnvelopeV1Schema,
  EmbedInitV1Schema,
  EmbedReadyV1Schema,
  projectEmbedCredentialV1,
} from './embedBridgeV1.js';

const identity = { instanceId: 'embed-a', mountNonce: 'load-a' };
const embedPublicKey = encodeBase64(new Uint8Array(32).fill(7), 'base64url');
const credential = { token: 'child-token', expiresAt: '2026-10-01T12:00:00.000Z' };

describe('embed bridge V1', () => {
  it('admits public readiness and credential-backed initialization but rejects malformed or expanded authority', () => {
    const ready = { kind: 'ready', bridgeVersion: 1, identity, embedPublicKey };
    expect(EmbedReadyV1Schema.parse(ready)).toEqual(ready);
    expect(EmbedReadyV1Schema.safeParse({ ...ready, embedPublicKey: encodeBase64(new Uint8Array(31), 'base64url') }).success).toBe(false);
    expect(EmbedReadyV1Schema.safeParse({ ...ready, identity: { ...identity, accountId: 'account' } }).success).toBe(false);
    expect(EmbedReadyV1Schema.safeParse({ ...ready, token: 'leaked' }).success).toBe(false);
    expect(EmbedInitV1Schema.safeParse({ kind: 'init', identity }).success).toBe(false);
    expect(EmbedInitV1Schema.parse({ kind: 'init', identity, credential })).toEqual({ kind: 'init', identity, credential });
    expect(EmbedInitV1Schema.safeParse({ kind: 'init', identity, credential, allowApprove: true }).success).toBe(false);
  });

  it('validates canonical fixed-format key envelopes and sealed options without accepting lenient base64', () => {
    const envelope = new Uint8Array(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES);
    envelope[0] = ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE;
    const wrongVersion = envelope.slice();
    wrongVersion[0] = ENCRYPTED_DATA_KEY_ENVELOPE_V1_VERSION_BYTE + 1;
    expect(EmbedCredentialV1Schema.safeParse({ ...credential, sessionKey: encodeBase64(envelope) }).success).toBe(true);
    for (const sessionKey of [encodeBase64(envelope.slice(1)), encodeBase64(wrongVersion), 'not-a-key', `${encodeBase64(envelope)}\n`]) {
      expect(EmbedCredentialV1Schema.safeParse({ ...credential, sessionKey }).success).toBe(false);
    }
    expect(EmbedCredentialV1Schema.safeParse({ ...credential, sessionOptions: encodeBase64(new Uint8Array(72), 'base64url') }).success).toBe(true);
    expect(EmbedCredentialV1Schema.safeParse({ ...credential, sessionOptions: encodeBase64(new Uint8Array(71), 'base64url') }).success).toBe(false);
    expect(EmbedCredentialV1Schema.safeParse({ ...credential, expiresAt: 'tomorrow' }).success).toBe(false);
  });

  it('rejects reflected host pushes, unknown kinds and malformed correlation fields', () => {
    const hostPush = { version: 1, identity, sequence: 1, direction: 'hostToFrame', payload: { kind: 'open', sessionId: null } };
    expect(EmbedHostToFrameEnvelopeV1Schema.parse(hostPush)).toEqual(hostPush);
    expect(EmbedFrameToHostEnvelopeV1Schema.safeParse(hostPush).success).toBe(false);
    expect(EmbedHostToFrameEnvelopeV1Schema.safeParse({ ...hostPush, payload: { kind: 'resize', height: 5 } }).success).toBe(false);
    expect(EmbedHostToFrameEnvelopeV1Schema.safeParse({ ...hostPush, identity: { ...identity, other: true } }).success).toBe(false);
    expect(EmbedHostToFrameEnvelopeV1Schema.safeParse({ ...hostPush, sequence: -1 }).success).toBe(false);
  });

  it('requires attribution only for a created-session credential request', () => {
    const request = { kind: 'credential.request', embedPublicKey, reason: 'created', sessionId: 's', createdByTokenId: '11111111-1111-4111-8111-111111111111' };
    expect(EmbedCredentialRequestV1Schema.parse(request)).toEqual(request);
    expect(EmbedCredentialRequestV1Schema.safeParse({ ...request, createdByTokenId: undefined }).success).toBe(false);
    expect(EmbedCredentialRequestV1Schema.safeParse({ ...request, sessionId: undefined }).success).toBe(false);
    expect(EmbedCredentialRequestV1Schema.safeParse({ ...request, reason: 'open' }).success).toBe(false);
    expect(EmbedCredentialRequestV1Schema.safeParse({ ...request, createdByTokenId: 'not-a-token-id' }).success).toBe(false);
  });

  it('projects only an exactly validated issued-token id out of an SDK credential result', () => {
    const issued = { ...credential, tokenId: '11111111-1111-4111-8111-111111111111' };
    expect(projectEmbedCredentialV1(credential)).toEqual(credential);
    expect(projectEmbedCredentialV1(issued)).toEqual(credential);
    expect(EmbedCredentialV1Schema.safeParse(issued).success).toBe(false);
    expect(() => projectEmbedCredentialV1({ ...issued, tokenId: 'not-a-token-id' })).toThrow();
    expect(() => projectEmbedCredentialV1({ ...issued, grant: { approve: true } })).toThrow();
  });
});
