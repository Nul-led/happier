import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { SetupSteps } from '@/components/ui/setupBlocks/SetupSteps';
import { t } from '@/text';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import { openExternalUrl } from '@/utils/url/openExternalUrl';

import { ConnectedServiceSetupFlowActions } from '../setup/ConnectedServiceSetupFlowBody';
import { ConnectedAccountFormSection } from './ConnectedAccountFormSection';

function formatExpiry(msLeft: number): string {
    const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The code's remaining life, ticking once a second in this leaf only while the code is shown. */
function useCodeExpiry(expiresAtMs: number | undefined): number | null {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (expiresAtMs === undefined) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [expiresAtMs]);
    return expiresAtMs === undefined ? null : expiresAtMs - now;
}

/**
 * Signing in with a code (lab `csvc` A2): the code is the hero, beside Copy and the one primary
 * action — open the page where it is entered. Underneath, the present: waiting for approval, and how
 * long the code lasts. Happier checks by itself; "Check now" and "Try again" stay as quiet recovery.
 */
export const ConnectedAccountDeviceForm = React.memo(function ConnectedAccountDeviceForm(props: Readonly<{
    /** Inside the new-account draft row instead of as page sections. */
    embedded?: boolean;
    verificationUri?: string;
    verificationUriComplete?: string;
    userCode?: string;
    /** When the code stops working (the provider's own expiry). */
    expiresAtMs?: number;
    /** The service's name, so the action says where it goes ("Open ChatGPT"). */
    serviceTitle?: string;
    busy: boolean;
    /** In a setup panel: Cancel (local), at the end of the recovery line. */
    onCancel?: () => void;
    onPoll(): Promise<void> | void;
    onResume(): Promise<void> | void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const openUrl = props.verificationUriComplete ?? props.verificationUri ?? '';
    const where = props.verificationUri ? props.verificationUri.replace(/^https?:\/\//, '') : null;
    const msLeft = useCodeExpiry(props.expiresAtMs);
    const expired = msLeft !== null && msLeft <= 0;
    const [copied, setCopied] = React.useState(false);
    const service = props.serviceTitle ?? null;
    const code = (
        <View style={[styles.codeBox, expired ? styles.expired : null]}>
            <Text
                testID="connected-account-device:code"
                selectable
                style={styles.code}
                accessibilityLabel={props.userCode ? props.userCode.split('').join(' ') : undefined}
            >
                {props.userCode ?? t('connectedServices.deviceAuth.preparing')}
            </Text>
            {props.userCode ? (
                <RoundButton
                    testID="connected-account-device:copy"
                    size="small"
                    display="secondary"
                    title={copied ? t('common.copied') : t('common.copy')}
                    onPress={async () => {
                        setCopied(await setClipboardStringSafe(props.userCode ?? ''));
                    }}
                />
            ) : null}
        </View>
    );
    const open = (
        <RoundButton
            testID="connected-account-device:open"
            size="small"
            title={service
                ? t('connectedServicesSettings.deviceOpenService', { service })
                : t('connectedServices.deviceAuth.openVerificationUrl')}
            disabled={props.busy || !openUrl || expired}
            onPress={() => {
                void openExternalUrl(openUrl);
            }}
        />
    );
    const wait = (
        <View style={styles.wait}>
            <View style={styles.waiting} accessibilityLiveRegion="polite">
                {expired ? (
                    <>
                        <Icon name="clock" size={15} color={theme.colors.text.secondary} />
                        <Text style={styles.expiredText}>{t('connectedServicesSettings.deviceExpired')}</Text>
                    </>
                ) : (
                    <>
                        <ActivitySpinner size={14} color={theme.colors.accent.blue} />
                        <Text style={styles.waitingText}>{service
                            ? t('connectedServicesSettings.deviceWaitingFor', { service })
                            : t('connectedServices.deviceAuth.waiting')}</Text>
                    </>
                )}
                <View style={styles.grow} />
                {msLeft !== null && !expired ? (
                    <Text style={styles.expiry}>{t('connectedServicesSettings.deviceExpiresIn', { time: formatExpiry(msLeft) })}</Text>
                ) : null}
            </View>
            <View style={styles.recovery}>
                <RoundButton
                    testID="connected-account-device:poll"
                    size="small"
                    display="secondary"
                    title={t('connectedServicesSetup.deviceCheckNow')}
                    disabled={props.busy || expired}
                    loading={props.busy}
                    onPress={props.onPoll}
                />
                <RoundButton
                    testID="connected-account-device:resume"
                    size="small"
                    display={expired ? 'default' : 'secondary'}
                    title={expired ? t('connectedServicesSettings.deviceNewCode') : t('common.retry')}
                    disabled={props.busy}
                    onPress={props.onResume}
                />
                {props.onCancel ? (
                    <>
                        <View style={styles.grow} />
                        <ConnectedServiceSetupFlowActions onCancel={props.onCancel} />
                    </>
                ) : null}
            </View>
        </View>
    );
    return (
        <ConnectedAccountFormSection embedded={props.embedded}>
            <View style={props.embedded ? null : styles.page}>
                <SetupSteps
                    testID="connected-account-device:steps"
                    steps={[
                        { key: 'copy', state: copied ? 'done' : 'current', title: t('connectedServicesSetup.deviceStepCopy'), body: code },
                        {
                            key: 'open',
                            state: copied ? 'current' : 'upcoming',
                            title: service
                                ? t('connectedServicesSetup.deviceStepOpen', { service })
                                : t('connectedServices.deviceAuth.openVerificationUrl'),
                            detail: where ? t('connectedServicesSetup.deviceStepOpenWhere', { where }) : undefined,
                            body: open,
                        },
                        {
                            key: 'approve',
                            title: service
                                ? t('connectedServicesSetup.deviceStepApprove', { service })
                                : t('connectedServices.deviceAuth.waiting'),
                            body: wait,
                        },
                    ]}
                />
            </View>
        </ConnectedAccountFormSection>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    page: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    codeBox: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 18,
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
    },
    expired: {
        opacity: 0.45,
    },
    code: {
        ...Typography.mono('semiBold'),
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: 4,
        color: theme.colors.text.primary,
    },
    wait: {
        flex: 1,
        minWidth: 0,
        gap: 10,
    },
    waiting: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    waitingText: {
        ...Typography.default(),
        fontSize: 12.5,
        lineHeight: 17,
        color: theme.colors.text.secondary,
    },
    expiredText: {
        ...Typography.default(),
        fontSize: 12.5,
        lineHeight: 17,
        color: theme.colors.text.primary,
    },
    grow: {
        flex: 1,
    },
    expiry: {
        ...Typography.default(),
        fontSize: 12.5,
        lineHeight: 17,
        color: theme.colors.text.tertiary,
        fontVariant: ['tabular-nums'],
    },
    recovery: {
        flexDirection: 'row',
        gap: 8,
    },
}));
