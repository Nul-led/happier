import { Modal } from '@/modal';
import { t } from '@/text';

export type LegacyPairingUpdateRequiredAction = 'scan_new_qr' | 'cancel';

export async function promptLegacyPairingUpdateRequired(): Promise<LegacyPairingUpdateRequiredAction> {
    let action: LegacyPairingUpdateRequiredAction = 'cancel';
    await Modal.alertAsync(
        t('connect.updateRequiredTitle'),
        t('connect.legacyPairingUpdateRequiredBody'),
        [
            {
                text: t('connect.scanNewQr'),
                onPress: () => {
                    action = 'scan_new_qr';
                },
            },
            { text: t('common.cancel'), style: 'cancel' },
        ],
    );
    return action;
}
