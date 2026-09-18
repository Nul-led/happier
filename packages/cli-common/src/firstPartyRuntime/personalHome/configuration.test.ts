import { describe, expect, it } from 'vitest';

import {
  normalizePersonalHomeRestorableConfigurationV1,
  parsePersonalHomeRestorableConfigurationJsonV1,
  parsePersonalHomeRestorableConfigurationV1,
  personalHomeRestorableConfigurationEnvOverrides,
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
      homeDeviceApprovalRequired: false,
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

  it.each([
    ['enabled', true, '1'],
    ['disabled', false, '0'],
  ] as const)('round-trips the %s Home device-approval policy as an explicit semantic value', (_label, required, envValue) => {
    const configuration = normalizePersonalHomeRestorableConfigurationV1({
      homeDeviceApprovalRequired: required,
    }, 'home-identity');

    expect(parsePersonalHomeRestorableConfigurationJsonV1(
      serializePersonalHomeRestorableConfigurationV1(configuration),
      'home-identity',
    ).homeDeviceApprovalRequired).toBe(required);
    expect(personalHomeRestorableConfigurationEnvOverrides(configuration))
      .toMatchObject({ HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: envValue });
  });

  it('round-trips optional Iroh relay policy and custom URLs through the backup allowlist', () => {
    const configuration = normalizePersonalHomeRestorableConfigurationV1({
      irohRelayPolicy: 'automatic',
      irohRelayUrls: 'https://relay-b.example.test,https://relay-a.example.test',
    }, 'home-identity');

    expect(configuration).toMatchObject({
      irohRelayPolicy: 'automatic',
      irohRelayUrls: ['https://relay-a.example.test', 'https://relay-b.example.test'],
    });
    expect(personalHomeRestorableConfigurationEnvOverrides(configuration)).toMatchObject({
      HAPPIER_IROH_RELAY_POLICY: 'automatic',
      HAPPIER_IROH_RELAY_URLS: 'https://relay-a.example.test,https://relay-b.example.test',
    });
    expect(parsePersonalHomeRestorableConfigurationJsonV1(
      serializePersonalHomeRestorableConfigurationV1(configuration),
      'home-identity',
    )).toEqual(configuration);
  });

  it('rejects unknown, missing, and invalid authoritative fields', () => {
    expect(() => parsePersonalHomeRestorableConfigurationV1({ ...valid, unexpected: 'value' })).toThrow(/Unknown Personal Home configuration field/u);
    const { homeServerIdentityId: _removed, ...missingIdentity } = valid;
    expect(() => parsePersonalHomeRestorableConfigurationV1(missingIdentity)).toThrow(/Missing Personal Home configuration field/u);
    const { homeDeviceApprovalRequired: _removedApprovalPolicy, ...missingApprovalPolicy } = valid;
    expect(() => parsePersonalHomeRestorableConfigurationV1(missingApprovalPolicy)).toThrow(/Missing Personal Home configuration field/u);
    expect(() => parsePersonalHomeRestorableConfigurationV1({ ...valid, encryptionStoragePolicy: 'optional' })).toThrow(/storage policy/u);
  });
});
