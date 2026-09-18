import { cpus, platform, arch } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { V2SessionRecord, SessionListQueryV1 } from '@happier-dev/protocol';

import { encodeBase64 } from '@/encryption/base64';
import { Encryption } from '@/sync/encryption/encryption';
import { createSessionListQueryHomeController } from '@/sync/domains/session/listing/sessionListQueryController';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

import { fetchAndApplySessions } from './sessionSnapshot';

const QUERY: SessionListQueryV1 = {
    v: 1, storage: 'active', includeInactive: true, scope: 'my_work',
    attention: 'any', audiences: [], tagIds: [],
};

afterEach(() => {
    syncPerformanceTelemetry.configure({ enabled: false });
    syncPerformanceTelemetry.reset();
});

function measurements() {
    return syncPerformanceTelemetry.snapshot().events
        .filter((event) => /decryptDataKeys|initializeSessions|decryptRows|decryptRow$/.test(event.name))
        .map(({ name, count, totalMs, maxMs }) => ({ name, count, totalMs, maxMs }));
}

it('measures real encrypted hydration and rapid query replacement across three fifty-row Homes', async () => {
    // Only HTTP is substituted. The repository Node adapters execute real libsodium
    // envelope opens and WebCrypto AES; this does not measure a native bridge.
    const homes = await Promise.all(Array.from({ length: 3 }, async (_, homeIndex) => {
        const encryption = await Encryption.create(new Uint8Array(32).fill(homeIndex + 1));
        encryption.configureNativeCryptoWorker({ routing: { mode: 'off' } });
        const rows = await Promise.all(Array.from({ length: 50 }, async (_, rowIndex): Promise<V2SessionRecord> => {
            const id = `session-${rowIndex}`;
            const key = new Uint8Array(32).fill(rowIndex + 10);
            const cipher = await encryption.openEncryption(key);
            const encrypted = await cipher.encrypt([
                { path: `/workspace/project-${rowIndex % 10}`, host: `home-${homeIndex}`, summary: { text: `Session ${rowIndex}`, updatedAt: 1 } },
                { requests: {}, completedRequests: {} },
            ]);
            return {
                id, seq: 1, createdAt: 1, updatedAt: 2, active: false, activeAt: 2,
                archivedAt: null, encryptionMode: 'e2ee',
                metadata: encodeBase64(encrypted[0]!, 'base64'), metadataVersion: 1,
                agentState: encodeBase64(encrypted[1]!, 'base64'), agentStateVersion: 1,
                dataEncryptionKey: encodeBase64(await encryption.encryptEncryptionKey(key), 'base64'),
                share: null,
            };
        }));
        return {
            encryption, rows, serverId: `home-${homeIndex}`,
            sessionDataKeys: new Map<string, Uint8Array>(), sessionDataKeyEnvelopes: new Map<string, string>(),
        };
    }));
    const requestFor = (rows: V2SessionRecord[]) => async () => new Response(JSON.stringify({
        sessions: rows, nextCursor: null, hasNext: false,
    }), { status: 200 });

    syncPerformanceTelemetry.configure({ enabled: true });
    syncPerformanceTelemetry.reset();
    const started = performance.now();
    const hydrated = await Promise.all(homes.map(async (home) => {
        const titles: string[] = [];
        await fetchAndApplySessions({
            serverId: home.serverId,
            credentials: { token: 'benchmark', secret: encodeBase64(new Uint8Array(32).fill(1), 'base64') },
            encryption: home.encryption,
            sessionDataKeys: home.sessionDataKeys,
            sessionDataKeyEnvelopes: home.sessionDataKeyEnvelopes,
            request: requestFor(home.rows),
            sessionListHydrationConcurrencyLimit: 4,
            applySessions: (rows) => titles.push(...rows.map((row) => row.metadata?.summary?.text ?? 'unreadable')),
            log: { log() {} },
        });
        expect(titles).toHaveLength(50);
        expect(titles).not.toContain('unreadable');
        return titles.length;
    }));
    const hydrationMs = performance.now() - started;
    const hydration = measurements();
    expect(hydrated.reduce((sum, count) => sum + count, 0)).toBe(150);

    syncPerformanceTelemetry.reset();
    let requests = 0;
    const controllers = homes.map((home) => createSessionListQueryHomeController({
        serverId: home.serverId,
        fetchPage: async ({ source, signal }) => {
            requests += 1;
            return fetchAndApplySessions({
                serverId: home.serverId, source,
                credentials: { token: 'benchmark', secret: encodeBase64(new Uint8Array(32).fill(1), 'base64') },
                encryption: home.encryption,
                sessionDataKeys: home.sessionDataKeys,
                sessionDataKeyEnvelopes: home.sessionDataKeyEnvelopes,
                request: requestFor(home.rows),
                shouldContinue: () => !signal.aborted,
                applySessions() { throw new Error('Query hydration must not enter ordinary membership'); },
                log: { log() {} },
            });
        },
    }));
    const rapidStarted = performance.now();
    const pending: Promise<void>[] = [];
    for (let change = 0; change < 5; change += 1) {
        for (const controller of controllers) {
            pending.push(controller.update({
                queryKey: `query-${change}`, query: { ...QUERY, tagIds: [`tag-${change}`] },
                selected: true, online: true, supported: true,
            }));
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(pending);
    const rapidQueryMs = performance.now() - rapidStarted;
    for (const controller of controllers) {
        expect(controller.getSnapshot().appliedQueryKey).toBe('query-4');
        expect(controller.getSnapshot().addresses).toHaveLength(50);
        controller.dispose();
    }
    console.info('SESSION_HYDRATION_MEASUREMENT', JSON.stringify({
        platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
        homes: 3, rowsPerHome: 50, metadataAndAgentStateCiphertexts: 300,
        crypto: 'real libsodium + WebCrypto AES; native worker off',
        hydrationMs, hydration, rapidChangesPerHome: 5, requests, rapidQueryMs,
        rapidHydration: measurements(),
    }));
}, 60_000);
