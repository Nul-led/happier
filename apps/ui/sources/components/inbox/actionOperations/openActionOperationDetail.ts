import { Modal } from '@/modal';
import { t } from '@/text';
import type { ActionOperationAddress } from '@/sync/domains/actionOperations/qualifiedActionOperation';

import { ActionOperationDetailModal } from './ActionOperationDetailModal';

/** Canonical imperative entrypoint for launcher receipt binding and Inbox row reopen. */
export function openActionOperationDetail(address: ActionOperationAddress): void {
    if (!address.serverId?.trim()) return;
    Modal.show({
        component: ActionOperationDetailModal,
        props: address,
        closeOnBackdrop: true,
        accessibilityLabel: t('inbox.actionOperations.detailAccessibilityLabel'),
    });
}
