import * as React from 'react';
import { useRouter } from 'expo-router';

import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { buildHomeQrInviteRestoreRoutePath } from '@/auth/pairing/pairingUrl';
import { useConnectAccount } from '@/hooks/auth/useConnectAccount';
import { useConnectTerminal } from '@/hooks/session/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';
import { parseTerminalConnectUrl } from '@/utils/path/terminalConnectUrl';

type UseScannedAuthUrlProcessorOptions = Readonly<{
    allowedUrlKind: 'account' | 'terminal';
    onSuccess?: () => void;
    onError?: (error: unknown) => void;
}>;

export function useScannedAuthUrlProcessor(options: UseScannedAuthUrlProcessorOptions) {
    const router = useRouter();
    const accountConnect = useConnectAccount(options);
    const terminalConnect = useConnectTerminal(options);

    const processAuthUrl = React.useCallback(async (rawUrl: string) => {
        const url = String(rawUrl ?? '').trim();
        if (!url) return false;

        try {
            const restorePath = buildHomeQrInviteRestoreRoutePath(url);
            if (restorePath) {
                if (options.allowedUrlKind !== 'account') {
                    await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
                    return false;
                }
                router.push(restorePath);
                return true;
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
