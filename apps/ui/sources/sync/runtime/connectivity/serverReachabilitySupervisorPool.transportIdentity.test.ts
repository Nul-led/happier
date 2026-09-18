import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HomeCarrier } from '@/sync/runtime/homeCarrier';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';

import {
    peekServerReachabilityState,
    resetServerReachabilitySupervisors,
    startServerReachabilitySupervisor,
    subscribeServerReachabilityState,
} from './serverReachabilitySupervisorPool';

function carrierForEndpoint(endpointId: string): HomeCarrier {
    // A fresh object each call: a re-leased carrier is a new object for the same endpoint.
    return {
        endpointId,
        readObservedPath: () => 'relay',
        request: async () => new Response(null, { status: 200, headers: new Headers() }),
        createWebSocket: () => ({}),
    };
}

describe('serverReachabilitySupervisorPool (transport identity)', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(async () => {
        resetRuntimeFetch();
        await resetServerReachabilitySupervisors();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('treats a runtime origin equal to the server URL as the same transport', async () => {
        setRuntimeFetch(async () => new Response(null, { status: 200, headers: new Headers() }));
        const serverUrl = 'https://example.test';
        const phases: string[] = [];
        const unsubscribe = subscribeServerReachabilityState(serverUrl, (state) => {
            phases.push(state.phase);
        }, null);

        try {
            // The socket owner starts the supervisor without a distinct runtime origin.
            await startServerReachabilitySupervisor({ serverUrl, token: null });
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');

            phases.length = 0;

            // A plain request path starts the same entry and spells the very same transport
            // out explicitly. That is not a transport change, so the supervisor — and the
            // sync socket that mirrors its state — must not be torn down and rebuilt.
            await startServerReachabilitySupervisor({ serverUrl, token: null, runtimeOrigin: serverUrl });

            expect(phases).not.toContain('shutting_down');
            expect(phases).not.toContain('connecting');
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');
        } finally {
            unsubscribe();
        }
    });

    it('still re-probes when the runtime origin names a genuinely different transport', async () => {
        setRuntimeFetch(async () => new Response(null, { status: 200, headers: new Headers() }));
        const serverUrl = 'https://example.test';
        const phases: string[] = [];
        const unsubscribe = subscribeServerReachabilityState(serverUrl, (state) => {
            phases.push(state.phase);
        }, null);

        try {
            await startServerReachabilitySupervisor({ serverUrl, token: null });
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');

            phases.length = 0;

            await startServerReachabilitySupervisor({
                serverUrl,
                token: null,
                runtimeOrigin: 'https://tunnel.example.test',
            });

            expect(phases).toContain('shutting_down');
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');
        } finally {
            unsubscribe();
        }
    });
    it('treats a re-leased carrier for the same endpoint as the same transport', async () => {
        setRuntimeFetch(async () => new Response(null, { status: 200, headers: new Headers() }));
        const serverUrl = 'https://example.test';
        const phases: string[] = [];
        const unsubscribe = subscribeServerReachabilityState(serverUrl, (state) => {
            phases.push(state.phase);
        }, null);

        try {
            await startServerReachabilitySupervisor({
                serverUrl,
                token: null,
                homeCarrier: carrierForEndpoint('endpoint-a'),
            });
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');

            phases.length = 0;

            // Same endpoint, second object: the carrier owner re-leased it, the transport did not change.
            await startServerReachabilitySupervisor({
                serverUrl,
                token: null,
                homeCarrier: carrierForEndpoint('endpoint-a'),
            });

            expect(phases).not.toContain('shutting_down');
            expect(phases).not.toContain('connecting');
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');
        } finally {
            unsubscribe();
        }
    });

    it('still re-probes when the carrier proves a different endpoint', async () => {
        setRuntimeFetch(async () => new Response(null, { status: 200, headers: new Headers() }));
        const serverUrl = 'https://example.test';
        const phases: string[] = [];
        const unsubscribe = subscribeServerReachabilityState(serverUrl, (state) => {
            phases.push(state.phase);
        }, null);

        try {
            await startServerReachabilitySupervisor({
                serverUrl,
                token: null,
                homeCarrier: carrierForEndpoint('endpoint-a'),
            });
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');

            phases.length = 0;

            await startServerReachabilitySupervisor({
                serverUrl,
                token: null,
                homeCarrier: carrierForEndpoint('endpoint-b'),
            });

            expect(phases).toContain('shutting_down');
            expect(peekServerReachabilityState(serverUrl, null)?.phase).toBe('online');
        } finally {
            unsubscribe();
        }
    });
});
