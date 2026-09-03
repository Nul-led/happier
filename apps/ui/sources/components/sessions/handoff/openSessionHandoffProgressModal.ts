import { Modal } from '@/modal';
import { subscribeActionOperationByRequestId } from '@/sync/domains/actionOperations/subscribeActionOperationByRequestId';
import type { ActionOperationStore } from '@/sync/domains/actionOperations/actionOperationStore';

import { SessionHandoffProgressModal } from './SessionHandoffProgressModal';

export type SessionHandoffProgressPresentation = Readonly<{
    close: () => void;
    isAttached: () => boolean;
}>;

export function openObservedSessionHandoffProgressModal(params: Readonly<{
    requestId: string;
    sessionId: string;
    workspaceSyncEnabled?: boolean;
    store?: ActionOperationStore;
}>): SessionHandoffProgressPresentation {
    let attached = true;
    let unsubscribe = () => {};
    const detach = (): void => {
        if (!attached) return;
        attached = false;
        unsubscribe();
    };
    const modalId = Modal.show({
        component: SessionHandoffProgressModal,
        props: {
            ...(params.workspaceSyncEnabled ? { workspaceSyncEnabled: true } : {}),
        },
        onRequestClose: detach,
        closeOnBackdrop: false,
    });
    unsubscribe = subscribeActionOperationByRequestId({
        requestId: params.requestId,
        ...(params.store ? { store: params.store } : {}),
        onUpdate: (operation) => {
            if (attached) Modal.update(modalId, { operation });
        },
    });
    return Object.freeze({
        close: () => {
            if (!attached) return;
            detach();
            Modal.hide(modalId);
        },
        isAttached: () => attached,
    });
}
