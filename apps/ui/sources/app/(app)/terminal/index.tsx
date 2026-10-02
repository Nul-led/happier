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
    type TerminalConnectPreAuthTargetDecision,
    type TerminalConnectRouteParams,
} from '@/utils/path/terminalConnectUrl';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';
import { focusTerminalConnectHome } from '@/auth/terminal/focusTerminalConnectHome';
import { fireAndForget } from '@/utils/system/fireAndForget';

export default function TerminalScreen() {
    const router = useRouter();
    const searchParams = useLocalSearchParams();
    const auth = useAuth();
    const authRedirectTriggeredRef = React.useRef(false);

    // Expo Router creates a fresh parameter object on every render. Keep one
    // parsed request while its values are unchanged, including the legacy key.
    const routeParamsJson = JSON.stringify(searchParams);
    const parsed = React.useMemo(() => parseTerminalConnectRouteParams(
        JSON.parse(routeParamsJson) as TerminalConnectRouteParams,
    ), [routeParamsJson]);
    const publicKey = parsed?.publicKeyB64Url ?? null;
    const serverUrl = parsed?.serverUrl ?? parsed?.homeConnectionDescriptor?.canonicalServerUrl ?? null;
    const serverIdentityId = parsed?.serverIdentityId ?? null;
    const pairing = parsed?.pairing;
    const supportsTokenOnly = parsed?.supportsTokenOnly === true;
    const homeConnectionDescriptor = parsed?.homeConnectionDescriptor;
    const [preAuthTarget, setPreAuthTarget] = React.useState<TerminalConnectPreAuthTargetDecision | null>(null);
    const requiresUpdate = parsed?.compatibility?.admission === 'update_required';
    const compatibilityHandledRef = React.useRef(false);

    const { processParsedAuthUrl, isLoading, approvalDetails, retryApprovalDetails } = useConnectTerminal({
        approvalRequest: requiresUpdate ? null : parsed,
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

        let cancelled = false;
        fireAndForget((async () => {
            const target = await resolveTerminalConnectPreAuthTarget({
                requestedServerUrl: serverUrl, activeServerUrl: canonicalizeServerUrl(getServerUrl()),
                ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
            });
            if (cancelled || !target) return;
            setPreAuthTarget(target);
            setPendingTerminalConnect({
                publicKeyB64Url: publicKey, serverUrl: target.pendingServerUrl, serverIdentityId: serverIdentityId ?? '',
                ...(pairing ? { pairing } : {}), ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
                ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
            });
            if (!target.canNavigateToAuth) return;
            if (homeConnectionDescriptor) {
                const profile = await focusTerminalConnectHome({ descriptor: homeConnectionDescriptor, refreshAuth: auth.refreshFromActiveServer });
                if (!profile || cancelled) return;
            }
            authRedirectTriggeredRef.current = true;
            router.replace(buildTerminalConnectAuthRedirectHref({ serverUrl: target.pendingServerUrl }));
        })(), { tag: 'TerminalScreen.redirectToAuth' });
        return () => { cancelled = true; };
    }, [auth.isAuthenticated, auth.refreshFromActiveServer, homeConnectionDescriptor, pairing, publicKey, requiresUpdate, router, serverIdentityId, serverUrl, supportsTokenOnly]);

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
                storageMode: approvalDetails.kind === 'ready' ? approvalDetails.storageMode : null,
                homeUrl: approvalDetails.kind === 'ready' || approvalDetails.kind === 'needs_sign_in'
                    ? approvalDetails.homeUrl : serverUrl ?? '',
                needsSignIn: approvalDetails.kind === 'needs_sign_in',
                ...(approvalDetails.kind === 'error' ? {
                    errorDescription: t('modals.failedToConnectTerminal'),
                    onRetry: retryApprovalDetails,
                } : {}),
                onApprove: handleConnect,
                onReject: handleReject,
            }}
        />
    );
}
