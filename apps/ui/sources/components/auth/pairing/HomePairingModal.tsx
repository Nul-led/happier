import * as React from 'react';

import { Modal, type CustomModalInjectedProps } from '@/modal';
import { t } from '@/text';

import { HomePairingPanel, type HomePairingPurpose } from './HomePairingPanel';

/** Lab I5: the panel at its centred modal width. */
const HOME_PAIRING_MODAL_WIDTH_PX = 460;

function HomePairingModalContent(props: CustomModalInjectedProps & Readonly<{ purpose: HomePairingPurpose }>) {
    return (
        <HomePairingPanel
            purpose={props.purpose}
            layout="modal"
            testIDPrefix="home-pairing-modal"
            onClose={props.onClose}
        />
    );
}

/**
 * The pairing panel as a modal (lab I5), for entry points with no Get set up tile to grow: the page
 * stays where it is behind it. The code lives while the modal is open; closing it cancels the code.
 */
export function showHomePairingModal(purpose: HomePairingPurpose = 'phone'): void {
    Modal.show({
        component: HomePairingModalContent,
        props: { purpose },
        chrome: {
            kind: 'card',
            header: 'none',
            title: purpose === 'phone' ? t('settings.addYourPhone') : t('homeSetup.installComputerTitle'),
            dimensions: { width: HOME_PAIRING_MODAL_WIDTH_PX },
        },
    });
}
