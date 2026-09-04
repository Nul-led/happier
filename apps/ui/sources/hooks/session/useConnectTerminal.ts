import * as React from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/auth/context/AuthContext';
import {
    TokenStorage,
    type AuthCredentials,
} from '@/auth/storage/tokenStorage';
import { approveTerminalPairing } from '@/auth/terminal/approveTerminalPairing';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { Modal } from '@/modal';
import { t } from '@/text';
import {
    buildHomeConnectionDescriptorForProfile,
    getActiveServerUrl,
    listServerProfiles,
} from '@/sync/domains/server/serverProfiles';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { normalizeServerUrl } from '@/sync/domains/server/activeServerSwitch';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { resolveEffectiveServerUrlOverride } from '@/sync/domains/server/url/serverUrlOverridePolicy';
import { clearPendingTerminalConnect, setPendingTerminalConnect } from '@/sync/domains/pending/pendingTerminalConnect';
import { buildTerminalConnectAuthRedirectHref, parseTerminalConnectUrl } from '@/utils/path/terminalConnectUrl';
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

async function resolveTerminalApprovalTarget(params: Readonly<{
    requestedEndpointUrl: string | null;
    focusedEndpointUrl: string;
    expectedServerIdentityId: string;
    descriptor?: HomeConnectionDescriptorV1;
}>): Promise<TerminalApprovalTarget> {
    if (params.descriptor) {
        if (params.descriptor.homeServerIdentityId !== params.expectedServerIdentityId) {
            throw new Error('Terminal pairing descriptor identity does not match the link destination');
        }
        const matches = listServerProfiles().filter(
            (profile) => profile.serverIdentityId?.trim() === params.expectedServerIdentityId,
        );
        if (matches.length !== 1) {
            return { endpointUrl: params.descriptor.canonicalServerUrl, descriptor: params.descriptor, credentials: null };
        }
        const credentials = await TokenStorage.getCredentialsForServerUrl(matches[0]!.serverUrl, {
            serverId: params.expectedServerIdentityId,
        });
        return {
            endpointUrl: params.descriptor.canonicalServerUrl,
            serverId: params.expectedServerIdentityId,
            descriptor: params.descriptor,
            credentials,
        };
    }
    const endpointUrl = params.requestedEndpointUrl || params.focusedEndpointUrl;
    if (!endpointUrl) throw new Error('Terminal pairing requires an explicit target server');
    const targetKey = createServerUrlComparableKey(endpointUrl);
    const matches = listServerProfiles()
        .filter((profile) => (
            profile.serverIdentityId?.trim() === params.expectedServerIdentityId
            && (
            createServerUrlComparableKey(profile.serverUrl) === targetKey
            || createServerUrlComparableKey(profile.canonicalServerUrl ?? '') === targetKey
            || createServerUrlComparableKey(profile.publicServerUrl ?? '') === targetKey
            )
        ));
    if (matches.length !== 1) return { endpointUrl, credentials: null };
    const descriptor = buildHomeConnectionDescriptorForProfile(matches[0]!);
    if (!descriptor) return { endpointUrl, credentials: null };
    const serverId = params.expectedServerIdentityId;
    const credentials = await TokenStorage.getCredentialsForServerUrl(endpointUrl, { serverId });
    return { endpointUrl, serverId, descriptor, credentials };
}

export function useConnectTerminal(options?: UseConnectTerminalOptions) {
    const auth = useAuth();
    const [isLoading, setIsLoading] = React.useState(false);

    const processAuthUrl = React.useCallback(async (url: string) => {
        const parsed = parseTerminalConnectUrl(url);
        if (!parsed) {
            await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
            return false;
        }
        if (parsed.compatibility?.admission === 'update_required') {
            const action = await promptLegacyPairingUpdateRequired();
            if (action === 'scan_new_qr') router.push('/scan/terminal');
            return false;
        }
        
        setIsLoading(true);
        try {
            const currentServerUrl = normalizeServerUrl(getActiveServerUrl());
            const effectiveParsedServerUrl = resolveEffectiveServerUrlOverride({
                requestedServerUrl: parsed.serverUrl,
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
                setPendingTerminalConnect({
                    publicKeyB64Url: parsed.publicKeyB64Url,
                    serverUrl: effectiveParsedServerUrl || currentServerUrl || getActiveServerUrl(),
                    serverIdentityId: parsed.serverIdentityId ?? '',
                    ...(parsed.pairing ? { pairing: parsed.pairing } : {}),
                    ...(parsed.supportsTokenOnly ? { supportsTokenOnly: true } : {}),
                    ...(parsed.homeConnectionDescriptor
                        ? { homeConnectionDescriptor: parsed.homeConnectionDescriptor }
                        : {}),
                });
                await Modal.alertAsync(t('terminal.connectTerminal'), t('modals.pleaseSignInFirst'), [
                    { text: t('common.continue') },
                ]);
                router.replace(buildTerminalConnectAuthRedirectHref({
                    serverUrl: effectiveParsedServerUrl || currentServerUrl || getActiveServerUrl(),
                }));
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
        processAuthUrl
    };
}
