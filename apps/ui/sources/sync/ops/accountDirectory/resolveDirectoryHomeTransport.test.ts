import { describe, expect, it } from 'vitest';

import { resolveDirectoryHomeTransport } from './resolveDirectoryHomeTransport';

describe('resolveDirectoryHomeTransport', () => {
    it('keeps canonical identity separate from an approved public HTTPS origin', async () => {
        expect(await resolveDirectoryHomeTransport({
            v: 1,
            homeServerIdentityId: 'home-1',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [
                { kind: 'https', url: 'http://localhost:3010' },
                { kind: 'https', url: 'https://home.example.test' },
            ],
        })).toMatchObject({
            ok: true,
            descriptor: expect.objectContaining({ homeServerIdentityId: 'home-1' }),
            canonicalServerUrl: 'http://localhost:3010',
            endpointUrl: 'https://home.example.test',
            runtimeOrigin: 'https://home.example.test',
            homeServerIdentityId: 'home-1',
        });
    });

    it('returns the typed Iroh carrier blocker when the native carrier is unavailable', async () => {
        expect(await resolveDirectoryHomeTransport({
            v: 1,
            homeServerIdentityId: 'home-iroh',
            canonicalServerUrl: 'http://localhost:3010',
            revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
        })).toEqual({
            ok: false,
            homeServerIdentityId: 'home-iroh',
            reason: 'iroh_target_transport_unavailable',
        });
    });
});
