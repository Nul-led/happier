import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Modal } from '@/modal';
import { t } from '@/text';

import { ExactHomeDestinationNotice } from '@/components/account/auth/ExactHomeDestinationNotice';
import { useExactHomeArrival } from '@/components/account/auth/useExactHomeDestination';

import { EmailPasswordAuthPanel, type EmailPasswordAuthOutcome, type EmailPasswordAuthPanelProps } from './EmailPasswordAuthPanel';

type HostProps = Omit<EmailPasswordAuthPanelProps, 'onBack'> & Readonly<{
    onClose: () => void;
    /**
     * Activation of the exact Home this modal just authenticated against, when
     * the host has one. Returning `false` means the device did not get there, and
     * this modal is the only surface still mounted — so it keeps the shared
     * blocked state and its focus-only retry instead of closing over a completed
     * login whose destination never opened.
     */
    reachExactHome?: () => Promise<boolean>;
}>;

const EmailPasswordAuthModalHost = React.memo(function EmailPasswordAuthModalHost(props: HostProps) {
    const { onClose, onAuthenticated, reachExactHome, ...panelProps } = props;
    const arrival = useExactHomeArrival();
    // Closing belongs to the arrival itself so the retry path settles the same
    // way the first attempt does; nothing here re-runs the login.
    const reach = React.useCallback(async (): Promise<boolean> => {
        const reached = await reachExactHome!();
        if (reached) onClose();
        return reached;
    }, [onClose, reachExactHome]);

    if (arrival.state.kind !== 'idle') {
        return (
            <View style={styles.arrival}>
                <ExactHomeDestinationNotice
                    testID="email-password-modal-destination-home"
                    state={arrival.state}
                />
            </View>
        );
    }

    return (
        <EmailPasswordAuthPanel
            {...panelProps}
            onAuthenticated={async (outcome) => {
                await onAuthenticated(outcome);
                if (!reachExactHome) {
                    onClose();
                    return;
                }
                await arrival.continueThrough(reach);
            }}
            onBack={onClose}
        />
    );
});

/**
 * Present the shared native email/password controller from a surface that has
 * no dedicated auth step of its own — today the Welcome/onboarding entry. The
 * controller, its clients and its recovery states are the same ones the shared
 * auth-entry surface embeds; only the host differs.
 */
export function presentEmailPasswordAuthentication(
    input: Omit<HostProps, 'onClose'>,
): void {
    Modal.show({
        component: EmailPasswordAuthModalHost,
        props: input,
        chrome: {
            kind: 'card',
            title: input.action === 'provision'
                ? t('settingsAccount.nativePassword.createTitle')
                : input.action === 'connect'
                    ? t('settingsAccount.nativePassword.connectTitle')
                    : t('settingsAccount.nativePassword.title'),
            dimensions: { size: 'md' },
        },
    });
}

const styles = StyleSheet.create(() => ({
    arrival: { gap: 12, width: '100%' },
}));

export type { EmailPasswordAuthOutcome };
