import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { encodeBase64 } from '@/encryption/base64';
import { approveTerminalPairing } from './approveTerminalPairing';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('approveTerminalPairing transport ownership', () => {
    it('rejects retained key material when the target Account is plain before issuing an approval', async () => {
        const request = vi.fn(async (path: string) => jsonResponse(
            path === '/v1/account/encryption' ? { mode: 'plain', updatedAt: 0 }
                : path.startsWith('/v1/auth/request/status') ? { status: 'pending', supportsV2: true }
                    : { success: true },
        ));
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_plain_home',
            canonicalServerUrl: 'https://plain.example.test',
            revision: 1,
            endpoints: [{ kind: 'https' as const, url: 'https://plain.example.test' }],
        };
        const transport = {
            descriptor,
            canonicalServerUrl: descriptor.canonicalServerUrl,
            homeServerIdentityId: descriptor.homeServerIdentityId,
            endpointUrl: descriptor.canonicalServerUrl,
            runtimeOrigin: descriptor.canonicalServerUrl,
            carrier: 'https' as const,
            authenticatedCredentialDestination: { kind: 'https' as const, applicationUrl: descriptor.canonicalServerUrl },
            createRequest: () => request,
            close: async () => {},
        } satisfies HomeEnrollmentTransport;
        const machineKey = new Uint8Array(32).fill(3);
        await expect(approveTerminalPairing({
            target: transport,
            requesterPublicKey: tweetnacl.box.keyPair().publicKey,
            pairingContext: { secret: new Uint8Array(32).fill(7), createdAtMs: 1000, expiresAtMs: 61000 },
            targetCredentials: {
                token: 'plain-account-token',
                encryption: { machineKey: encodeBase64(machineKey), publicKey: encodeBase64(tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey) },
            },
            supportsTokenOnly: true,
        })).rejects.toThrow(/Account.*mode/);
        expect(request.mock.calls.some(([path]) => path === '/v1/auth/response')).toBe(false);
    });

    it('uses the resolved Home transport for status and approval requests', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ mode: 'e2ee', updatedAt: 0 }))
            .mockResolvedValueOnce(jsonResponse({ status: 'pending', supportsV2: true }))
            .mockResolvedValueOnce(jsonResponse({ success: true }));
        const createRequest = vi.fn(() => request);
        const transport = {
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.example.test',
                revision: 1,
                endpoints: [{ kind: 'iroh', endpointId: 'iroh-home-b' }],
            },
            canonicalServerUrl: 'https://home-b.example.test',
            homeServerIdentityId: 'srv_home_b',
            endpointUrl: 'https://home-b.example.test',
            runtimeOrigin: 'http://127.0.0.1:43123',
            carrier: 'iroh',
            authenticatedCredentialDestination: {
                kind: 'iroh',
                endpointId: 'iroh-home-b',
            },
            createRequest,
            close: vi.fn(async () => {}),
        } satisfies HomeEnrollmentTransport;
        const machineKey = new Uint8Array(32).fill(3);
        const publicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;

        await expect(approveTerminalPairing({
            target: transport,
            requesterPublicKey: tweetnacl.box.keyPair().publicKey,
            pairingContext: {
                secret: new Uint8Array(32).fill(7),
                createdAtMs: 1_000,
                expiresAtMs: 61_000,
            },
            targetCredentials: {
                token: 'home-b-token',
                encryption: {
                    publicKey: encodeBase64(publicKey),
                    machineKey: encodeBase64(machineKey),
                },
            },
            supportsTokenOnly: false,
        })).resolves.toBe('approved');

        expect(createRequest).toHaveBeenCalledWith({ credentials: null });
        expect(request.mock.calls.map((call) => call[0])).toEqual([
            '/v1/account/encryption',
            expect.stringContaining('/v1/auth/request/status?publicKey='),
            '/v1/auth/response',
        ]);
    });
});
