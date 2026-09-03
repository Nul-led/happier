import * as React from 'react';
import { useRouter } from 'expo-router';

import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import {
    buildHomeQrInviteRestoreRoutePath,
    classifyLegacyPairingDeepLink,
    parseHomeQrInviteDeepLink,
} from '@/auth/pairing/pairingUrl';
import type { HomeQrEntryIntent } from '@/auth/pairing/homeQrEntryIntent';
import { promptLegacyPairingUpdateRequired } from '@/auth/pairing/legacyPairingUpdateRequired';
import { useConnectAccount } from '@/hooks/auth/useConnectAccount';
import { useConnectTerminal } from '@/hooks/session/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';
import { parseTerminalConnectUrl } from '@/utils/path/terminalConnectUrl';

type UseScannedAuthUrlProcessorCallbacks = Readonly<{
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
}>;

type UseScannedAuthUrlProcessorOptions = UseScannedAuthUrlProcessorCallbacks & (
    | Readonly<{
        allowedUrlKind: 'account';
        homeQrEntryIntent: HomeQrEntryIntent;
    }>
    | Readonly<{
        allowedUrlKind: 'terminal';
        homeQrEntryIntent?: never;
    }>
);

export function useScannedAuthUrlProcessor(options: UseScannedAuthUrlProcessorOptions) {
    const router = useRouter();
    const accountConnect = useConnectAccount(options);
    const terminalConnect = useConnectTerminal(options);

    const processAuthUrl = React.useCallback(async (rawUrl: string) => {
        const url = String(rawUrl ?? '').trim();
        if (!url) return false;

        try {
            if (options.allowedUrlKind === 'account') {
                const restorePath = buildHomeQrInviteRestoreRoutePath(url, options.homeQrEntryIntent);
                if (restorePath) {
                    router.push(restorePath);
                    return true;
                }
            } else {
                const homeInvite = parseHomeQrInviteDeepLink(url);
                if (homeInvite) {
                    await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
                    return false;
                }
            }

            if (parseTerminalConnectUrl(url)) {
                if (options.allowedUrlKind !== 'terminal') {
                    await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
                    return false;
                }
                return await terminalConnect.processAuthUrl(url);
            }

            if (parseAccountConnectDeepLink(url)) {
                if (options.allowedUrlKind !== 'account') {
                    await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
                    return false;
                }
                return await accountConnect.processAuthUrl(url);
            }

            if (classifyLegacyPairingDeepLink(url)) {
                await promptLegacyPairingUpdateRequired();
                return true;
            }

            await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
            return false;
        } catch (error) {
            options.onError?.(error);
            throw error;
        }
    }, [accountConnect, options, router, terminalConnect]);

    return {
        processAuthUrl,
        isLoading: accountConnect.isLoading || terminalConnect.isLoading,
    };
}
