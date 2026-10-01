import { Modal } from '@/modal';
import { t } from '@/text';

export type AccountConnectApprovalGuidanceAction = 'dismiss' | 'showQr';

/**
 * The one response to a legacy account-connect link, whichever surface scanned
 * or opened it. "Show QR instead" is offered only when the caller can actually
 * show this device's QR; otherwise the guidance is a plain acknowledgement.
 */
export async function promptAccountConnectApprovalRequired(
    options: Readonly<{ showQr: boolean }>,
): Promise<AccountConnectApprovalGuidanceAction> {
    let action: AccountConnectApprovalGuidanceAction = 'dismiss';
    await Modal.alertAsync(
        t('connect.restoreAccount'),
        t('connect.legacyAccountQrUnavailable'),
        options.showQr
            ? [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('connect.showQrInstead'),
                    onPress: () => {
                        action = 'showQr';
                    },
                },
            ]
            : [{ text: t('common.ok') }],
    );
    return action;
}
