import React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';

import { TerminalConnectSurface } from '@/components/terminalConnect/TerminalConnectSurface';
import { useAuth } from '@/auth/context/AuthContext';
import { useConnectTerminal } from '@/hooks/session/useConnectTerminal';
import { t } from '@/text';
import { clearPendingTerminalConnect, getPendingTerminalConnect, setPendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect';
import { normalizeServerUrl, upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { getActiveServerUrl } from '@/sync/domains/server/serverProfiles';
import { shouldSwitchToServerUrl } from '@/sync/domains/server/url/serverUrlOverridePolicy';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import {
    buildTerminalConnectAuthRedirectHref,
    buildTerminalConnectDeepLink,
    parseTerminalConnectUrl,
    resolveTerminalConnectPreAuthTarget,
    type ParsedTerminalConnectUrl,
} from '@/utils/path/terminalConnectUrl';
import { consumeTerminalConnectWebBootstrapHash } from '@/utils/path/terminalConnectWebBootstrap';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { resolveRoutineServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

export default function TerminalConnectScreen() {
    const router = useRouter();
    const [publicKey, setPublicKey] = React.useState<string | null>(null);
    const [serverUrlFromHash, setServerUrlFromHash] = React.useState<string | null>(null);
    const [serverIdentityId, setServerIdentityId] = React.useState<string | null>(null);
    const [pairing, setPairing] = React.useState<ParsedTerminalConnectUrl['pairing']>();
    const [supportsTokenOnly, setSupportsTokenOnly] = React.useState(false);
    const [strictAuthUrl, setStrictAuthUrl] = React.useState<string | null>(null);
    const [homeConnectionDescriptor, setHomeConnectionDescriptor] = React.useState<HomeConnectionDescriptorV1 | undefined>();
    const [requiresUpdate, setRequiresUpdate] = React.useState(false);
    const [hashProcessed, setHashProcessed] = React.useState(false);
    const auth = useAuth();
    const authRedirectTriggeredRef = React.useRef(false);
    const preAuthTarget = resolveTerminalConnectPreAuthTarget({
        requestedServerUrl: serverUrlFromHash,
        activeServerUrl: normalizeServerUrl(getActiveServerUrl()),
        ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
    });

    const navigateBackOrToHome = React.useCallback(() => {
        safeRouterBack({ router, fallbackHref: '/' });
    }, [router]);

    const { processAuthUrl, processParsedAuthUrl, isLoading } = useConnectTerminal({
        allowLoopbackServerOverride: true,
        onSuccess: () => {
            router.replace('/');
        },
    });

    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || hashProcessed) {
            return;
        }

        let sourceUrl = window.location.href;
        let parsed = parseTerminalConnectUrl(sourceUrl);
        if (!parsed) {
            try {
                const bootstrappedHash = window.sessionStorage
                    ? consumeTerminalConnectWebBootstrapHash(window.sessionStorage)
                    : null;
                if (bootstrappedHash) {
                    const suffix = bootstrappedHash.startsWith('#') ? bootstrappedHash : `#${bootstrappedHash}`;
                    sourceUrl = `${window.location.href}${suffix}`;
                    parsed = parseTerminalConnectUrl(sourceUrl);
                }
            } catch {
                // The visible URL remains authoritative when bootstrap storage is unavailable.
            }
        }

        if (parsed?.publicKeyB64Url) {
            if (parsed.compatibility?.admission === 'update_required') {
                window.history.replaceState(null, '', window.location.pathname);
                setRequiresUpdate(true);
                setHashProcessed(true);
                fireAndForget(processParsedAuthUrl(parsed), { tag: 'TerminalConnectScreen.updateRequired' });
                return;
            }
            setPublicKey(parsed.publicKeyB64Url);
            setPairing(parsed.pairing);
            setServerIdentityId(parsed.serverIdentityId ?? null);
            setSupportsTokenOnly(parsed.supportsTokenOnly === true);
            setStrictAuthUrl(parsed.wireVersion === 4 ? sourceUrl : null);
            setHomeConnectionDescriptor(parsed.homeConnectionDescriptor);

            const activeServerUrl = normalizeServerUrl(getActiveServerUrl());
            const requestedServerUrl = normalizeServerUrl(
                parsed.serverUrl ?? parsed.homeConnectionDescriptor?.canonicalServerUrl ?? '',
            );
            const preAuthTarget = resolveTerminalConnectPreAuthTarget({
                requestedServerUrl,
                activeServerUrl,
                ...(parsed.homeConnectionDescriptor ? { homeConnectionDescriptor: parsed.homeConnectionDescriptor } : {}),
                allowLegacyLoopbackOverride: auth.isAuthenticated,
            });
            const desiredServerUrl = preAuthTarget?.pendingServerUrl ?? '';
            if (desiredServerUrl) {
                setPendingTerminalConnect({
                    publicKeyB64Url: parsed.publicKeyB64Url,
                    serverUrl: desiredServerUrl,
                    serverIdentityId: parsed.serverIdentityId ?? '',
                    ...(parsed.pairing ? { pairing: parsed.pairing } : {}),
                    ...(parsed.supportsTokenOnly ? { supportsTokenOnly: true } : {}),
                    ...(parsed.homeConnectionDescriptor
                        ? { homeConnectionDescriptor: parsed.homeConnectionDescriptor }
                        : {}),
                });
                setServerUrlFromHash(desiredServerUrl);
            }

            window.history.replaceState(null, '', window.location.pathname);
        } else {
            const pending = getPendingTerminalConnect();
            if (pending?.publicKeyB64Url) {
                setPublicKey(pending.publicKeyB64Url);
                setServerUrlFromHash(pending.serverUrl);
                setPairing(pending.pairing);
                setServerIdentityId(pending.serverIdentityId);
                setSupportsTokenOnly(pending.supportsTokenOnly === true);
                setHomeConnectionDescriptor(pending.homeConnectionDescriptor);
            }
        }

        setHashProcessed(true);
    }, [auth.isAuthenticated, hashProcessed, processParsedAuthUrl]);

    React.useEffect(() => {
        if (auth.isAuthenticated || !hashProcessed || !publicKey || authRedirectTriggeredRef.current) {
            return;
        }

        const activeServerUrl = normalizeServerUrl(getActiveServerUrl());
        if (!preAuthTarget) return;
        if (!preAuthTarget.canNavigateToAuth) {
            return;
        }
        authRedirectTriggeredRef.current = true;
        const effectiveTarget = preAuthTarget.pendingServerUrl;
        const desiredServerUrl = preAuthTarget.pendingServerUrl;
        setPendingTerminalConnect({
            publicKeyB64Url: publicKey,
            serverUrl: desiredServerUrl,
            serverIdentityId: serverIdentityId ?? '',
            ...(pairing ? { pairing } : {}),
            ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
            ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
        });

        fireAndForget((async () => {
            if (effectiveTarget && shouldSwitchToServerUrl({ targetServerUrl: effectiveTarget, activeServerUrl })) {
                try {
                    await upsertActivateAndSwitchServer({
                        serverUrl: effectiveTarget,
                        source: 'url',
                        scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
                        refreshAuth: auth.refreshFromActiveServer,
                    });
                } catch {
                    // ignore; auth entry route can still recover later
                }
            }
            router.replace(buildTerminalConnectAuthRedirectHref({ serverUrl: desiredServerUrl }));
        })(), { tag: 'TerminalConnectScreen.redirectToAuth' });
    }, [auth.isAuthenticated, auth.refreshFromActiveServer, hashProcessed, homeConnectionDescriptor, pairing, preAuthTarget, publicKey, router, serverIdentityId, supportsTokenOnly]);

    const handleConnect = React.useCallback(async () => {
        if (!publicKey) {
            return;
        }

        const authUrl = strictAuthUrl ?? buildTerminalConnectDeepLink({
            publicKeyB64Url: publicKey,
            serverUrl: serverUrlFromHash,
            serverIdentityId: serverIdentityId ?? undefined,
            ...(pairing ? { pairing } : {}),
            ...(supportsTokenOnly ? { supportsTokenOnly: true } : {}),
            ...(homeConnectionDescriptor ? { homeConnectionDescriptor } : {}),
        });
        await processAuthUrl(authUrl);
    }, [homeConnectionDescriptor, pairing, processAuthUrl, publicKey, serverIdentityId, serverUrlFromHash, strictAuthUrl, supportsTokenOnly]);

    const handleReject = React.useCallback(() => {
        clearPendingTerminalConnect();
        navigateBackOrToHome();
    }, [navigateBackOrToHome]);

    if (Platform.OS !== 'web') {
        return (
            <TerminalConnectSurface
                testID="terminal-connect-surface"
                state={{
                    kind: 'message',
                    title: t('terminal.webBrowserRequired'),
                    description: t('terminal.webBrowserRequiredDescription'),
                }}
            />
        );
    }

    if (!hashProcessed) {
        return (
            <TerminalConnectSurface
                testID="terminal-connect-surface"
                state={{
                    kind: 'message',
                    title: t('terminal.processingConnection'),
                    loading: true,
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
                            serverUrl: homeConnectionDescriptor?.canonicalServerUrl ?? serverUrlFromHash ?? '',
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
