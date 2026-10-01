import * as React from 'react';
import { router } from 'expo-router';
import { Modal } from '@/modal';
import { t } from '@/text';
import { canUseCurrentDeviceQrScanner } from '@/utils/platform/qrScannerSupport';

/**
 * Opens the account QR scanner. Scanned and pasted links are classified and
 * routed by `useScannedAuthUrlProcessor`; this hook owns only the entry point.
 */
export function useConnectAccount() {
    const connectAccount = React.useCallback(async () => {
        const canUseScanner = canUseCurrentDeviceQrScanner();
        if (!canUseScanner) {
            await Modal.alertAsync(t('common.error'), t('modals.qrScannerUnavailable'), [{ text: t('common.ok') }]);
            return;
        }
        router.push('/scan/account');
    }, []);

    return {
        connectAccount,
        isLoading: false,
    };
}
