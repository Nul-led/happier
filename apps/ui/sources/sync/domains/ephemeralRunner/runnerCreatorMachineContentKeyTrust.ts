import { z } from 'zod';

import { RunnerPublicKeySchema } from '@happier-dev/protocol/ephemeralRunner/activation';
import {
    readDeviceLocalStorageString,
    writeDeviceLocalStorageString,
} from '@/auth/storage/deviceLocalStorage';
import { encodeBase64 } from '@/encryption/base64';
import { digest } from '@/platform/digest';
import {
    createServerAccountScope,
    serverAccountScopedResourceKey,
    serverAccountScopeKeySuffix,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';

/**
 * Creator-local verifier custody for a Temporary computer's Machine content key.
 *
 * The Machine-content-key proof is signed by the creator-generated activation
 * signing identity. A later read of the published Machine row — on the creating
 * device — can only trust that proof if it recovers the activation public key
 * from its own storage: a Home-relayed verifier identity would let a Home
 * substitute verifier key, binding and an Account-openable envelope together.
 * This module is that storage, and it holds only non-secret public material.
 *
 * The Machine resolver that consumes it is synchronous, so reads are served
 * from an in-memory projection of the same device-local record; a miss loads
 * the record and fails closed until it is present.
 */
export type RunnerCreatorMachineContentKeyTrustV1 = Readonly<{
    activationId: string;
    activationSigningPublicKey: string;
}>;

type StoredRunnerCreatorMachineContentKeyTrustV1 = Readonly<{
    v: 1;
    activationId: string;
    activationSigningPublicKey: string;
}>;

const STORAGE_PREFIX = 'happier-runner-machine-trust-v1';

const trustByScopedMachine = new Map<string, RunnerCreatorMachineContentKeyTrustV1 | null>();
const pendingLoads = new Map<string, Promise<void>>();

function memoKey(scope: ServerAccountScope, machineId: string): string {
    return serverAccountScopedResourceKey(scope, machineId);
}

async function storageKey(scope: ServerAccountScope, machineId: string): Promise<string> {
    const scopeDigest = await digest('SHA-256', new TextEncoder().encode(serverAccountScopeKeySuffix(scope)));
    const machineDigest = await digest('SHA-256', new TextEncoder().encode(machineId));
    // Expo SecureStore permits only alphanumeric, dot, hyphen and underscore keys.
    return `${STORAGE_PREFIX}.${encodeBase64(scopeDigest, 'base64url')}.${encodeBase64(machineDigest, 'base64url')}`;
}

function parseStored(value: string | null): RunnerCreatorMachineContentKeyTrustV1 | null {
    if (!value) return null;
    let record: unknown;
    try {
        record = JSON.parse(value);
    } catch {
        return null;
    }
    if (!record || typeof record !== 'object') return null;
    const row = record as Partial<StoredRunnerCreatorMachineContentKeyTrustV1>;
    if (row.v !== 1) return null;
    const activationId = z.string().uuid().safeParse(row.activationId);
    const publicKey = RunnerPublicKeySchema.safeParse(row.activationSigningPublicKey);
    if (!activationId.success || !publicKey.success) return null;
    return { activationId: activationId.data, activationSigningPublicKey: publicKey.data };
}

/** Retains the exact verifier identity for a Machine the creator just proved. */
export async function retainRunnerCreatorMachineContentKeyTrust(input: Readonly<{
    scope: Readonly<{ homeServerIdentityId: string; creatorAccountId: string }>;
    machineId: string;
    activationId: string;
    activationSigningPublicKey: string;
}>): Promise<void> {
    const scope = createServerAccountScope(input.scope.homeServerIdentityId, input.scope.creatorAccountId);
    const machineId = input.machineId.trim();
    if (!scope || !machineId) return;
    const record: StoredRunnerCreatorMachineContentKeyTrustV1 = {
        v: 1,
        activationId: input.activationId,
        activationSigningPublicKey: input.activationSigningPublicKey,
    };
    await writeDeviceLocalStorageString(await storageKey(scope, machineId), JSON.stringify(record));
    trustByScopedMachine.set(memoKey(scope, machineId), {
        activationId: record.activationId,
        activationSigningPublicKey: record.activationSigningPublicKey,
    });
}

/** Loads the device-local record into the projection the synchronous reader serves. */
export async function loadRunnerCreatorMachineContentKeyTrust(
    scope: ServerAccountScope,
    machineId: string,
): Promise<RunnerCreatorMachineContentKeyTrustV1 | null> {
    const key = memoKey(scope, machineId);
    let trust: RunnerCreatorMachineContentKeyTrustV1 | null = null;
    try {
        trust = parseStored(await readDeviceLocalStorageString(await storageKey(scope, machineId)));
    } catch {
        trust = null;
    }
    trustByScopedMachine.set(key, trust);
    return trust;
}

/**
 * Synchronous creator-local verifier lookup.
 *
 * Returns `null` while the record has not been loaded yet and schedules that
 * load, so the first refresh after a remount fails closed and the next one
 * carries the proof.
 */
export function readRunnerCreatorMachineContentKeyTrust(
    scope: ServerAccountScope,
    machineId: string,
): RunnerCreatorMachineContentKeyTrustV1 | null {
    const key = memoKey(scope, machineId);
    const known = trustByScopedMachine.get(key);
    if (known !== undefined) return known;
    if (!pendingLoads.has(key)) {
        const load = loadRunnerCreatorMachineContentKeyTrust(scope, machineId)
            .catch(() => undefined)
            .then(() => {
                pendingLoads.delete(key);
            });
        pendingLoads.set(key, load);
    }
    return null;
}

/** Test-only: drops the in-memory projection so a case starts from storage. */
export function resetRunnerCreatorMachineContentKeyTrustProjectionForTests(): void {
    trustByScopedMachine.clear();
    pendingLoads.clear();
}
