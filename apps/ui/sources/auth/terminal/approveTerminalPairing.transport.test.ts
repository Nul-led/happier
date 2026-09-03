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
    it('uses the resolved Home transport for status and approval requests', async () => {
        const request = vi.fn()
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
            expect.stringContaining('/v1/auth/request/status?publicKey='),
            '/v1/auth/response',
        ]);
    });
});
