import * as React from 'react';
import { router } from 'expo-router';
import { Modal } from '@/modal';
import { t } from '@/text';
import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { canUseCurrentDeviceQrScanner } from '@/utils/platform/qrScannerSupport';

interface UseConnectAccountOptions {
    onSuccess?: () => void;
    onError?: (error: any) => void;
}

export function useConnectAccount(options?: UseConnectAccountOptions) {
    void options;

    const processAuthUrl = React.useCallback(async (url: string) => {
        const parsed = parseAccountConnectDeepLink(url);
        if (!parsed) {
            await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
            return false;
        }
        
        // Parse-only compatibility: the old public-key QR has no Home identity,
        // expiry, or QR-secret binding and therefore cannot safely export credentials.
        await Modal.alertAsync(t('common.unavailable'), t('connect.legacyAccountQrUnavailable'), [
            { text: t('common.ok') },
        ]);
        return false;
    }, []);

    const connectAccount = React.useCallback(async () => {
        const canUseScanner = canUseCurrentDeviceQrScanner();
        if (!canUseScanner) {
            await Modal.alertAsync(t('common.error'), t('modals.qrScannerUnavailable'), [{ text: t('common.ok') }]);
            return;
        }
        router.push('/scan/account');
    }, []);

    const connectWithUrl = React.useCallback(async (url: string) => {
        return await processAuthUrl(url);
    }, [processAuthUrl]);

    return {
        connectAccount,
        connectWithUrl,
        isLoading: false,
        processAuthUrl
    };
}
