import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { areAccountSettingsScopesEqual, type AccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import { getActiveServerHomeCarrier, getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { createServerFetchAtEndpoint, type ServerFetch } from '@/sync/http/client';

export type CapturedAccountSettingsRequest = Readonly<{
    scope: AccountSettingsScope;
    endpointUrl: string;
    request: ServerFetch;
    isCurrent(): boolean;
    dispose(): void;
}>;

/** Capture the endpoint and lifetime of a rendered Account Settings intent. */
export async function captureAccountSettingsRequest(params: Readonly<{
    credentials: AuthCredentials;
    settingsScope: AccountSettingsScope;
    signal?: AbortSignal;
}>): Promise<CapturedAccountSettingsRequest | null> {
    const lifetime = captureActiveServerAccountScopeLifetime();
    if (!lifetime || !areAccountSettingsScopesEqual(lifetime.scope, params.settingsScope) || !lifetime.isCurrent()) return null;
    const activeServer = getActiveServerSnapshot();
    if (activeServer.serverId !== params.settingsScope.serverId || params.signal?.aborted) return null;
    const abortController = new AbortController();
    const abort = () => abortController.abort('account-settings-scope-retired');
    const retirement = lifetime.onRetire(abort);
    params.signal?.addEventListener('abort', abort, { once: true });
    const homeCarrier = getActiveServerHomeCarrier();
    const isCurrent = (): boolean => lifetime.isCurrent() && !abortController.signal.aborted;
    const dispose = (): void => {
        retirement.dispose();
        params.signal?.removeEventListener('abort', abort);
        abortController.abort('account-settings-request-settled');
    };
    // Settings can mount for the next Home before AuthContext publishes its
    // credentials. Validate the supplied bearer against its captured endpoint.
    const endpointCredentials = await TokenStorage.getCredentialsForServerUrl(
        activeServer.serverUrl,
        { serverId: params.settingsScope.serverId },
    ).catch(() => null);
    if (!isCurrent() || endpointCredentials?.token !== params.credentials.token) {
        dispose();
        return null;
    }
    const capturedRequest = createServerFetchAtEndpoint({
        endpointUrl: activeServer.serverUrl,
        ...(activeServer.runtimeOrigin ? { runtimeOrigin: activeServer.runtimeOrigin } : {}),
        ...(homeCarrier ? { homeCarrier } : {}),
        credentials: params.credentials,
        serverId: params.settingsScope.serverId,
        signal: abortController.signal,
    });
    const request: ServerFetch = async (path, init, options) => {
        if (!isCurrent()) throw new Error('Account Settings request scope changed');
        const response = await capturedRequest(path, init, options);
        // A received mutation acknowledgement remains an external fact after
        // retirement. The one-shot writer parses it and keeps projection scoped;
        // read responses still fail closed before their content reaches callers.
        if ((init?.method ?? 'GET').toUpperCase() !== 'POST' && !isCurrent()) {
            throw new Error('Account Settings request scope changed');
        }
        return response;
    };
    return {
        scope: params.settingsScope,
        endpointUrl: activeServer.serverUrl,
        request,
        isCurrent,
        dispose,
    };
}
