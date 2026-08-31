import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  REDACTED_SECRET_PLACEHOLDER,
  clearRegisteredRuntimeSecretValues,
  findCredentialShapedValuePath,
  isCredentialShapedKey,
  redactCredentialShapedValuesDeep,
  registerRuntimeSecretValues,
  scrubKnownSecretValues,
  scrubKnownSecretValuesDeep,
} from './artifactSecretSafety';

describe('runtime secret value scrubbing', () => {
  beforeEach(() => {
    clearRegisteredRuntimeSecretValues();
  });

  afterEach(() => {
    clearRegisteredRuntimeSecretValues();
  });

  it('replaces every occurrence of a registered secret value with a stable placeholder', () => {
    const masterSecret = 'sentinel-master-secret-0123456789abcdef';
    const dbPassword = 'sentinelpgpassword0123456789abcdef';
    registerRuntimeSecretValues(masterSecret, dbPassword);

    const text = [
      `HANDY_MASTER_SECRET: ${masterSecret}`,
      `DATABASE_URL: postgres://stress:${dbPassword}@postgres:5432/stressdb`,
      `HANDY_MASTER_SECRET: ${masterSecret}`,
      'benign line stays untouched',
    ].join('\n');

    const scrubbed = scrubKnownSecretValues(text);

    expect(scrubbed).not.toContain(masterSecret);
    expect(scrubbed).not.toContain(dbPassword);
    expect(scrubbed.match(new RegExp(REDACTED_SECRET_PLACEHOLDER, 'gu'))).toHaveLength(3);
    expect(scrubbed).toContain('DATABASE_URL: postgres://stress:');
    expect(scrubbed).toContain('@postgres:5432/stressdb');
    expect(scrubbed).toContain('benign line stays untouched');
  });

  it('scrubs a secret split across chunk boundaries once chunks are assembled at the write choke point', () => {
    const secret = 'sentinel-split-across-chunks-0123456789abcdef';
    registerRuntimeSecretValues(secret);

    const midpoint = Math.floor(secret.length / 2);
    const chunkA = `log line before ${secret.slice(0, midpoint)}`;
    const chunkB = `${secret.slice(midpoint)} log line after`;
    const assembledAtWrite = `${chunkA}${chunkB}`;

    expect(scrubKnownSecretValues(assembledAtWrite)).toBe(
      `log line before ${REDACTED_SECRET_PLACEHOLDER} log line after`,
    );
  });

  it('removes overlapping registered values without leaving partial secret remnants', () => {
    const longSecret = 'sentinel-overlapping-long-secret-value-0123456789';
    const suffixSecret = longSecret.slice(-16);
    registerRuntimeSecretValues(longSecret, suffixSecret);

    const scrubbed = scrubKnownSecretValues(`prefix ${longSecret} suffix ${suffixSecret}`);

    expect(scrubbed).toBe(
      `prefix ${REDACTED_SECRET_PLACEHOLDER} suffix ${REDACTED_SECRET_PLACEHOLDER}`,
    );
  });

  it('ignores short registered values so common text is never redacted', () => {
    registerRuntimeSecretValues('short', '');
    expect(scrubKnownSecretValues('a short value that mentions stress and minio')).toBe(
      'a short value that mentions stress and minio',
    );
  });

  it('scrubs string leaves of nested structures without touching other value types', () => {
    const secret = 'sentinel-deep-scrub-value-0123456789abcdef';
    registerRuntimeSecretValues(secret);

    const scrubbed = scrubKnownSecretValuesDeep({
      a: `leak ${secret}`,
      b: 42,
      c: true,
      d: null,
      e: ['plain', `leak ${secret}`],
      f: { g: { h: `leak ${secret}` }, i: undefined },
    });

    expect(scrubbed).toEqual({
      a: `leak ${REDACTED_SECRET_PLACEHOLDER}`,
      b: 42,
      c: true,
      d: null,
      e: ['plain', `leak ${REDACTED_SECRET_PLACEHOLDER}`],
      f: { g: { h: `leak ${REDACTED_SECRET_PLACEHOLDER}` }, i: undefined },
    });
  });

  it('redacts credential-shaped string leaves while preserving benign evidence', () => {
    expect(redactCredentialShapedValuesDeep({
      config: {
        apiToken: 'sentinel-unregistered-api-token',
        tokenKind: 'account_directory',
        users: 25,
      },
    })).toEqual({
      config: {
        apiToken: REDACTED_SECRET_PLACEHOLDER,
        tokenKind: 'account_directory',
        users: 25,
      },
    });
  });
});

describe('credential-shaped field policy', () => {
  it('accepts keys whose name declares credential material', () => {
    expect(isCredentialShapedKey('HANDY_MASTER_SECRET')).toBe(true);
    expect(isCredentialShapedKey('postgresPassword')).toBe(true);
    expect(isCredentialShapedKey('S3_SECRET_KEY')).toBe(true);
    expect(isCredentialShapedKey('S3_ACCESS_KEY')).toBe(true);
    expect(isCredentialShapedKey('minioSecretKey')).toBe(true);
    expect(isCredentialShapedKey('routeGrantSigningPrivateKey')).toBe(true);
    expect(isCredentialShapedKey('apiToken')).toBe(true);
    expect(isCredentialShapedKey('expoPushToken')).toBe(true);
    expect(isCredentialShapedKey('authorization')).toBe(true);
    expect(isCredentialShapedKey('relaySigningSeed')).toBe(true);
    expect(isCredentialShapedKey('apiKey')).toBe(true);
  });

  it('keeps benign keys so non-secret concepts are never treated as credentials', () => {
    expect(isCredentialShapedKey('exposureMode')).toBe(false);
    expect(isCredentialShapedKey('mode')).toBe(false);
    expect(isCredentialShapedKey('routeGrantSigningPublicKey')).toBe(false);
    expect(isCredentialShapedKey('sessionIds')).toBe(false);
    expect(isCredentialShapedKey('commit')).toBe(false);
    expect(isCredentialShapedKey('HAPPIER_STRESS_USERS')).toBe(false);
    expect(isCredentialShapedKey('reasonCode')).toBe(false);
    expect(isCredentialShapedKey('identityFingerprints')).toBe(false);
    expect(isCredentialShapedKey('masterSecretFingerprint')).toBe(false);
    expect(isCredentialShapedKey('tokenKind')).toBe(false);
    expect(isCredentialShapedKey('credentialTarget')).toBe(false);
  });

  it('rejects credential-shaped fields regardless of the JSON value representation', () => {
    expect(findCredentialShapedValuePath({ apiToken: ['secret', 'parts'] })).toBe('apiToken');
    expect(findCredentialShapedValuePath({ credentials: { bytes: [1, 2, 3] } })).toBe('credentials');
    expect(findCredentialShapedValuePath({ routeGrantSigningPrivateKey: null })).toBe(
      'routeGrantSigningPrivateKey',
    );
    expect(findCredentialShapedValuePath({ tokenKind: 'account_directory' })).toBeNull();
  });
});
