import { afterEach, expect, it, vi } from 'vitest';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { fetchAccountEncryptionCurrentness } from './apiAccountEncryptionMode';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

afterEach(() => { vi.restoreAllMocks(); });

it('keeps captured-Home readiness failure out of the selected Home recovery flow', async () => {
    await upsertAndActivateServer({ serverUrl: 'https://selected-currentness.test', scope: 'tab' });
    const credentials = { token: 'captured-token', secret: encodeBase64(new Uint8Array(32).fill(24), 'base64url') };
    const selectedCredentials = vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(null);
    const request = vi.fn(async () => new Response(JSON.stringify({ error: 'migration-required',
        recipientEnvelopeReadiness: { status: 'unavailable', reason: 'encryption_setup_required' },
    }), { status: 400 }));
    await expect(fetchAccountEncryptionCurrentness(credentials, { request })).rejects.toMatchObject({
        code: 'account-encryption-currentness-unavailable',
        recipientEnvelopeReadiness: { status: 'unavailable', reason: 'encryption_setup_required' },
    });
    expect(selectedCredentials).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
});
