import { describe, expect, it } from 'vitest';
import { formatAccountApiTokenCredentialV1 } from '@happier-dev/protocol/auth/accountApiTokens';
import { wrapApiTokenEncryptionAccessV1 } from '@happier-dev/protocol';
import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';

import { createClientCredential } from './clientCredential.js';

const context = {
  serverIdentityId: 'srv_sdk',
  accountId: 'account-1',
  tokenId: '123e4567-e89b-42d3-a456-426614174000',
  contentPublicKey: 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=',
};
const wrappingSecret = new Uint8Array(32).fill(7);
const contentPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const bearer = `hap_v1_${context.tokenId}_${encodeBase64(new Uint8Array(32).fill(8), 'base64url')}`;
const token = formatAccountApiTokenCredentialV1({
  bearer,
  wrappingSecret: encodeBase64(wrappingSecret, 'base64url'),
  serverIdentityId: context.serverIdentityId,
  accountId: context.accountId,
  contentPublicKey: context.contentPublicKey,
});
const encryptionAccess = wrapApiTokenEncryptionAccessV1({
  context,
  wrappingSecret,
  contentPrivateKey,
  randomBytes: (length) => new Uint8Array(length).fill(3),
});

describe('SDK API-token credential lifetime', () => {
  it('zeros opened content material and fails closed after disposal', async () => {
    const credential = createClientCredential(token);
    const material = await credential.encryption!.getMaterial(async () => ({
      v: 1, accountId: context.accountId, tokenId: context.tokenId, encryptionAccess,
    }));
    expect(material.machineKey).toEqual(contentPrivateKey);
    credential.dispose();
    expect(material.machineKey).toEqual(new Uint8Array(32));
    await expect(credential.encryption!.getMaterial(async () => {
      throw new Error('Disposed credentials must not retrieve material');
    })).rejects.toMatchObject({
      name: 'HappierClientClosedError',
    });
  });
});
