import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/ui/logger';
import { createSessionClientUsageObservationPublisher } from './createSessionClientUsageObservationPublisher';

const input = {
    sessionId: 'session-usage', externalKey: 'native-record-1',
    observation: {
        provider: 'claude', source: 'claude-assistant-usage', scope: 'turn_delta' as const,
        key: 'claude-session', modelId: null,
        tokens: { total: 12, input: 7, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: null, contextUsedTokens: null, contextWindowTokens: null,
    },
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Session usage transport publisher', () => {
    it('returns a failure and warns when the advertised HTTP transport fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            features: {}, capabilities: { server: { usageAnalytics: {
                version: 1, eventsIngest: { path: '/v2/usage-events' }, query: { path: '/v2/usage/query' },
                legacy: { usageReportsPath: '/v2/usage-reports', usageQueryPath: '/v1/usage/query' },
            } } },
        }), { headers: { 'content-type': 'application/json' } })));
        vi.spyOn(axios, 'post').mockRejectedValue(new Error('usage network failed'));
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const publisher = createSessionClientUsageObservationPublisher({
            token: 'token',
            transport: { serverId: 'home', serverUrl: 'https://usage-failure.example.test', createSessionSocketTransport: () => { throw new Error('unused'); } },
            getSocket: () => ({ connected: true, emit: vi.fn() }),
        });

        await expect(publisher.publish(input)).resolves.toEqual({ status: 'failed' });
        expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'usage network failed' }));
    });

    it('reports a disconnected legacy socket as a failure without sending the report', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const emit = vi.fn();
        const publisher = createSessionClientUsageObservationPublisher({
            token: 'token',
            transport: { serverId: 'home', serverUrl: 'https://usage-offline.example.test', createSessionSocketTransport: () => { throw new Error('unused'); } },
            getSocket: () => ({ connected: false, emit }),
        });

        await expect(publisher.publish(input)).resolves.toEqual({ status: 'failed' });
        expect(warn).toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });
});
