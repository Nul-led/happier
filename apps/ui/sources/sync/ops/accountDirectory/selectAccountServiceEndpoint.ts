import { accountDirectoryAuthClient, type AccountDirectoryAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { normalizeAccountDirectoryEndpoint } from '@/sync/domains/accountDirectory/accountDirectoryEndpoint';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';

export type SelectAccountServiceEndpointResult =
    | Readonly<{ kind: 'selected' }>
    | Readonly<{ kind: 'invalid' | 'unsupported' | 'unavailable' }>;

export async function selectAccountServiceEndpoint(
    entered: string,
    options: AccountDirectoryAuthTransport & Readonly<{ signal: AbortSignal }>,
): Promise<SelectAccountServiceEndpointResult> {
    const endpointUrl = normalizeAccountDirectoryEndpoint(entered);
    if (!endpointUrl) return { kind: 'invalid' };
    const { signal, ...transport } = options;

    try {
        const discovery = await accountDirectoryAuthClient.discoverAuthenticationMethods({
            endpointUrl,
            ...transport,
            signal,
        });
        if (discovery.kind !== 'supported_account_service') {
            return { kind: discovery.kind === 'not_account_service' ? 'unsupported' : 'unavailable' };
        }
        if (signal.aborted) return { kind: 'unavailable' };
        await setAccountServiceEndpoint({
            url: discovery.endpointUrl,
            serverIdentityId: discovery.serverIdentityId,
            displayName: discovery.accountServiceDisplayName?.trim() || toServerUrlDisplay(discovery.endpointUrl),
            source: 'user',
        });
        return { kind: 'selected' };
    } catch {
        return { kind: 'unavailable' };
    }
}
