import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useDeviceType } from '@/utils/platform/responsive';
import { Modal } from '@/modal';

import { AgentSignInTerminal } from './AgentSignInTerminal';
import type { AgentSignInTerminalTarget } from './signInTerminalHost';

/**
 * The agent's own sign-in for surfaces with no bottom pane (Home's composer popover, phones): the same
 * view in a modal — the phone sheet (link first, terminal behind a disclosure, lab T1p), or the
 * terminal-and-panel layout on wide screens.
 */
export function showAgentSignInTerminalSheet(target: AgentSignInTerminalTarget): void {
    let modalId: string | null = null;
    const close = () => {
        if (!modalId) return;
        Modal.hide(modalId);
        modalId = null;
    };
    modalId = Modal.show({
        component: AgentSignInTerminalModal,
        onRequestClose: close,
        props: { target, onClose: close },
    });
}

function AgentSignInTerminalModal(props: Readonly<{ target: AgentSignInTerminalTarget; onClose: () => void }>) {
    const phone = useDeviceType() === 'phone';
    return (
        <View style={phone ? styles.sheet : styles.wide}>
            <AgentSignInTerminal {...props.target} layout={phone ? 'sheet' : 'pane'} onClose={props.onClose} />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    sheet: {
        width: '100%',
        maxHeight: '90%',
        backgroundColor: theme.colors.surface.base,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
    },
    wide: {
        width: 880,
        maxWidth: '96%',
        height: 360,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface.base,
    },
}));
