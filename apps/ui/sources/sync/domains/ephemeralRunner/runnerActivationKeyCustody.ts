import tweetnacl from 'tweetnacl';
import { HappierRunnerActivationFileV1Schema } from '@happier-dev/protocol/ephemeralRunner/activationFile';
import { RunnerActivationCreateRequestV1Schema } from '@happier-dev/protocol/ephemeralRunner/activation';
import { readDeviceLocalStorageString, writeDeviceLocalStorageString, removeDeviceLocalStorageString } from '@/auth/storage/deviceLocalStorage';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { digest } from '@/platform/digest';
import { getRandomBytes } from '@/platform/cryptoRandom';
import { randomUUID } from '@/platform/randomUUID';
import { createServerAccountScope, serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { registerRunnerCreatorCustodyActivation } from './runnerCreatorLaunchCustody';

export type RunnerActivationKeyCustody = Readonly<{
    activationId: string;
    keyHandle: string;
    activationSigningPublicKey: string;
}>;

export class RunnerActivationKeyUnavailableError extends Error {
    readonly code = 'runner_activation_key_unavailable' as const;
    constructor() {
        super('Runner activation key custody is unavailable');
        this.name = 'RunnerActivationKeyUnavailableError';
    }
}

async function keyHandleFor(scope: ServerAccountScope, activationId: string): Promise<string> {
    const normalized = createServerAccountScope(scope.serverId, scope.accountId);
    if (!normalized || normalized.serverId !== scope.serverId || normalized.accountId !== scope.accountId
        || !RunnerActivationCreateRequestV1Schema.shape.activationId.safeParse(activationId).success) {
        throw new RunnerActivationKeyUnavailableError();
    }
    const scopeDigest = await digest('SHA-256', new TextEncoder().encode(serverAccountScopeKeySuffix(scope)));
    // Expo SecureStore permits only alphanumeric, dot, hyphen and underscore keys.
    return `happier-runner-activation-v1.${encodeBase64(scopeDigest, 'base64url')}.${activationId}`;
}

async function verifyHandle(scope: ServerAccountScope, custody: RunnerActivationKeyCustody): Promise<void> {
    if (custody.keyHandle !== await keyHandleFor(scope, custody.activationId)) throw new RunnerActivationKeyUnavailableError();
}

/** Allocate once before activation creation and optionally bind its owning draft for failed-preparation recovery. */
export async function createRunnerActivationKeyCustody(
    scope: ServerAccountScope,
    draftId?: string,
): Promise<RunnerActivationKeyCustody> {
    const activationId = randomUUID();
    const keyHandle = await keyHandleFor(scope, activationId);
    const seed = getRandomBytes(tweetnacl.sign.seedLength);
    const pair = tweetnacl.sign.keyPair.fromSeed(seed);
    try {
        const privateKey = encodeBase64(pair.secretKey, 'base64url');
        await writeDeviceLocalStorageString(keyHandle, privateKey);
        if (await readDeviceLocalStorageString(keyHandle) !== privateKey) throw new RunnerActivationKeyUnavailableError();
        await registerRunnerCreatorCustodyActivation(scope, activationId, draftId);
        return { activationId, keyHandle, activationSigningPublicKey: encodeBase64(pair.publicKey, 'base64url') };
    } catch {
        await removeDeviceLocalStorageString(keyHandle).catch(() => undefined);
        throw new RunnerActivationKeyUnavailableError();
    } finally {
        seed.fill(0);
        pair.secretKey.fill(0);
    }
}

/** Reopen custody after remount from the synchronized public activation id. */
export async function openRunnerActivationKeyCustody(
    scope: ServerAccountScope,
    activationId: string,
): Promise<RunnerActivationKeyCustody> {
    const keyHandle = await keyHandleFor(scope, activationId);
    try {
        const encoded = await readDeviceLocalStorageString(keyHandle);
        const parsed = HappierRunnerActivationFileV1Schema.shape.activation.shape.signingPrivateKeyBase64Url.safeParse(encoded);
        if (!parsed.success) throw new RunnerActivationKeyUnavailableError();
        const secretKey = decodeBase64(parsed.data, 'base64url');
        const pair = tweetnacl.sign.keyPair.fromSecretKey(secretKey);
        try {
            return { activationId, keyHandle, activationSigningPublicKey: encodeBase64(pair.publicKey, 'base64url') };
        } finally {
            secretKey.fill(0);
            pair.secretKey.fill(0);
        }
    } catch {
        throw new RunnerActivationKeyUnavailableError();
    }
}

/** Missing/corrupt custody never creates replacement material for an existing activation. */
export async function readRunnerActivationSigningKey(scope: ServerAccountScope, custody: RunnerActivationKeyCustody): Promise<string> {
    await verifyHandle(scope, custody);
    try {
        const value = await readDeviceLocalStorageString(custody.keyHandle);
        const parsed = HappierRunnerActivationFileV1Schema.shape.activation.shape.signingPrivateKeyBase64Url.safeParse(value);
        if (!parsed.success) throw new RunnerActivationKeyUnavailableError();
        const secretKey = decodeBase64(parsed.data, 'base64url');
        const pair = tweetnacl.sign.keyPair.fromSecretKey(secretKey);
        try {
            if (encodeBase64(pair.publicKey, 'base64url') !== custody.activationSigningPublicKey) throw new RunnerActivationKeyUnavailableError();
        } finally {
            secretKey.fill(0);
            pair.secretKey.fill(0);
        }
        return parsed.data;
    } catch {
        throw new RunnerActivationKeyUnavailableError();
    }
}

/** Caller owns acknowledged closure/verified claim; deletion never changes draft state. */
export async function removeRunnerActivationKeyCustody(scope: ServerAccountScope, custody: RunnerActivationKeyCustody): Promise<void> {
    await verifyHandle(scope, custody);
    try {
        await removeDeviceLocalStorageString(custody.keyHandle);
    } catch {
        throw new RunnerActivationKeyUnavailableError();
    }
}

/** Removes exact creator custody after an authoritative close when only its public id remains. */
export async function removeRunnerActivationKeyCustodyByActivationId(
    scope: ServerAccountScope,
    activationId: string,
): Promise<void> {
    try {
        await removeDeviceLocalStorageString(await keyHandleFor(scope, activationId));
    } catch {
        throw new RunnerActivationKeyUnavailableError();
    }
}
