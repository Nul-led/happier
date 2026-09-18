import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import {
  computeRunnerMachineContentKeyFingerprintV1,
  signRunnerMachineContentKeyBindingV1,
} from '@happier-dev/protocol/ephemeralRunner/machineContentKeyBinding';

import { openVerifiedRunnerRuntimeBootstrap } from './runtimeBootstrap';

describe('openVerifiedRunnerRuntimeBootstrap', () => {
  it('opens exact signed Machine and Session material', () => {
    const account = tweetnacl.sign.keyPair();
    const machineContentKey = new Uint8Array(32).fill(17);
    const sessionDataEncryptionKey = new Uint8Array(32).fill(9);
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(3), 'base64url');
    const binding = signRunnerMachineContentKeyBindingV1({
      payload: {
        v: 1,
        purpose: 'happier.ephemeral-runner.machine-content-key',
        homeServerIdentityId: 'home-1',
        activationId: '00000000-0000-4000-8000-000000000001',
        creatorAccountId: 'account-1',
        machineId: 'machine-1',
        installationId: 'installation-1',
        machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(machineContentKey),
      },
      accountSigningPublicKey: account.publicKey,
      accountSigningSecretKey: account.secretKey,
    });
    const expected = {
      homeServerIdentityId: 'home-1',
      activationId: '00000000-0000-4000-8000-000000000001',
      creatorAccountId: 'account-1',
      sessionId: 'session-1',
      machineId: 'machine-1',
      installationId: 'installation-1',
      launchManifestCommitment,
      reviewedMachineContentKeyBinding: binding,
      accountSigningPublicKeyBase64Url: encodeBase64(account.publicKey, 'base64url'),
    };

    expect(openVerifiedRunnerRuntimeBootstrap({
      bootstrap: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.runtime',
        homeServerIdentityId: expected.homeServerIdentityId,
        activationId: expected.activationId,
        creatorAccountId: expected.creatorAccountId,
        sessionId: expected.sessionId,
        machineId: expected.machineId,
        installationId: expected.installationId,
        launchManifestCommitment: expected.launchManifestCommitment,
        storedContent: { mode: 'e2ee', sessionDataEncryptionKey: encodeBase64(sessionDataEncryptionKey, 'base64url') },
        machineContent: {
          mode: 'e2ee',
          machineContentKeyBase64Url: encodeBase64(machineContentKey, 'base64url'),
          binding,
        },
      },
      expected,
    })).toEqual({ mode: 'e2ee', sessionDataEncryptionKey, machineContentKey });
  });

  it.each([
    ['Home', 'homeServerIdentityId', 'home-other'],
    ['creator Account', 'creatorAccountId', 'account-other'],
    ['installation', 'installationId', 'installation-other'],
  ] as const)('rejects a Plain bootstrap substituted across the exact %s binding', (_label, field, substituted) => {
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(3), 'base64url');
    const expected = {
      homeServerIdentityId: 'home-1',
      activationId: '00000000-0000-4000-8000-000000000001',
      creatorAccountId: 'account-1',
      sessionId: 'session-1',
      machineId: 'machine-1',
      installationId: 'installation-1',
      launchManifestCommitment,
      reviewedMachineContentKeyBinding: null,
    };

    expect(() => openVerifiedRunnerRuntimeBootstrap({
      bootstrap: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.runtime',
        homeServerIdentityId: field === 'homeServerIdentityId' ? substituted : expected.homeServerIdentityId,
        activationId: expected.activationId,
        creatorAccountId: field === 'creatorAccountId' ? substituted : expected.creatorAccountId,
        sessionId: expected.sessionId,
        machineId: expected.machineId,
        installationId: field === 'installationId' ? substituted : expected.installationId,
        launchManifestCommitment,
        storedContent: { mode: 'plain' },
        machineContent: { mode: 'plain' },
      },
      expected,
    })).toThrow('runner_runtime_bootstrap_binding_invalid');
  });

  it('opens an exact Plain bootstrap without inventing encryption material', () => {
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(3), 'base64url');
    const expected = {
      homeServerIdentityId: 'home-1',
      activationId: '00000000-0000-4000-8000-000000000001',
      creatorAccountId: 'account-1',
      sessionId: 'session-1',
      machineId: 'machine-1',
      installationId: 'installation-1',
      launchManifestCommitment,
      reviewedMachineContentKeyBinding: null,
    };

    expect(openVerifiedRunnerRuntimeBootstrap({
      bootstrap: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.runtime',
        homeServerIdentityId: expected.homeServerIdentityId,
        activationId: expected.activationId,
        creatorAccountId: expected.creatorAccountId,
        sessionId: expected.sessionId,
        machineId: expected.machineId,
        installationId: expected.installationId,
        launchManifestCommitment: expected.launchManifestCommitment,
        storedContent: { mode: 'plain' },
        machineContent: { mode: 'plain' },
      },
      expected,
    })).toEqual({ mode: 'plain' });
  });

  it('rejects a Machine binding substituted for another exact Machine', () => {
    const account = tweetnacl.sign.keyPair();
    const machineContentKey = new Uint8Array(32).fill(17);
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(3), 'base64url');
    const binding = signRunnerMachineContentKeyBindingV1({
      payload: {
        v: 1,
        purpose: 'happier.ephemeral-runner.machine-content-key',
        homeServerIdentityId: 'home-1',
        activationId: '00000000-0000-4000-8000-000000000001',
        creatorAccountId: 'account-1',
        machineId: 'machine-other',
        installationId: 'installation-1',
        machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(machineContentKey),
      },
      accountSigningPublicKey: account.publicKey,
      accountSigningSecretKey: account.secretKey,
    });

    expect(() => openVerifiedRunnerRuntimeBootstrap({
      bootstrap: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.runtime',
        homeServerIdentityId: 'home-1',
        activationId: '00000000-0000-4000-8000-000000000001',
        creatorAccountId: 'account-1',
        sessionId: 'session-1',
        machineId: 'machine-1',
        installationId: 'installation-1',
        launchManifestCommitment,
        storedContent: { mode: 'e2ee', sessionDataEncryptionKey: encodeBase64(new Uint8Array(32).fill(9), 'base64url') },
        machineContent: {
          mode: 'e2ee',
          machineContentKeyBase64Url: encodeBase64(machineContentKey, 'base64url'),
          binding,
        },
      },
      expected: {
        homeServerIdentityId: 'home-1',
        activationId: '00000000-0000-4000-8000-000000000001',
        creatorAccountId: 'account-1',
        sessionId: 'session-1',
        machineId: 'machine-1',
        installationId: 'installation-1',
        launchManifestCommitment,
        reviewedMachineContentKeyBinding: binding,
        accountSigningPublicKeyBase64Url: encodeBase64(account.publicKey, 'base64url'),
      },
    })).toThrow('runner_runtime_bootstrap_binding_invalid');
  });

  it('rejects a valid bootstrap binding other than the exact reviewed binding', () => {
    const account = tweetnacl.sign.keyPair();
    const machineContentKey = new Uint8Array(32).fill(17);
    const payload = {
      v: 1 as const,
      purpose: 'happier.ephemeral-runner.machine-content-key' as const,
      homeServerIdentityId: 'home-1',
      activationId: '00000000-0000-4000-8000-000000000001',
      creatorAccountId: 'account-1',
      machineId: 'machine-1',
      installationId: 'installation-1',
      machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(machineContentKey),
    };
    const bootstrapBinding = signRunnerMachineContentKeyBindingV1({
      payload,
      accountSigningPublicKey: account.publicKey,
      accountSigningSecretKey: account.secretKey,
    });
    const reviewedBinding = signRunnerMachineContentKeyBindingV1({
      payload: {
        ...payload,
        machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(new Uint8Array(32).fill(18)),
      },
      accountSigningPublicKey: account.publicKey,
      accountSigningSecretKey: account.secretKey,
    });
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(3), 'base64url');

    expect(() => openVerifiedRunnerRuntimeBootstrap({
      bootstrap: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.runtime',
        homeServerIdentityId: payload.homeServerIdentityId,
        activationId: payload.activationId,
        creatorAccountId: payload.creatorAccountId,
        sessionId: 'session-1',
        machineId: payload.machineId,
        installationId: payload.installationId,
        launchManifestCommitment,
        storedContent: { mode: 'e2ee', sessionDataEncryptionKey: encodeBase64(new Uint8Array(32).fill(9), 'base64url') },
        machineContent: { mode: 'e2ee', machineContentKeyBase64Url: encodeBase64(machineContentKey, 'base64url'), binding: bootstrapBinding },
      },
      expected: {
        homeServerIdentityId: payload.homeServerIdentityId,
        activationId: payload.activationId,
        creatorAccountId: payload.creatorAccountId,
        sessionId: 'session-1',
        machineId: payload.machineId,
        installationId: payload.installationId,
        launchManifestCommitment,
        reviewedMachineContentKeyBinding: reviewedBinding,
        accountSigningPublicKeyBase64Url: encodeBase64(account.publicKey, 'base64url'),
      },
    })).toThrow('runner_runtime_bootstrap_binding_invalid');
  });

  it('zeros decoded Machine material when verification aborts unexpectedly', () => {
    const account = tweetnacl.sign.keyPair();
    const machineContentKey = new Uint8Array(32).fill(17);
    const sessionDataEncryptionKey = new Uint8Array(32).fill(9);
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(3), 'base64url');
    const binding = signRunnerMachineContentKeyBindingV1({
      payload: {
        v: 1,
        purpose: 'happier.ephemeral-runner.machine-content-key',
        homeServerIdentityId: 'home-1',
        activationId: '00000000-0000-4000-8000-000000000001',
        creatorAccountId: 'account-1',
        machineId: 'machine-1',
        installationId: 'installation-1',
        machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(machineContentKey),
      },
      accountSigningPublicKey: account.publicKey,
      accountSigningSecretKey: account.secretKey,
    });
    const verificationFailure = new Error('verification_interrupted');
    const fillSpy = vi.spyOn(Uint8Array.prototype, 'fill');
    let homeIdentityReads = 0;

    try {
      expect(() => openVerifiedRunnerRuntimeBootstrap({
        bootstrap: {
          v: 1,
          purpose: 'happier.ephemeral-session-runner.runtime',
          homeServerIdentityId: 'home-1',
          activationId: '00000000-0000-4000-8000-000000000001',
          creatorAccountId: 'account-1',
          sessionId: 'session-1',
          machineId: 'machine-1',
          installationId: 'installation-1',
          launchManifestCommitment,
          storedContent: {
            mode: 'e2ee',
            sessionDataEncryptionKey: encodeBase64(sessionDataEncryptionKey, 'base64url'),
          },
          machineContent: {
            mode: 'e2ee',
            machineContentKeyBase64Url: encodeBase64(machineContentKey, 'base64url'),
            binding,
          },
        },
        expected: {
          get homeServerIdentityId(): string {
            homeIdentityReads += 1;
            if (homeIdentityReads > 1) throw verificationFailure;
            return 'home-1';
          },
          activationId: '00000000-0000-4000-8000-000000000001',
          creatorAccountId: 'account-1',
          sessionId: 'session-1',
          machineId: 'machine-1',
          installationId: 'installation-1',
          launchManifestCommitment,
          reviewedMachineContentKeyBinding: binding,
          accountSigningPublicKeyBase64Url: encodeBase64(account.publicKey, 'base64url'),
        },
      })).toThrow(verificationFailure);
      expect(fillSpy).toHaveBeenCalledWith(0);
    } finally {
      fillSpy.mockRestore();
    }
  });
});
