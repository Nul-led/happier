import { TokenStorage, subscribeHomeCredentialMutations } from '@/auth/storage/tokenStorage';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { captureActiveServerAccountScopeCurrentness } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerProfileIdentifiersEquivalent, getServerProfileById, resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { areAccountSettingsScopesEqual } from '@/sync/domains/settings/scope/accountSettingsScope';
import { storage } from '@/sync/domains/state/storage';
import { loadAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';
import { readAccountSettingsBaseline } from '@/sync/engine/settings/accountSettingsBaseline';
import { settingsParse, type Settings } from '@/sync/domains/settings/settings';
import { createServerFetchAtEndpoint, type ServerFetch } from '@/sync/http/client';
import { resolveServerScopedTransport } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedTransport';
import { getAppliedActiveServerSnapshot } from '@/sync/runtime/orchestration/connectionManager';
import { mergeAbortSignals } from '@/utils/runtime/abortSignals';
import { parseToken } from '@/utils/auth/parseToken';
import { createArtifactWithHeaderViaApi, fetchArtifactWithBodyFromApi, updateArtifactWithHeaderViaApi, type ArtifactDataKeyCache } from '@/sync/engine/artifacts/syncArtifacts';
import type { ArtifactHeader, DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

/** Bind a shared Action invocation to the requested Home before policy or artifact reads. */
export async function captureActionAccountContext(serverIdRaw: string, signal?: AbortSignal) {
    const serverId = resolveServerProfileScopeIdForIdentifier(serverIdRaw);
    const profile = getServerProfileById(serverId);
    if (!profile) throw new Error('action_home_not_found');
    const serverIdentityId = profile.serverIdentityId?.trim() || undefined;
    const applied = getAppliedActiveServerSnapshot();
    const currentness = areServerProfileIdentifiersEquivalent(applied.serverId, serverId)
        ? captureActiveServerAccountScopeCurrentness() : null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const watch = () => {
        const retirement = currentness?.onRetire(abort);
        const unsubscribe = subscribeHomeCredentialMutations((event) => {
            if (areServerProfileIdentifiersEquivalent(event.serverId, serverId)) abort();
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        return () => {
            retirement?.dispose();
            unsubscribe();
            signal?.removeEventListener('abort', abort);
        };
    };
    const dispose = watch();
    const assertCurrent = () => {
        if (controller.signal.aborted || (currentness && !currentness.isCurrent())) {
            throw Object.assign(new Error('action_account_scope_changed'), { code: 'action_account_scope_changed' });
        }
    };
    try {
        const credentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId });
        assertCurrent();
        if (!credentials) throw new Error('action_home_signed_out');
        const accountId = parseToken(credentials.token);
        const scope = { serverId, accountId };
        // Every Action owns an explicit Home target. Resolve it through the
        // canonical scoped carrier so a staged focus change cannot retarget an
        // Action through the ambient focused request path.
        const request: ServerFetch = async (path, init, options) => {
            assertCurrent();
            const cancellation = mergeAbortSignals([controller.signal, init?.signal ?? undefined]);
            try {
                const requestInit = { ...init, signal: cancellation.signal };
                const transport = await resolveServerScopedTransport({ profile, credentials });
                try {
                    assertCurrent();
                    const response = await createServerFetchAtEndpoint({
                        endpointUrl: transport.canonicalServerUrl,
                        runtimeOrigin: transport.runtimeOrigin,
                        serverId,
                        credentials,
                        signal: cancellation.signal,
                        ...(transport.homeCarrier ? { homeCarrier: transport.homeCarrier } : {}),
                    })(path, requestInit, options);
                    assertCurrent();
                    return response;
                } finally {
                    try { await transport.release(); } finally { assertCurrent(); }
                }
            } finally {
                cancellation.dispose();
            }
        };
        const accountMode = (await fetchAccountEncryptionMode(credentials, { request })).mode;
        const encryption = accountMode === 'plain' ? null : await createEncryptionFromAuthCredentials(credentials);
        assertCurrent();
        // The existing artifact codec requires an invocation-local key map. Never reuse the
        // focused sync singleton's Account-owned keys or publish a background Home into it.
        const artifactDataKeys: ArtifactDataKeyCache = new Map();
        const canPublish = () => {
            assertCurrent();
            return areAccountSettingsScopesEqual(storage.getState().settingsScope, scope);
        };
        const artifactParams = { request, serverId, credentials, encryption, artifactDataKeys };
        const fetchArtifact = async (artifactId: string) => {
            const artifact = await fetchArtifactWithBodyFromApi({ ...artifactParams, artifactId });
            assertCurrent();
            return artifact;
        };
        return {
            serverId, serverIdentityId, accountId, credentials, accountMode, encryption, request, assertCurrent, dispose,
            readSettings: async (): Promise<Settings> => {
                const state = storage.getState();
                if (areAccountSettingsScopesEqual(state.settingsScope, scope)) return state.settings;
                const persisted = loadAccountSettings(scope);
                if (persisted.version !== null) return settingsParse(persisted.settings);
                const baseline = await readAccountSettingsBaseline({ request, credentials, encryption, accountMode });
                assertCurrent();
                return settingsParse(baseline.raw);
            },
            readLiveSettings: () => areAccountSettingsScopesEqual(storage.getState().settingsScope, scope)
                ? storage.getState().settings : null,
            // A prepared invocation retains its original admitted input, not listeners or
            // an idle transport. Recheck its captured credential before that input runs.
            runPrepared: async <T>(run: () => Promise<T>): Promise<T> => {
                const stopWatching = watch();
                try {
                    assertCurrent();
                    const current = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId });
                    if (current?.token !== credentials.token) abort();
                    assertCurrent();
                    const result = await run();
                    assertCurrent();
                    return result;
                } finally { stopWatching(); }
            },
            fetchArtifact,
            createArtifact: async (header: ArtifactHeader, body: string) => await createArtifactWithHeaderViaApi({
                ...artifactParams, header, body,
                addArtifact: (artifact) => { if (canPublish()) storage.getState().addArtifact(artifact); },
            }),
            // `basis` is the exact read a caller validated its change against; its
            // versions become the CAS expectation. Without one, the latest row is.
            updateArtifact: async (artifactId: string, header: ArtifactHeader, body: string, basis?: DecryptedArtifact) => {
                const current = basis ?? await fetchArtifact(artifactId);
                await updateArtifactWithHeaderViaApi({
                    ...artifactParams, artifactId, header, body,
                    getArtifact: () => current ?? undefined,
                    updateArtifact: (artifact: DecryptedArtifact) => { if (canPublish()) storage.getState().updateArtifact(artifact); },
                });
                assertCurrent();
            },
        };
    } catch (error) {
        dispose();
        throw error;
    }
}

export type ActionAccountContext = Awaited<ReturnType<typeof captureActionAccountContext>>;
