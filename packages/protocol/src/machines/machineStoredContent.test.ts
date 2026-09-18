import { describe, expect, it } from 'vitest';

import { encodeBase64 } from '../crypto/base64.js';
import tweetnacl from 'tweetnacl';
import {
  computeRunnerMachineContentKeyFingerprintV1,
  signRunnerMachineContentKeyBindingV1,
} from '../ephemeralRunner/machineContentKeyBinding.js';
import {
  MACHINE_PLAIN_DATA_KEY_MARKER,
  decodePlainMachineStoredContent,
  encodePlainMachineStoredContent,
  isPlainMachineDataKeyMarker,
  machineStoredContentMatchesAccountMode,
  machineUpdateMatchesStoredMode,
  resolvePublishedMachineDataEncryptionKeyV1,
} from './machineStoredContent.js';

function encodeJson(value: unknown): string {
  return encodeBase64(
    new TextEncoder().encode(JSON.stringify(value)),
    'base64',
  );
}

describe('machineStoredContent', () => {
  it('preserves the existing plain marker and round-trips strict plain content', () => {
    const value = { host: 'machine-a', nested: { ready: true } };

    expect(MACHINE_PLAIN_DATA_KEY_MARKER).toBe(
      encodeJson({ t: 'plain', v: null }),
    );
    expect(isPlainMachineDataKeyMarker(MACHINE_PLAIN_DATA_KEY_MARKER)).toBe(true);
    expect(isPlainMachineDataKeyMarker(
      new TextEncoder().encode(JSON.stringify({ t: 'plain', v: null })),
    )).toBe(true);
    expect(decodePlainMachineStoredContent(
      encodePlainMachineStoredContent(value),
    )).toEqual(value);
  });

  it('normalizes optional undefined object fields to their JSON wire representation', () => {
    const encoded = encodePlainMachineStoredContent({
      status: 'running',
      serviceLabel: undefined,
      nested: {
        present: true,
        absent: undefined,
      },
    });

    expect(decodePlainMachineStoredContent(encoded)).toEqual({
      status: 'running',
      nested: {
        present: true,
      },
    });
  });

  it('rejects malformed, non-plain, and non-strict Machine envelopes', () => {
    const invalidValues = [
      'not-base64',
      encodeJson({ t: 'encrypted', c: 'ciphertext' }),
      encodeJson({ t: 'plain' }),
      encodeJson({ t: 'plain', v: null, extra: true }),
    ];

    for (const value of invalidValues) {
      expect(() => decodePlainMachineStoredContent(value)).toThrow(
        'Invalid plaintext machine content',
      );
    }
    expect(isPlainMachineDataKeyMarker(encodeJson({ t: 'plain', v: 'not-null' }))).toBe(false);
    expect(isPlainMachineDataKeyMarker(encodeJson({ t: 'plain', v: null, extra: true }))).toBe(false);
    expect(() => encodePlainMachineStoredContent(undefined)).toThrow(
      'Invalid plaintext machine content',
    );
  });

  it('enforces account-mode/content agreement without classifying encrypted bytes', () => {
    const plainMetadata = encodePlainMachineStoredContent({ host: 'machine-a' });
    const encryptedEnvelope = encodeJson({ t: 'encrypted', c: 'ciphertext' });

    expect(machineStoredContentMatchesAccountMode({
      mode: 'plain',
      metadata: plainMetadata,
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    })).toBe(true);
    expect(machineStoredContentMatchesAccountMode({
      mode: 'plain',
      metadata: 'opaque-ciphertext',
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    })).toBe(false);
    expect(machineStoredContentMatchesAccountMode({
      mode: 'plain',
      metadata: encryptedEnvelope,
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    })).toBe(false);
    expect(machineStoredContentMatchesAccountMode({
      mode: 'e2ee',
      metadata: 'opaque-ciphertext',
      dataEncryptionKey: 'opaque-wrapped-key',
    })).toBe(true);
    expect(machineStoredContentMatchesAccountMode({
      mode: 'e2ee',
      metadata: plainMetadata,
      dataEncryptionKey: 'opaque-wrapped-key',
    })).toBe(false);
    expect(machineStoredContentMatchesAccountMode({
      mode: 'e2ee',
      metadata: 'opaque-ciphertext',
      dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
    })).toBe(false);
  });

  it('uses the persisted Machine marker as update authority, including database bytes', () => {
    const plainMarkerBytes = new TextEncoder().encode(
      JSON.stringify({ t: 'plain', v: null }),
    );
    const plainState = encodePlainMachineStoredContent({ status: 'running' });

    expect(machineUpdateMatchesStoredMode({
      dataEncryptionKey: plainMarkerBytes,
      daemonState: plainState,
    })).toBe(true);
    expect(machineUpdateMatchesStoredMode({
      dataEncryptionKey: plainMarkerBytes,
      daemonState: 'opaque-ciphertext',
    })).toBe(false);
    expect(machineUpdateMatchesStoredMode({
      dataEncryptionKey: new Uint8Array([1, 2, 3]),
      daemonState: 'opaque-ciphertext',
    })).toBe(true);
    expect(machineUpdateMatchesStoredMode({
      dataEncryptionKey: new Uint8Array([1, 2, 3]),
      daemonState: plainState,
    })).toBe(false);
  });

  it('accepts a Runner key only with the creator-authenticated exact Machine tuple', () => {
    const accountSigning = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const dataKey = new Uint8Array(32).fill(11);
    const payload = {
      v: 1 as const,
      purpose: 'happier.ephemeral-runner.machine-content-key' as const,
      homeServerIdentityId: 'home-one',
      activationId: '11111111-1111-4111-8111-111111111111',
      creatorAccountId: 'account-one',
      machineId: 'machine-one',
      installationId: 'installation-one',
      machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(dataKey),
    };
    const binding = signRunnerMachineContentKeyBindingV1({
      payload,
      accountSigningPublicKey: accountSigning.publicKey,
      accountSigningSecretKey: accountSigning.secretKey,
    });
    const projection = {
      id: 'machine-one',
      kind: 'ephemeral_session_runner',
      installationId: 'installation-one',
      dataEncryptionKey: 'wrapped-runner-key',
      runnerContentKeyBinding: binding,
    };

    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: projection,
      openedDataEncryptionKey: dataKey,
      expectedRunnerBinding: {
        homeServerIdentityId: payload.homeServerIdentityId,
        creatorAccountId: payload.creatorAccountId,
        machineId: payload.machineId,
        accountSigningPublicKeyBase64Url: encodeBase64(accountSigning.publicKey, 'base64url'),
      },
    })).toEqual({ status: 'e2ee', dataKey });

    for (const machine of [
      { ...projection, installationId: 'installation-two' },
      { ...projection, runnerContentKeyBinding: null },
      { ...projection, dataEncryptionKey: null },
    ]) {
      expect(resolvePublishedMachineDataEncryptionKeyV1({
        machine,
        openedDataEncryptionKey: dataKey,
        expectedRunnerBinding: {
          homeServerIdentityId: payload.homeServerIdentityId,
          creatorAccountId: payload.creatorAccountId,
          machineId: payload.machineId,
          accountSigningPublicKeyBase64Url: encodeBase64(accountSigning.publicKey, 'base64url'),
        },
      })).toEqual({ status: 'unavailable' });
    }

    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: projection,
      openedDataEncryptionKey: new Uint8Array(32).fill(12),
      expectedRunnerBinding: {
        homeServerIdentityId: payload.homeServerIdentityId,
        creatorAccountId: payload.creatorAccountId,
        machineId: payload.machineId,
        accountSigningPublicKeyBase64Url: encodeBase64(accountSigning.publicKey, 'base64url'),
      },
    })).toEqual({ status: 'unavailable' });

    for (const key of [
      'homeServerIdentityId',
      'activationId',
      'creatorAccountId',
      'machineId',
      'installationId',
      'machineContentKeyFingerprint',
    ] as const) {
      expect(resolvePublishedMachineDataEncryptionKeyV1({
        machine: {
          ...projection,
          runnerContentKeyBinding: {
            ...binding,
            [key]: `${binding[key]}-substituted`,
          },
        },
        openedDataEncryptionKey: dataKey,
        expectedRunnerBinding: {
          homeServerIdentityId: payload.homeServerIdentityId,
          creatorAccountId: payload.creatorAccountId,
          machineId: payload.machineId,
          accountSigningPublicKeyBase64Url: encodeBase64(accountSigning.publicKey, 'base64url'),
        },
      })).toEqual({ status: 'unavailable' });
    }

    for (const key of ['homeServerIdentityId', 'creatorAccountId', 'machineId'] as const) {
      expect(resolvePublishedMachineDataEncryptionKeyV1({
        machine: projection,
        openedDataEncryptionKey: dataKey,
        expectedRunnerBinding: {
          homeServerIdentityId: key === 'homeServerIdentityId'
            ? `${payload.homeServerIdentityId}-substituted`
            : payload.homeServerIdentityId,
          creatorAccountId: key === 'creatorAccountId'
            ? `${payload.creatorAccountId}-substituted`
            : payload.creatorAccountId,
          machineId: key === 'machineId'
            ? `${payload.machineId}-substituted`
            : payload.machineId,
          accountSigningPublicKeyBase64Url: encodeBase64(accountSigning.publicKey, 'base64url'),
        },
      })).toEqual({ status: 'unavailable' });
    }

    const substitutedSigner = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(23));
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: projection,
      openedDataEncryptionKey: dataKey,
      expectedRunnerBinding: {
        homeServerIdentityId: payload.homeServerIdentityId,
        creatorAccountId: payload.creatorAccountId,
        machineId: payload.machineId,
        accountSigningPublicKeyBase64Url: encodeBase64(substitutedSigner.publicKey, 'base64url'),
      },
    })).toEqual({ status: 'unavailable' });
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: projection,
      openedDataEncryptionKey: dataKey,
    })).toEqual({ status: 'unavailable' });
  });

  it('keeps Plain Runner keylessness and released ordinary Machine fallback distinct', () => {
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: {
        id: 'runner-plain',
        kind: 'ephemeral_session_runner',
        installationId: 'installation-one',
        dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
        runnerContentKeyBinding: null,
      },
      openedDataEncryptionKey: null,
      expectedAccountMode: 'plain',
    })).toEqual({ status: 'plain' });
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: {
        id: 'runner-plain',
        kind: 'ephemeral_session_runner',
        installationId: 'installation-one',
        dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
        runnerContentKeyBinding: null,
      },
      openedDataEncryptionKey: null,
      expectedAccountMode: 'e2ee',
    })).toEqual({ status: 'unavailable' });
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: {
        id: 'runner-plain',
        kind: 'ephemeral_session_runner',
        installationId: 'installation-one',
        dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
        runnerContentKeyBinding: null,
      },
      openedDataEncryptionKey: null,
    })).toEqual({ status: 'unavailable' });
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: {
        id: 'runner-broken',
        kind: 'ephemeral_session_runner',
        installationId: 'installation-one',
        dataEncryptionKey: null,
        runnerContentKeyBinding: null,
      },
      openedDataEncryptionKey: null,
    })).toEqual({ status: 'unavailable' });
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: {
        id: 'ordinary-legacy',
        kind: 'persistent',
        dataEncryptionKey: null,
      },
      openedDataEncryptionKey: null,
    })).toEqual({ status: 'legacy' });
    expect(resolvePublishedMachineDataEncryptionKeyV1({
      machine: {
        id: 'ordinary-substituted-plain',
        kind: 'persistent',
        dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
      },
      openedDataEncryptionKey: null,
      expectedAccountMode: 'e2ee',
    })).toEqual({ status: 'unavailable' });
  });
});
