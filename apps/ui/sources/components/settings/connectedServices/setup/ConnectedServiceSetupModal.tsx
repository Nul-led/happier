import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Modal } from '@/modal';
import type { CustomModalInjectedProps } from '@/modal/types';

import { useConnectedServicesIndex } from '../model/useConnectedServicesIndex';
import { buildConnectedServiceSetupCatalog } from './buildConnectedServiceSetupCatalog';
import { ConnectedServiceSetupPanel, type ConnectedServiceSetupTarget } from './ConnectedServiceSetupPanel';

function ConnectedServiceSetupModalContent(props: CustomModalInjectedProps & Readonly<{
    initialTarget: ConnectedServiceSetupTarget;
}>) {
    const { indexModel } = useConnectedServicesIndex({ agents: 'cached' });
    const catalog = React.useMemo(() => buildConnectedServiceSetupCatalog(indexModel), [indexModel]);
    const [target, setTarget] = React.useState(props.initialTarget);
    const { onClose } = props;
    return (
        <View style={styles.frame}>
            <ConnectedServiceSetupPanel
                testID="connected-service-setup-modal"
                chrome="card"
                target={target}
                catalog={catalog}
                onTargetChange={setTarget}
                onClose={onClose}
                onConnected={onClose}
            />
        </View>
    );
}

/**
 * The setup panel where there is no page to grow in (lab AM/AMp): a popover's or a session banner's
 * "Sign in again", or Connect from a surface without room. Same panel, same controller; a modal on
 * wide screens and a sheet on phones through the modal owner.
 */
export function openConnectedServiceSetupModal(target: ConnectedServiceSetupTarget): void {
    let modalId: string | null = null;
    const close = () => {
        if (!modalId) return;
        Modal.hide(modalId);
        modalId = null;
    };
    modalId = Modal.show({
        component: ConnectedServiceSetupModalContent,
        onRequestClose: close,
        props: { initialTarget: target },
    });
}

const styles = StyleSheet.create(() => ({
    frame: {
        width: '100%',
        maxWidth: 640,
        alignSelf: 'center',
    },
}));
