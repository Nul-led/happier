import * as React from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/auth/context/AuthContext';
import {
    TokenStorage,
    type AuthCredentials,
} from '@/auth/storage/tokenStorage';
import { approveTerminalPairing } from '@/auth/terminal/approveTerminalPairing';
import {
    buildEstablishedHomeTransportDescriptor,
    resolveHomeEnrollmentTransport,
} from '@/auth/enrollment/homeEnrollmentTransport';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    buildHomeConnectionDescriptorForProfile,
    getActiveServerUrl,
    listServerProfiles,
    resolveServerProfileForPortableIdentity,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { normalizeServerUrl } from '@/sync/domains/server/activeServerSwitch';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { resolveEffectiveServerUrlOverride } from '@/sync/domains/server/url/serverUrlOverridePolicy';
import { clearPendingTerminalConnect, setPendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect';
import type { PendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect.shared';
import {
    buildTerminalConnectAuthRedirectHref,
    parseTerminalConnectUrl,
    resolveTerminalConnectPreAuthTarget,
    type ParsedTerminalConnectUrl,
} from '@/utils/path/terminalConnectUrl';
import { canUseCurrentDeviceQrScanner } from '@/utils/platform/qrScannerSupport';
import { decodeBase64 } from '@/encryption/base64';
import { promptLegacyPairingUpdateRequired } from '@/auth/pairing/legacyPairingUpdateRequired';

interface UseConnectTerminalOptions {
    onSuccess?: () => void;
    onError?: (error: any) => void;
    allowLoopbackServerOverride?: boolean;
}

type TerminalApprovalTarget = Readonly<{
    endpointUrl: string;
    serverId?: string;
    descriptor?: HomeConnectionDescriptorV1;
    credentials: AuthCredentials | null;
}>;

/**
 * A Home is identified by its stable `serverIdentityId`; hostnames and ports are only
 * routing facts. A daemon pairing on this machine therefore advertises its own loopback
 * address for a Home this device may already know under a different host, so the link's
 * identity — not its URL — selects the signed-in profile.
 *
 * URL comparison survives only for a link that carries no identity at all, and then only
 * across profiles with no pinned identity of their own: an anonymous URL must never unlock
 * an identity-bound Home's credentials.
 */
function findSignedInProfileForTerminalLink(params: Readonly<{
    expectedServerIdentityId: string;
    endpointUrl: string;
}>): ServerProfile | null {
    const expectedServerIdentityId = params.expectedServerIdentityId.trim();
    if (expectedServerIdentityId) {
        const resolution = resolveServerProfileForPortableIdentity(expectedServerIdentityId);
        return resolution.kind === 'resolved' ? resolution.profile : null;
    }
    const targetKey = createServerUrlComparableKey(params.endpointUrl);
    if (!targetKey) return null;
    const matches = listServerProfiles().filter((profile) => (
        !profile.serverIdentityId
        && (
            createServerUrlComparableKey(profile.serverUrl) === targetKey
            || createServerUrlComparableKey(profile.canonicalServerUrl ?? '') === targetKey
            || createServerUrlComparableKey(profile.publicServerUrl ?? '') === targetKey
        )
    ));
    return matches.length === 1 ? matches[0]! : null;
}

async function resolveTerminalApprovalTarget(params: Readonly<{
    requestedEndpointUrl: string | null;
    focusedEndpointUrl: string;
    expectedServerIdentityId: string;
    descriptor?: HomeConnectionDescriptorV1;
}>): Promise<TerminalApprovalTarget> {
    if (params.descriptor && params.descriptor.homeServerIdentityId !== params.expectedServerIdentityId) {
        throw new Error('Terminal pairing descriptor identity does not match the link destination');
    }
    const endpointUrl = params.descriptor?.canonicalServerUrl
        || params.requestedEndpointUrl
        || params.focusedEndpointUrl;
    if (!endpointUrl) throw new Error('Terminal pairing requires an explicit target server');

    const profile = findSignedInProfileForTerminalLink({
        expectedServerIdentityId: params.expectedServerIdentityId,
        endpointUrl,
    });
    // Descriptor precedence: the link's verified descriptor, then the Home's published one,
    // then this device's own established connection to that Home. The last case is the only
    // one available for a Home reachable over loopback HTTP, which publishes no descriptor at
    // all while the CLI still issues identity-bearing URL-only links for it.
    const descriptor = params.descriptor
        ?? (profile
            ? buildHomeConnectionDescriptorForProfile(profile)
                ?? (profile.serverIdentityId
                    ? buildEstablishedHomeTransportDescriptor({
                        canonicalServerUrl: profile.canonicalServerUrl ?? profile.serverUrl,
                        homeServerIdentityId: profile.serverIdentityId,
                    })
                    : null)
            : null);
    if (!profile || !descriptor) {
        return { endpointUrl, ...(descriptor ? { descriptor } : {}), credentials: null };
    }
    const serverId = params.expectedServerIdentityId.trim();
    const credentials = await TokenStorage.getCredentialsForServerUrl(
        profile.serverUrl,
        serverId ? { serverId } : {},
    );
    return { endpointUrl, ...(serverId ? { serverId } : {}), descriptor, credentials };
}

export function useConnectTerminal(options?: UseConnectTerminalOptions) {
    const auth = useAuth();
    const [isLoading, setIsLoading] = React.useState(false);

    const processParsedAuthUrl = React.useCallback(async (parsed: ParsedTerminalConnectUrl) => {
        if (parsed.compatibility?.admission === 'update_required') {
            const action = await promptLegacyPairingUpdateRequired();
            if (action === 'scan_new_qr') router.push('/scan/terminal');
            return false;
        }
        
        setIsLoading(true);
        try {
            const currentServerUrl = normalizeServerUrl(getActiveServerUrl());
            const effectiveParsedServerUrl = resolveEffectiveServerUrlOverride({
                requestedServerUrl: parsed.serverUrl ?? parsed.homeConnectionDescriptor?.canonicalServerUrl,
                activeServerUrl: currentServerUrl,
                allowLoopbackOverride: options?.allowLoopbackServerOverride === true,
            });

            const target = await resolveTerminalApprovalTarget({
                requestedEndpointUrl: effectiveParsedServerUrl,
                focusedEndpointUrl: currentServerUrl,
                expectedServerIdentityId: parsed.serverIdentityId ?? '',
                ...(parsed.homeConnectionDescriptor ? { descriptor: parsed.homeConnectionDescriptor } : {}),
            });
            const activeCredentials = target.credentials;

            if (!activeCredentials) {
                const preAuthTarget = resolveTerminalConnectPreAuthTarget({
                    requestedServerUrl: parsed.serverUrl ?? parsed.homeConnectionDescriptor?.canonicalServerUrl,
                    activeServerUrl: currentServerUrl,
                    ...(parsed.homeConnectionDescriptor ? { homeConnectionDescriptor: parsed.homeConnectionDescriptor } : {}),
                    allowLegacyLoopbackOverride: options?.allowLoopbackServerOverride === true,
                });
                if (!preAuthTarget) {
                    throw new Error('Terminal pairing requires a pre-auth target Home');
                }
                const pendingServerUrl = preAuthTarget.pendingServerUrl;
                const pendingConnect: PendingTerminalConnect = {
                    publicKeyB64Url: parsed.publicKeyB64Url,
                    serverUrl: pendingServerUrl,
                    serverIdentityId: parsed.serverIdentityId ?? '',
                    ...(parsed.pairing ? { pairing: parsed.pairing } : {}),
                    ...(parsed.supportsTokenOnly ? { supportsTokenOnly: true } : {}),
                    ...(parsed.homeConnectionDescriptor
                        ? { homeConnectionDescriptor: parsed.homeConnectionDescriptor }
                        : {}),
                };
                if (preAuthTarget.canNavigateToAuth === false) {
                    setPendingTerminalConnect(pendingConnect);
                    await Modal.alertAsync(
                        t('welcome.serverUnavailableTitle'),
                        t('welcome.serverUnavailableBody', { serverUrl: pendingServerUrl }),
                        [{ text: t('common.continue') }],
                    );
                    return false;
                }
                // Signed in, just not to the Home this link belongs to. The sign-in prompt is a
                // dead end there: it redirects to auth, the pending intent brings the user back
                // here, and the same prompt reappears. Name both Homes once instead, and leave
                // nothing pending when the switch is declined so nothing can bounce back.
                if (auth.credentials) {
                    const shouldSwitchHome = await Modal.confirm(
                        t('terminal.connectTerminal'),
                        t('terminal.switchServerToConnectTerminal', {
                            serverUrl: target.endpointUrl,
                            signedInServerUrl: currentServerUrl,
                        }),
                        { confirmText: t('server.switchToServer') },
                    );
                    if (!shouldSwitchHome) {
                        clearPendingTerminalConnect();
                        return false;
                    }
                    setPendingTerminalConnect(pendingConnect);
                    router.replace(buildTerminalConnectAuthRedirectHref({ serverUrl: pendingServerUrl }));
                    return false;
                }
                setPendingTerminalConnect(pendingConnect);
                await Modal.alertAsync(
                    t('terminal.connectTerminal'),
                    t('modals.pleaseSignInFirst'),
                    [{ text: t('common.continue') }],
                );
                router.replace(buildTerminalConnectAuthRedirectHref({ serverUrl: pendingServerUrl }));
                return false;
            }

            const publicKey = decodeBase64(parsed.publicKeyB64Url, 'base64url');

            const pairingSecret = parsed.pairing
                ? decodeBase64(parsed.pairing.secretB64Url, 'base64url')
                : null;
            if (!parsed.pairing || pairingSecret?.length !== 32) {
                // Every current approval seals a pairing-bound v3 response. Unbound V1/V2
                // issuance is retired, so a requester without pairing context can only be
                // served by upgrading the remote.
                throw new Error('Terminal pairing requires an authenticated v3 pairing context');
            }
            if (!target.descriptor) {
                throw new Error('Terminal pairing requires a verified Home connection descriptor');
            }
            const transportResolution = await resolveHomeEnrollmentTransport(target.descriptor);
            if (!transportResolution.ok) {
                throw new Error(`Terminal pairing transport unavailable: ${transportResolution.reason}`);
            }
            let approvalResult: Awaited<ReturnType<typeof approveTerminalPairing>>;
            try {
                approvalResult = await approveTerminalPairing({
                    target: transportResolution.transport,
                    requesterPublicKey: publicKey,
                    pairingContext: {
                        secret: pairingSecret,
                        createdAtMs: parsed.pairing.createdAtMs,
                        expiresAtMs: parsed.pairing.expiresAtMs,
                    },
                    targetCredentials: activeCredentials,
                    supportsTokenOnly: parsed.supportsTokenOnly === true,
                });
            } finally {
                await transportResolution.transport.close();
            }

            // If we successfully completed a pending connect, clear it.
            clearPendingTerminalConnect();

            if (approvalResult === 'approved') {
                await Modal.alertAsync(t('common.success'), t('modals.terminalConnectedSuccessfully'), [
                    {
                        text: t('common.ok'),
                    }
                ]);
                options?.onSuccess?.();
                return true;
            }

            if (approvalResult === 'already_authorized') {
                await Modal.alertAsync(
                    t('modals.terminalAlreadyConnected'),
                    t('modals.terminalConnectionAlreadyUsedDescription'),
                    [{ text: t('common.ok') }]
                );
                return false;
            }

            if (approvalResult === 'not_found') {
                await Modal.alertAsync(
                    t('modals.authRequestExpired'),
                    t('modals.authRequestExpiredDescription'),
                    [{ text: t('common.ok') }]
                );
                return false;
            }

            return true;
        } catch (e) {
            await Modal.alertAsync(t('common.error'), t('modals.failedToConnectTerminal'), [{ text: t('common.ok') }]);
            options?.onError?.(e);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, [auth.credentials, options]);

    const processAuthUrl = React.useCallback(async (url: string) => {
        const parsed = parseTerminalConnectUrl(url);
        if (!parsed) {
            await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
            return false;
        }
        return await processParsedAuthUrl(parsed);
    }, [processParsedAuthUrl]);

    const connectTerminal = React.useCallback(async () => {
        const canUseScanner = canUseCurrentDeviceQrScanner();
        if (!canUseScanner) {
            await Modal.alertAsync(t('common.error'), t('modals.qrScannerUnavailable'), [{ text: t('common.ok') }]);
            return;
        }
        router.push('/scan/terminal');
    }, []);

    const connectWithUrl = React.useCallback(async (url: string) => {
        return await processAuthUrl(url);
    }, [processAuthUrl]);

    return {
        connectTerminal,
        connectWithUrl,
        isLoading,
        processAuthUrl,
        processParsedAuthUrl,
    };
}
