import * as React from 'react';
import { Modal } from '@/modal';
import type { CustomModalInjectedProps } from '@/modal/types';
import { t } from '@/text';
import { DocumentShareSheet, type DocumentShareSheetProps } from './DocumentShareSheet';

type DocumentShareModalProps = CustomModalInjectedProps & Omit<DocumentShareSheetProps, 'onRequestClose' | 'presentation'>;

function DocumentShareModal(props: DocumentShareModalProps): React.ReactElement {
    const { onClose, setChrome: _setChrome, ...sheet } = props;
    return <DocumentShareSheet {...sheet} presentation="full" onRequestClose={onClose} />;
}

/**
 * The one share action for documents: a host's existing share slot (a workflow, role or launch
 * profile) calls this with the document and its name; the sheet does the rest.
 */
export function showDocumentShareSheet(params: Omit<DocumentShareSheetProps, 'onRequestClose' | 'presentation'> & Readonly<{
    name: string;
    /** The one fact that identifies the document, for example "Workflow · 6 steps". */
    subtitle?: string;
}>): void {
    const { name, subtitle, ...sheet } = params;
    Modal.show({
        component: DocumentShareModal,
        props: sheet,
        chrome: {
            kind: 'card',
            testID: 'document-share-modal',
            title: t('shareSheet.documents.shareTitle', { name }),
            ...(subtitle ? { subtitle } : {}),
            // The sheet's list owns its scrolling, like every other list hosted in a card.
            scrollHost: 'body',
            bodyScroll: 'none',
            dimensions: { width: 560, maxHeightRatio: 0.92, size: 'md' },
        },
        closeOnBackdrop: true,
    });
}
