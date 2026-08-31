import { describe, expect, it } from 'vitest';

import {
  normalizePersonalHomeRestorableConfigurationV1,
  parsePersonalHomeRestorableConfigurationJsonV1,
  parsePersonalHomeRestorableConfigurationV1,
  serializePersonalHomeRestorableConfigurationV1,
} from './configuration.js';

describe('Personal Home restorable configuration v1', () => {
  const valid = normalizePersonalHomeRestorableConfigurationV1({
    canonicalServerUrl: 'http://127.0.0.1:43110/',
    plainAccountSettingsAtRest: 'none',
  }, 'home-identity');

  it('normalizes the one fixed backup allowlist and serializes its strict shape', () => {
    expect(valid).toEqual({
      homeServerIdentityId: 'home-identity',
      canonicalServerUrl: 'http://127.0.0.1:43110',
      encryptionStoragePolicy: 'plaintext_only',
      defaultAccountMode: 'plain',
      plainAccountSettingsAtRest: 'none',
      plainAccountCredentialsAtRest: 'server_sealed',
      plainAccountArtifactsAtRest: 'server_sealed',
      anonymousSignupPhase: 'loopback-bootstrap-then-disabled',
    });
    expect(parsePersonalHomeRestorableConfigurationJsonV1(
      serializePersonalHomeRestorableConfigurationV1(valid),
      'home-identity',
    )).toEqual(valid);
    expect(() => parsePersonalHomeRestorableConfigurationJsonV1(
      serializePersonalHomeRestorableConfigurationV1(valid),
      'different-home-identity',
    )).toThrow(/identity does not match/u);
  });

  it('rejects unknown, missing, and invalid authoritative fields', () => {
    expect(() => parsePersonalHomeRestorableConfigurationV1({ ...valid, unexpected: 'value' })).toThrow(/Unknown Personal Home configuration field/u);
    const { homeServerIdentityId: _removed, ...missingIdentity } = valid;
    expect(() => parsePersonalHomeRestorableConfigurationV1(missingIdentity)).toThrow(/Missing Personal Home configuration field/u);
    expect(() => parsePersonalHomeRestorableConfigurationV1({ ...valid, encryptionStoragePolicy: 'optional' })).toThrow(/storage policy/u);
  });
});
