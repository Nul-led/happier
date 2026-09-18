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
    parseTerminalConnectRouteParams,
    resolveTerminalConnectPreAuthTarget,
} from '@/utils/path/terminalConnectUrl';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';

export default function TerminalScreen() {
    const router = useRouter();
    const searchParams = useLocalSearchParams();
    const auth = useAuth();
    const authRedirectTriggeredRef = React.useRef(false);

    const parsed = React.useMemo(() => parseTerminalConnectRouteParams(searchParams), [searchParams]);
    const publicKey = parsed?.publicKeyB64Url ?? null;
    const serverUrl = parsed?.serverUrl ?? parsed?.homeConnectionDescriptor?.canonicalServerUrl ?? null;
    const serverIdentityId = parsed?.serverIdentityId ?? null;
    const pairing = parsed?.pairing;
    const supportsTokenOnly = parsed?.supportsTokenOnly === true;
    const homeConnectionDescriptor = parsed?.homeConnectionDescriptor;
    const preAuthTarget = resolveTerminalConnectPreAuthTarget({
        requestedServerUrl: serverUrl,
        activeServerUrl: canonicalizeServerUrl(getServerUrl()),
        ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
    });
    const requiresUpdate = parsed?.compatibility?.admission === 'update_required';
    const compatibilityHandledRef = React.useRef(false);

    const { processParsedAuthUrl, isLoading } = useConnectTerminal({
        onSuccess: () => {
            router.back();
        },
    });

    React.useEffect(() => {
        if (!parsed || !requiresUpdate || compatibilityHandledRef.current) return;
        compatibilityHandledRef.current = true;
        void processParsedAuthUrl(parsed);
    }, [parsed, processParsedAuthUrl, requiresUpdate]);

    React.useEffect(() => {
        if (auth.isAuthenticated || !publicKey || requiresUpdate || authRedirectTriggeredRef.current) {
            return;
        }

        authRedirectTriggeredRef.current = true;
        if (!preAuthTarget) return;
        const effectiveTarget = preAuthTarget.pendingServerUrl;
        setPendingTerminalConnect({
            publicKeyB64Url: publicKey,
            serverUrl: effectiveTarget,
            serverIdentityId: serverIdentityId ?? '',
            ...(pairing ? { pairing } : {}),
            ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
            ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
        });
        if (preAuthTarget.canNavigateToAuth) {
            router.replace(buildTerminalConnectAuthRedirectHref({
                serverUrl: effectiveTarget,
            }));
        }
    }, [auth.isAuthenticated, homeConnectionDescriptor, pairing, preAuthTarget, publicKey, requiresUpdate, router, serverIdentityId, supportsTokenOnly]);

    const handleConnect = React.useCallback(async () => {
        if (!publicKey) {
            return;
        }
        if (parsed) await processParsedAuthUrl(parsed);
    }, [parsed, processParsedAuthUrl, publicKey]);

    const handleReject = React.useCallback(() => {
        clearPendingTerminalConnect();
        router.back();
    }, [router]);

    if (requiresUpdate) {
        return (
            <TerminalConnectSurface
                testID="terminal-connect-surface"
                state={{
                    kind: 'message',
                    title: t('connect.updateRequiredTitle'),
                    description: t('connect.legacyPairingUpdateRequiredBody'),
                    tone: 'critical',
                }}
            />
        );
    }

    if (!auth.isAuthenticated && publicKey) {
        if (preAuthTarget?.canNavigateToAuth === false) {
            return (
                <TerminalConnectSurface
                    testID="terminal-connect-surface"
                    state={{
                        kind: 'message',
                        title: t('welcome.serverUnavailableTitle'),
                        description: t('welcome.serverUnavailableBody', {
                            serverUrl: preAuthTarget.pendingServerUrl,
                        }),
                        tone: 'critical',
                    }}
                />
            );
        }
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
