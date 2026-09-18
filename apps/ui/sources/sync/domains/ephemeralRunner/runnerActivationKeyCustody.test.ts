import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import {
    createRunnerActivationKeyCustody,
    openRunnerActivationKeyCustody,
    readRunnerActivationSigningKey,
    removeRunnerActivationKeyCustody,
    removeRunnerActivationKeyCustodyByActivationId,
} from './runnerActivationKeyCustody';
import { listRunnerCreatorCustodyActivationIds } from './runnerCreatorLaunchCustody';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const scope = { serverId: 'home-a', accountId: 'creator-a' } as const;
let values: Map<string, string>;

beforeEach(() => {
    values = new Map();
    vi.stubGlobal('window', { localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    } });
});
afterEach(() => vi.unstubAllGlobals());

describe('creator activation signing-key custody', () => {
    it('reopens custody after remount from only the synchronized public id', async () => {
        const created = await createRunnerActivationKeyCustody(scope);
        await expect(openRunnerActivationKeyCustody(scope, created.activationId)).resolves.toEqual(created);
        await expect(listRunnerCreatorCustodyActivationIds(scope)).resolves.toEqual([created.activationId]);
        await expect(listRunnerCreatorCustodyActivationIds({ ...scope, accountId: 'other' })).resolves.toEqual([]);
    });

    it('returns only a public identity and exact local handle, then reads the same one-time key', async () => {
        const custody = await createRunnerActivationKeyCustody(scope);
        const secret = await readRunnerActivationSigningKey(scope, custody);
        expect(Object.keys(custody).sort()).toEqual(['activationId', 'activationSigningPublicKey', 'keyHandle']);
        expect(JSON.stringify(custody)).not.toContain(secret);
        const pair = tweetnacl.sign.keyPair.fromSecretKey(decodeBase64(secret, 'base64url'));
        expect(encodeBase64(pair.publicKey, 'base64url')).toBe(custody.activationSigningPublicKey);
        expect(await readRunnerActivationSigningKey(scope, custody)).toBe(secret);
        // Expo SecureStore's actual key contract applies on native clients too.
        expect([...values.keys()].every(key => /^[\w.-]+$/.test(key))).toBe(true);
    });

    it('isolates Home/Account custody and never regenerates a missing or substituted identity', async () => {
        const custody = await createRunnerActivationKeyCustody(scope);
        await expect(readRunnerActivationSigningKey({ ...scope, accountId: 'other' }, custody)).rejects.toMatchObject({ code: 'runner_activation_key_unavailable' });
        await expect(readRunnerActivationSigningKey({ ...scope, serverId: 'other' }, custody)).rejects.toMatchObject({ code: 'runner_activation_key_unavailable' });
        await expect(readRunnerActivationSigningKey(scope, { ...custody, activationSigningPublicKey: 'substituted' })).rejects.toMatchObject({ code: 'runner_activation_key_unavailable' });
        const second = await createRunnerActivationKeyCustody(scope);
        await removeRunnerActivationKeyCustody(scope, custody);
        await removeRunnerActivationKeyCustody(scope, custody);
        await expect(readRunnerActivationSigningKey(scope, custody)).rejects.toMatchObject({ code: 'runner_activation_key_unavailable' });
        expect(await readRunnerActivationSigningKey(scope, second)).toBeTruthy();
    });

    it('removes acknowledged creator custody from only the synchronized public activation id', async () => {
        const custody = await createRunnerActivationKeyCustody(scope);
        await removeRunnerActivationKeyCustodyByActivationId(scope, custody.activationId);
        await expect(openRunnerActivationKeyCustody(scope, custody.activationId)).rejects.toMatchObject({
            code: 'runner_activation_key_unavailable',
        });
    });

    it('fails closed and removes only unverified new custody when readback does not match', async () => {
        const retained = await createRunnerActivationKeyCustody(scope);
        const storage = window.localStorage;
        const originalSet = storage.setItem;
        vi.spyOn(storage, 'setItem').mockImplementation((key, value) => originalSet(key, `${value}corrupt`));
        await expect(createRunnerActivationKeyCustody(scope)).rejects.toMatchObject({ code: 'runner_activation_key_unavailable' });
        // The retained activation consists of its protected key plus the
        // Account-scoped public locator used by acknowledged Account erasure.
        expect(values.size).toBe(2);
        expect(await readRunnerActivationSigningKey(scope, retained)).toBeTruthy();
    });
});
