import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
    computeRunnerMachineContentKeyFingerprintV1,
    resolvePublishedMachineDataEncryptionKeyV1,
    signRunnerMachineContentKeyBindingV1,
} from '@happier-dev/protocol';
import { encodeBase64 } from '@/encryption/base64';
import {
    loadRunnerCreatorMachineContentKeyTrust,
    resetRunnerCreatorMachineContentKeyTrustProjectionForTests,
    retainRunnerCreatorMachineContentKeyTrust,
} from '@/sync/domains/ephemeralRunner/runnerCreatorMachineContentKeyTrust';
import { resolveExpectedRunnerMachineContentKeyBindingV1 } from './runnerMachineContentKeyTrust';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const TOKEN = 'e30.eyJzdWIiOiJhY2NvdW50LW9uZSJ9.signature';
const ACTIVATION_ID = '11111111-1111-4111-8111-111111111111';
const scope = { serverId: 'home-one', accountId: 'account-one' } as const;

/** A modern credential that carries no Account signing authority at all. */
const dataKeyCredentials = {
    token: TOKEN,
    encryption: {
        publicKey: encodeBase64(new Uint8Array(32).fill(5), 'base64url'),
        machineKey: encodeBase64(new Uint8Array(32).fill(6), 'base64url'),
    },
} as const;

let values: Map<string, string>;

beforeEach(() => {
    values = new Map();
    resetRunnerCreatorMachineContentKeyTrustProjectionForTests();
    vi.stubGlobal('window', { localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    } });
});
afterEach(() => {
    resetRunnerCreatorMachineContentKeyTrustProjectionForTests();
    vi.unstubAllGlobals();
});

async function retainCreatorTrust(activationSigningPublicKey: string): Promise<void> {
    await retainRunnerCreatorMachineContentKeyTrust({
        scope: { homeServerIdentityId: scope.serverId, creatorAccountId: scope.accountId },
        machineId: 'machine-one',
        activationId: ACTIVATION_ID,
        activationSigningPublicKey,
    });
}

describe('resolveExpectedRunnerMachineContentKeyBindingV1', () => {
    it('trusts the creator activation identity for a data-key credential with no Account signing key', async () => {
        const activationSigning = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
        const activationSigningPublicKey = encodeBase64(activationSigning.publicKey, 'base64url');
        await retainCreatorTrust(activationSigningPublicKey);

        const expected = resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: dataKeyCredentials,
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        });
        expect(expected).toEqual({
            homeServerIdentityId: 'home-one',
            creatorAccountId: 'account-one',
            machineId: 'machine-one',
            accountSigningPublicKeyBase64Url: activationSigningPublicKey,
        });

        const dataKey = new Uint8Array(32).fill(11);
        const binding = signRunnerMachineContentKeyBindingV1({
            payload: {
                v: 1,
                purpose: 'happier.ephemeral-runner.machine-content-key',
                homeServerIdentityId: 'home-one',
                activationId: ACTIVATION_ID,
                creatorAccountId: 'account-one',
                machineId: 'machine-one',
                installationId: 'installation-one',
                machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(dataKey),
            },
            activationSigningSecretKey: activationSigning.secretKey,
        });
        expect(resolvePublishedMachineDataEncryptionKeyV1({
            machine: {
                id: 'machine-one',
                kind: 'ephemeral_session_runner',
                installationId: 'installation-one',
                dataEncryptionKey: 'wrapped-runner-key',
                runnerContentKeyBinding: binding,
            },
            openedDataEncryptionKey: dataKey,
            expectedAccountMode: 'e2ee',
            expectedRunnerBinding: expected!,
        })).toEqual({ status: 'e2ee', dataKey });
    });

    it('rejects joint substitution of verifier identity, binding and an Account-openable envelope', async () => {
        const activationSigning = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
        await retainCreatorTrust(encodeBase64(activationSigning.publicKey, 'base64url'));

        // Home and Runner together choose a key the Home can also open, re-sign a
        // fully consistent binding for it and publish their own verifier identity.
        const colluding = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(23));
        const substitutedKey = new Uint8Array(32).fill(12);
        const substitutedBinding = signRunnerMachineContentKeyBindingV1({
            payload: {
                v: 1,
                purpose: 'happier.ephemeral-runner.machine-content-key',
                homeServerIdentityId: 'home-one',
                activationId: ACTIVATION_ID,
                creatorAccountId: 'account-one',
                machineId: 'machine-one',
                installationId: 'installation-one',
                machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(substitutedKey),
            },
            activationSigningSecretKey: colluding.secretKey,
        });

        const expected = resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: dataKeyCredentials,
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        });
        // The verifier identity comes from creator-local custody, so the published
        // one is never consulted and the substituted triple fails closed.
        expect(expected?.accountSigningPublicKeyBase64Url)
            .not.toBe(encodeBase64(colluding.publicKey, 'base64url'));
        expect(resolvePublishedMachineDataEncryptionKeyV1({
            machine: {
                id: 'machine-one',
                kind: 'ephemeral_session_runner',
                installationId: 'installation-one',
                dataEncryptionKey: 'wrapped-runner-key',
                runnerContentKeyBinding: substitutedBinding,
            },
            openedDataEncryptionKey: substitutedKey,
            expectedAccountMode: 'e2ee',
            expectedRunnerBinding: expected!,
        })).toEqual({ status: 'unavailable' });
    });

    it('resolves nothing on a device without creator activation custody', async () => {
        expect(resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: dataKeyCredentials,
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        })).toBeNull();
        await expect(loadRunnerCreatorMachineContentKeyTrust(scope, 'machine-one')).resolves.toBeNull();
        expect(resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: dataKeyCredentials,
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        })).toBeNull();
    });

    it('serves the retained identity after a remount once the record is loaded', async () => {
        const activationSigning = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
        await retainCreatorTrust(encodeBase64(activationSigning.publicKey, 'base64url'));
        resetRunnerCreatorMachineContentKeyTrustProjectionForTests();

        expect(resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: dataKeyCredentials,
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        })).toBeNull();
        await expect(loadRunnerCreatorMachineContentKeyTrust(scope, 'machine-one'))
            .resolves.toEqual({
                activationId: ACTIVATION_ID,
                activationSigningPublicKey: encodeBase64(activationSigning.publicKey, 'base64url'),
            });
        expect(resolveExpectedRunnerMachineContentKeyBindingV1({
            credentials: dataKeyCredentials,
            homeServerIdentityId: 'home-one',
            machineId: 'machine-one',
        })?.accountSigningPublicKeyBase64Url)
            .toBe(encodeBase64(activationSigning.publicKey, 'base64url'));
    });
});
