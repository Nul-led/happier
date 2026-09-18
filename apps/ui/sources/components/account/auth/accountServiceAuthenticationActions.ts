import type { AccountContinuationIntent } from '@happier-dev/cli-common/accountService';

import { accountDirectoryAuthClient, type AccountDirectoryAuthTransport, type AccountDirectoryAuthenticationAction, type AccountDirectoryOAuthStartResult, type VerifiedAccountServiceAuthority } from '@/auth/accountDirectory/accountDirectoryAuthClient';

export async function startAccountServiceOAuthAuthentication(input: Readonly<{
    authority: VerifiedAccountServiceAuthority;
    execution: Extract<AccountDirectoryAuthenticationAction['execution'], { kind: 'oauth' }>;
    intent: AccountContinuationIntent;
    returnTo: string;
    accountEntryReturnTo?: string;
    transport?: AccountDirectoryAuthTransport;
    signal?: AbortSignal;
}>): Promise<AccountDirectoryOAuthStartResult> {
    return await accountDirectoryAuthClient.startOAuth({
        endpointUrl: input.authority.endpointUrl,
        endpointServerIdentityId: input.authority.serverIdentityId,
        canonicalServerUrl: input.authority.canonicalServerUrl,
        providerId: input.execution.providerId,
        mode: input.execution.mode,
        entryIntent: input.intent,
        returnTo: input.returnTo,
        ...(input.accountEntryReturnTo !== undefined ? { accountEntryReturnTo: input.accountEntryReturnTo } : {}),
        transport: input.transport,
        signal: input.signal,
    });
}
