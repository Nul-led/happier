import * as React from 'react';

import {
    accountDirectoryCredentialStorage,
    subscribeAccountDirectoryCredentialMutations,
} from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import { useAccountServiceDisplayName } from '@/components/account/auth/accountServiceDisplayName';

export type AccountServiceSignIn = Readonly<{
    /** How the app names the selected sign-in service, or null when it has no name to offer. */
    serviceName: string | null;
    /** Whether this device holds a sign-in for it; null until the stored sign-in has been read. */
    signedIn: boolean | null;
}>;

/**
 * An account service's name and whether this device holds a sign-in for it, for an exact service
 * endpoint (the one a Home's sign-in policy names). It reads this device's storage only, never the
 * network, and re-reads when a stored sign-in is written or removed, or when `rereadKey` changes. It
 * states a stored sign-in, not a verified one.
 */
export function useStoredAccountServiceSignIn(
    endpoint: Readonly<{ url: string; serverIdentityId?: string | null; displayName?: string | null }>,
    rereadKey: number = 0,
): AccountServiceSignIn {
    const serverIdentityId = endpoint.serverIdentityId?.trim() || null;
    const serviceName = useAccountServiceDisplayName({
        url: endpoint.url,
        serverIdentityId,
        savedName: endpoint.displayName,
    });
    const [signedIn, setSignedIn] = React.useState<Readonly<{ key: string; value: boolean }> | null>(null);
    const key = `${endpoint.url}|${serverIdentityId ?? ''}`;
    const [mutationGeneration, setMutationGeneration] = React.useState(0);
    React.useEffect(() => subscribeAccountDirectoryCredentialMutations(
        () => setMutationGeneration((generation) => generation + 1),
    ), []);
    React.useEffect(() => {
        if (!serverIdentityId) return;
        let cancelled = false;
        void accountDirectoryCredentialStorage.get({ endpoint: endpoint.url, serverIdentityId })
            .then((credentials) => {
                if (!cancelled) setSignedIn({ key, value: Boolean(credentials) });
            })
            .catch(() => {
                if (!cancelled) setSignedIn({ key, value: false });
            });
        return () => {
            cancelled = true;
        };
    }, [endpoint.url, key, mutationGeneration, rereadKey, serverIdentityId]);
    const signedInValue = !serverIdentityId ? false : signedIn?.key === key ? signedIn.value : null;
    return React.useMemo(() => ({ serviceName, signedIn: signedInValue }), [serviceName, signedInValue]);
}

