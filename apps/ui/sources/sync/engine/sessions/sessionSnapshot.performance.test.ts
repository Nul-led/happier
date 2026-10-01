import { cpus, platform, arch } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import {
    projectLegacySessionAccessCapabilitiesV1,
    SessionListQueryResponseV1Schema,
    type SessionListQueryResponseV1,
    type SessionListQueryV1,
} from '@happier-dev/protocol';

import { encodeBase64 } from '@/encryption/base64';
import { Encryption } from '@/sync/encryption/encryption';
import { createSessionListQueryHomeController } from '@/sync/domains/session/listing/sessionListQueryController';
import { buildSessionListQueryKey } from '@/sync/domains/session/listing/sessionListQueryKey';
import { storage } from '@/sync/domains/state/storage';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

import { fetchAndApplySessions } from './sessionSnapshot';

const QUERY: SessionListQueryV1 = {
    v: 1, storage: 'active', includeInactive: true, scope: 'my_work',
    attention: 'any', audiences: [], tagIds: [],
};
const initialState = storage.getState();

afterEach(() => {
    storage.setState(initialState, true);
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
        const rows = await Promise.all(Array.from({ length: 50 }, async (_, rowIndex): Promise<SessionListQueryResponseV1['sessions'][number]> => {
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
                effectiveAccess: {
                    v: 1, level: 'owner', sources: [{ kind: 'owner' }],
                    capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'owner' }),
                },
                viewer: {
                    readState: { state: 'not_started' },
                    relevance: { relevant: true, reasons: ['owned_by_me'] },
                    attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
                    follow: { follows: false, notificationLevel: 'none' },
                    notification: { level: 'none', source: 'preference' },
                },
                responsibleAccountId: null,
                responsibleAccount: null,
            };
        }));
        // Validate the complete HTTP fixture before either timed workload. Strict
        // queries require current viewer/access/responsibility and both frontiers.
        const queryBody = JSON.stringify(SessionListQueryResponseV1Schema.parse({
            sessions: rows, nextCursor: null, hasNext: false,
            attentionNextCursor: null, attentionHasNext: false,
        }));
        const ordinaryBody = JSON.stringify({ sessions: rows, nextCursor: null, hasNext: false });
        return {
            encryption, serverId: `home-${homeIndex}`,
            sessionDataKeys: new Map<string, Uint8Array>(), sessionDataKeyEnvelopes: new Map<string, string>(),
            request: async (path: string) => new Response(
                path === '/v2/sessions/query' ? queryBody : ordinaryBody,
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        };
    }));

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
            request: home.request,
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
        fetchPage: async ({ source, signal, membership }) => {
            requests += 1;
            return fetchAndApplySessions({
                serverId: home.serverId, source, signal,
                credentials: { token: 'benchmark', secret: encodeBase64(new Uint8Array(32).fill(1), 'base64') },
                encryption: home.encryption,
                sessionDataKeys: home.sessionDataKeys,
                sessionDataKeyEnvelopes: home.sessionDataKeyEnvelopes,
                request: home.request,
                shouldContinue: () => !signal.aborted,
                getExistingSession: () => null,
                getCurrentSessionListRenderable: (sessionId) => (
                    storage.getState().sessionListRowsByServerId[home.serverId]?.[sessionId] ?? null
                ),
                applySessionListRenderables: (rows) => {
                    if (signal.aborted) return;
                    storage.getState().applyServerScopedSessionListRows(home.serverId, rows, {
                        source: membership, mode: 'replace',
                    });
                },
                applySessionListRenderablePatches: (patches) => {
                    if (signal.aborted) return;
                    storage.getState().applyServerScopedSessionListRowPatches(home.serverId, patches);
                },
                // Production query adapters publish scoped rows and patches, never full Sessions.
                applySessions() {},
                log: { log() {} },
            });
        },
    }));
    const rapidStarted = performance.now();
    const pending: Promise<void>[] = [];
    try {
        for (let change = 0; change < 5; change += 1) {
            for (const controller of controllers) {
                pending.push(controller.update({
                    query: { ...QUERY, tagIds: [`tag-${change}`] },
                    selected: true, online: true, supported: true,
                }));
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await Promise.all(pending);
        const rapidQueryMs = performance.now() - rapidStarted;
        // The controller derives corpus identity itself and refuses a caller's, so the
        // settled key is the canonical one for the last requested query — asserted
        // through its owner rather than a literal the controller can never produce.
        const lastQuery: SessionListQueryV1 = { ...QUERY, tagIds: ['tag-4'] };
        for (const home of homes.map((home, index) => ({ home, controller: controllers[index]! }))) {
            expect(home.controller.getSnapshot()).toMatchObject({ phase: 'ready', failureCode: null });
            expect(home.controller.getSnapshot().appliedQueryKey)
                .toBe(buildSessionListQueryKey(home.home.serverId, lastQuery));
            expect(home.controller.getSnapshot().addresses).toHaveLength(50);
            expect(storage.getState().ordinarySessionListMembershipByServerId[home.home.serverId]).toBeUndefined();
        }
        console.info('SESSION_HYDRATION_MEASUREMENT', JSON.stringify({
            platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
            homes: 3, rowsPerHome: 50, metadataAndAgentStateCiphertexts: 300,
            crypto: 'real libsodium + WebCrypto AES; native worker off',
            hydrationMs, hydration, rapidChangesPerHome: 5, requests, rapidQueryMs,
            rapidHydration: measurements(),
        }));
    } finally {
        controllers.forEach((controller) => controller.dispose());
        await Promise.allSettled(pending);
    }
}, 60_000);
