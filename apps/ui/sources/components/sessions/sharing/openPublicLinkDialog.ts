import { Modal } from '@/modal';
import { t } from '@/text';

import type { FocusReturnRef } from '@/keyboard/focusReturn';
import type { SessionPublicLinkPublication } from '@/sync/domains/social/sessionPublicLinkPublication';
import type { CustomModalInjectedProps } from '@/modal';
import type { PublicLinkDialogProps } from './components/PublicLinkDialog';

export async function openPublicLinkDialog(params: Readonly<{
    publicShare: SessionPublicLinkPublication | null;
    serverUrl?: string | null;
    onCreate: (options: {
        expiresInDays?: number;
        maxUses?: number;
        isConsentRequired: boolean;
    }) => Promise<SessionPublicLinkPublication | void> | SessionPublicLinkPublication | void;
    onDelete: () => Promise<void> | void;
    /** The control that opened the dialog; the modal host restores focus to it. */
    focusReturnRef?: FocusReturnRef;
}>): Promise<string> {
    const { PublicLinkDialog } = await import('./components/PublicLinkDialog');
    const modalId = Modal.show({
        component: PublicLinkDialog,
        props: {
            publicShare: params.publicShare,
            serverUrl: params.serverUrl,
            onCreate: async (options) => {
                const createdShare = await Promise.resolve(params.onCreate(options));
                if (createdShare) {
                    Modal.update<PublicLinkDialogProps & CustomModalInjectedProps>(modalId, {
                        publicShare: createdShare,
                    });
                }
            },
            onDelete: params.onDelete,
        },
        chrome: {
            kind: 'card',
            title: t('session.sharing.publicLink'),
            testID: 'public-link-dialog',
            dimensions: { width: 560, maxHeightRatio: 0.85, size: 'md' },
        },
        closeOnBackdrop: true,
        focusReturnRef: params.focusReturnRef,
    });
    return modalId;
}
