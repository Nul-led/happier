import { TokenStorage } from '@/auth/storage/tokenStorage';
import { normalizeAccountDirectoryEndpoint } from '@/sync/domains/accountDirectory/accountDirectoryEndpoint';
import {
    resolveSelectedAccountServiceEndpoint,
    setAccountServiceEndpoint,
} from '@/sync/domains/server/serverProfiles';

/**
 * Records the Directory credential of an Account just created on an account service from its mail
 * landing. Custody is keyed by the selected service's address and identity, so the credential is
 * stored under the selected service when it is this one (whatever address form the mail link
 * used); when another service is selected on this device (the link was opened elsewhere), the
 * service the person just created an account on becomes the selected one, because that is the
 * service they just chose to sign in to.
 */
export async function commitAccountServiceCreation(input: Readonly<{
    endpointUrl: string;
    serverIdentityId: string;
    token: string;
}>): Promise<boolean> {
    const serverIdentityId = input.serverIdentityId.trim();
    const endpointUrl = normalizeAccountDirectoryEndpoint(input.endpointUrl);
    if (!serverIdentityId || !endpointUrl || !input.token.trim()) return false;
    const selected = resolveSelectedAccountServiceEndpoint();
    const selectedUrl = normalizeAccountDirectoryEndpoint(selected.url);
    let endpoint = selected.serverIdentityId === serverIdentityId && selectedUrl ? selectedUrl : null;
    if (!endpoint) {
        await setAccountServiceEndpoint({ url: endpointUrl, serverIdentityId, source: 'user' });
        endpoint = endpointUrl;
    }
    return await TokenStorage.accountDirectoryAuthCredentials.set(
        { endpoint, serverIdentityId },
        { token: input.token.trim() },
    );
}
