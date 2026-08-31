import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { AuthProviderId } from '@happier-dev/protocol';

export type ExternalAuthStartInput =
    | { mode: 'keyed'; publicKey: string }
    | { mode: 'keyed'; proofHash: string; publicKey?: string }
    | { mode: 'keyless'; proofHash: string };

export type ExternalOAuthEndpointRequest = (
    path: string,
    init?: RequestInit,
    options?: Readonly<{
        includeAuth?: boolean;
        retry?: 'default' | 'none';
    }>,
) => Promise<Response>;

export type AccountDirectoryOAuthRequestContext = Readonly<{
    request: ExternalOAuthEndpointRequest;
    purpose: 'account_directory';
    endpointUrl: string;
    endpointServerIdentityId: string;
}>;

export type AccountDirectoryOAuthStart = Readonly<{
    url: string;
    purpose: 'account_directory';
    credentialTarget: 'account_directory';
    endpointUrl: string;
    endpointServerIdentityId: string;
    expiresAt: number;
}>;

export interface GetExternalAuthUrl {
    (params: ExternalAuthStartInput): Promise<string>;
    (
        params: ExternalAuthStartInput,
        context: AccountDirectoryOAuthRequestContext,
    ): Promise<AccountDirectoryOAuthStart>;
}

export type RestoreRedirectReason = 'provider_already_linked';

export type RestoreRedirectNotice = Readonly<{
    title: string;
    body: string;
}>;

export type AuthProvider = Readonly<{
    id: AuthProviderId;
    displayName?: string;
    badgeIconName?: string;
    supportsProfileBadge?: boolean;
    connectButtonColor?: string;
    getRestoreRedirectNotice?: (params: { reason: RestoreRedirectReason }) => RestoreRedirectNotice | null;
    getExternalAuthUrl: GetExternalAuthUrl;
    getConnectUrl: (credentials: AuthCredentials) => Promise<string>;
    finalizeConnect: (credentials: AuthCredentials, params: { pending: string; username: string }) => Promise<void>;
    cancelConnectPending: (credentials: AuthCredentials, pending: string) => Promise<void>;
    disconnect: (credentials: AuthCredentials) => Promise<void>;
}>;
