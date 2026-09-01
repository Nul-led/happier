import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { TerminalConnectSurface } from '@/components/terminalConnect/TerminalConnectSurface';
import { useAuth } from '@/auth/context/AuthContext';
import { useConnectTerminal } from '@/hooks/session/useConnectTerminal';
import { t } from '@/text';
import { clearPendingTerminalConnect, setPendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect';
import { getServerUrl } from '@/sync/domains/server/serverConfig';
import {
    buildTerminalConnectAuthRedirectHref,
    buildTerminalConnectDeepLink,
    parseTerminalConnectRouteParams,
} from '@/utils/path/terminalConnectUrl';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';
import { resolveEffectiveServerUrlOverride } from '@/sync/domains/server/url/serverUrlOverridePolicy';

export default function TerminalScreen() {
    const router = useRouter();
    const searchParams = useLocalSearchParams();
    const auth = useAuth();
    const authRedirectTriggeredRef = React.useRef(false);

    const parsed = React.useMemo(() => parseTerminalConnectRouteParams(searchParams), [searchParams]);
    const publicKey = parsed?.publicKeyB64Url ?? null;
    const serverUrl = parsed?.serverUrl ?? null;
    const serverIdentityId = parsed?.serverIdentityId ?? null;
    const pairing = parsed?.pairing;
    const supportsTokenOnly = parsed?.supportsTokenOnly === true;

    const { processAuthUrl, isLoading } = useConnectTerminal({
        onSuccess: () => {
            router.back();
        },
    });

    React.useEffect(() => {
        if (auth.isAuthenticated || !publicKey || authRedirectTriggeredRef.current) {
            return;
        }

        authRedirectTriggeredRef.current = true;
        const currentServerUrl = canonicalizeServerUrl(getServerUrl());
        const effectiveTarget = resolveEffectiveServerUrlOverride({
            requestedServerUrl: serverUrl,
            activeServerUrl: currentServerUrl,
        });
        setPendingTerminalConnect({
            publicKeyB64Url: publicKey,
            serverUrl: effectiveTarget || currentServerUrl || getServerUrl(),
            serverIdentityId: serverIdentityId ?? '',
            ...(pairing ? { pairing } : {}),
            ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
        });
        router.replace(buildTerminalConnectAuthRedirectHref({
            serverUrl: effectiveTarget || currentServerUrl || getServerUrl(),
        }));
    }, [auth.isAuthenticated, pairing, publicKey, router, serverIdentityId, serverUrl, supportsTokenOnly]);

    const handleConnect = React.useCallback(async () => {
        if (!publicKey) {
            return;
        }
        const authUrl = buildTerminalConnectDeepLink({
            publicKeyB64Url: publicKey,
            serverUrl,
            serverIdentityId: serverIdentityId ?? undefined,
            ...(pairing ? { pairing } : {}),
            ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
        });
        await processAuthUrl(authUrl);
    }, [pairing, processAuthUrl, publicKey, serverIdentityId, serverUrl, supportsTokenOnly]);

    const handleReject = React.useCallback(() => {
        clearPendingTerminalConnect();
        router.back();
    }, [router]);

    if (!auth.isAuthenticated && publicKey) {
        return (
            <TerminalConnectSurface
                testID="terminal-connect-surface"
                state={{
                    kind: 'message',
                    title: t('modals.pleaseSignInFirst'),
                }}
            />
        );
    }

    if (!publicKey) {
        return (
            <TerminalConnectSurface
                testID="terminal-connect-surface"
                state={{
                    kind: 'message',
                    title: t('terminal.invalidConnectionLink'),
                    description: t('terminal.invalidConnectionLinkDescription'),
                    tone: 'critical',
                }}
            />
        );
    }

    return (
        <TerminalConnectSurface
            testID="terminal-connect-surface"
            state={{
                kind: 'approval',
                publicKey,
                isLoading,
                onApprove: handleConnect,
                onReject: handleReject,
            }}
        />
    );
}
