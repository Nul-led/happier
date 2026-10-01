import { Modal } from '@/modal';
import { t } from '@/text';
import type { ConnectHomeAtAddressResult } from '@/sync/ops/home/connectHomeAtAddress';

export async function confirmInsecureHomeHttp(): Promise<boolean> {
    return Boolean(await Modal.confirm(
        t('server.insecureHttpUrlTitle'),
        t('server.insecureHttpUrlBody'),
        { confirmText: t('common.ok'), cancelText: t('common.cancel') },
    ));
}

export async function confirmCanonicalHomeUrl(): Promise<boolean> {
    return Boolean(await Modal.confirm(
        t('server.useCanonicalServerUrlTitle'),
        t('server.useCanonicalServerUrlBody'),
        { confirmText: t('common.use'), cancelText: t('common.keep') },
    ));
}

export function homeConnectFailureMessage(result: ConnectHomeAtAddressResult): string | null {
    switch (result.kind) {
        case 'connected':
        case 'declined':
            return null;
        case 'invalid_address':
            return t('errors.invalidFormat');
        case 'mixed_content':
            return t('homeAdd.mixedContent');
        case 'unreachable':
            return t('homesJourneys.homeUnreachable');
        default:
            return t('errors.operationFailed');
    }
}
