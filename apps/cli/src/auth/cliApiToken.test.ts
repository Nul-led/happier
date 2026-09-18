import { describe, expect, it } from 'vitest';
import { formatAccountApiTokenCredentialV1 } from '@happier-dev/protocol/auth/accountApiTokens';
import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';

import {
  buildCliApiTokenContinuationEnvironment,
  CLI_API_TOKEN_HANDOFF_ENV,
  resolveCliApiToken,
  resolveCliApiTokenForSdk,
  stripCliApiTokenEnvironment,
  takePrefixCliApiTokenFlag,
  withCliApiToken,
} from './cliApiToken';

const bearer = `hap_v1_123e4567-e89b-42d3-a456-426614174000_${'A'.repeat(43)}`;
const credential = formatAccountApiTokenCredentialV1({
  bearer,
  wrappingSecret: encodeBase64(new Uint8Array(32).fill(7), 'base64url'),
  serverIdentityId: 'srv_sdk',
  accountId: 'account-1',
  contentPublicKey: 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=',
});

describe('CLI encryption-capable credential custody', () => {
  it('keeps the compound credential local to the SDK and refuses child continuation without disclosing it', async () => {
    const selected = takePrefixCliApiTokenFlag(['--api-token', credential, 'actions']);
    expect(selected?.rest).toEqual(['actions']);
    await withCliApiToken(selected!.token, async () => {
      expect(resolveCliApiToken({})).toBe(bearer);
      expect(resolveCliApiTokenForSdk(bearer, {})).toBe(credential);
      expect(resolveCliApiTokenForSdk('another-bearer', {})).toBe('another-bearer');
      expect(() => buildCliApiTokenContinuationEnvironment({})).toThrowError(
        expect.objectContaining({ code: 'api_token_child_continuation_unsupported' }),
      );
      try {
        buildCliApiTokenContinuationEnvironment({});
        expect.fail('Compound credential was admitted to child continuation');
      } catch (error) {
        expect(String(error)).not.toContain(credential);
        expect(String(error)).not.toContain(bearer);
      }
      expect(stripCliApiTokenEnvironment({ happier_token: credential, [CLI_API_TOKEN_HANDOFF_ENV]: credential, PATH: '/bin' }))
        .toEqual({ PATH: '/bin' });
    });
    expect(resolveCliApiToken({})).toBeNull();
    expect(resolveCliApiTokenForSdk(bearer, {})).toBe(bearer);
  });

  it('preserves the existing one-shot tmux handoff for an ordinary bearer', async () => {
    await withCliApiToken(bearer, async () => {
      expect(buildCliApiTokenContinuationEnvironment({})).toEqual({
        [CLI_API_TOKEN_HANDOFF_ENV]: bearer,
      });
    });
  });

  it('consumes the same parser for ambient credentials and never includes malformed local secrets in errors', () => {
    expect(resolveCliApiToken({ HAPPIER_TOKEN: credential })).toBe(bearer);
    expect(resolveCliApiTokenForSdk(bearer, { HAPPIER_TOKEN: credential })).toBe(credential);
    const malformed = `${credential}private-sentinel`;
    try {
      takePrefixCliApiTokenFlag(['--api-token', malformed]);
      expect.fail('Malformed local credential was admitted');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_arguments' });
      expect(String(error)).not.toContain(malformed);
    }
  });
});
