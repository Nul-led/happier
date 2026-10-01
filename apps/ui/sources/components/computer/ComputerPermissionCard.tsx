import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { ComputerAccessV1, ComputerGrantStatusV1 } from '@happier-dev/protocol';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/** The machine is missing an OS permission the computer owner reports as denied. */
export function needsComputerPermission(grants: ComputerGrantStatusV1, access: ComputerAccessV1 = 'use'): boolean {
    return grants.capture === 'denied' || (access === 'use' && grants.input === 'denied');
}

/** The daemon-side "open the privacy pane" request (W7 `computer.permissions.openSettings`). */
export type ComputerOpenSettingsState = 'idle' | 'opening' | 'opened' | 'failed';

const GRANT_ROWS = [
    { permission: 'capture', title: 'computerUse.permission.capture', hint: 'computerUse.permission.captureHint' },
    { permission: 'input', title: 'computerUse.permission.input', hint: 'computerUse.permission.inputHint' },
] as const;

const STATE_KEY = {
    granted: 'computerUse.permission.allowed',
    denied: 'computerUse.permission.denied',
    unknown: 'computerUse.permission.unknown',
} as const;

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 16,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
    },
    liveLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        maxWidth: 420,
    },
    liveText: {
        ...Typography.rowMeta(),
        flexShrink: 1,
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
    grants: {
        alignSelf: 'center',
        maxWidth: 420,
        width: '100%',
        borderRadius: 12,
        borderCurve: 'continuous',
        backgroundColor: theme.colors.surface.inset,
        paddingHorizontal: 14,
        paddingVertical: 4,
    },
    grant: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
    },
    grantDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.subtle,
    },
    grantText: {
        flex: 1,
        minWidth: 0,
    },
    grantTitle: {
        ...Typography.rowTitle(),
        color: theme.colors.text.primary,
    },
    grantHint: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
    },
    grantState: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    grantStateText: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
    },
    grantStateDenied: {
        color: theme.colors.state.warning.foreground,
    },
}));

/**
 * The OS permission the machine needs first (lab `computer` OG): each permission with its real state
 * from the computer owner, and **Open System Settings on {machine}**, which asks that machine's daemon
 * to open the privacy pane there (so it works from a phone too). Happier never changes the permission
 * itself; Check again re-reads the machine's list.
 */
export function ComputerPermissionCard(props: Readonly<{
    machineName: string;
    grants: ComputerGrantStatusV1;
    openSettings: ComputerOpenSettingsState;
    onOpenSettings: (permission: 'capture' | 'input') => void;
    onCheckAgain: () => void;
    testID?: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const firstDenied = GRANT_ROWS.find((row) => props.grants[row.permission] === 'denied')?.permission ?? 'capture';
    const grantList = (
        <View style={stylesheet.grants} testID={`${props.testID ?? 'computer-permission'}-grants`}>
            {GRANT_ROWS.map((row, index) => {
                const value = props.grants[row.permission];
                const denied = value === 'denied';
                return (
                    <View key={row.permission} style={[stylesheet.grant, index > 0 ? stylesheet.grantDivider : null]}>
                        <View style={stylesheet.grantText}>
                            <Text style={stylesheet.grantTitle}>{t(row.title)}</Text>
                            <Text style={stylesheet.grantHint}>{t(row.hint)}</Text>
                        </View>
                        <View style={stylesheet.grantState}>
                            {value === 'unknown' ? null : (
                                <Icon
                                    name={denied ? 'warning' : 'check'}
                                    size={ICON_SIZE.sm}
                                    color={denied ? theme.colors.state.warning.foreground : theme.colors.text.secondary}
                                />
                            )}
                            <Text style={[stylesheet.grantStateText, denied ? stylesheet.grantStateDenied : null]}>{t(STATE_KEY[value])}</Text>
                        </View>
                    </View>
                );
            })}
        </View>
    );
    const testID = props.testID ?? 'computer-permission';
    const live = props.openSettings === 'opening' || props.openSettings === 'opened';
    return (
        // The card's copy, then what is missing, then the way forward (lab OG): the grant list sits
        // between the explanation and the buttons, so the state card carries no actions of its own.
        <View style={stylesheet.root} testID={testID} accessibilityLiveRegion="polite">
            <SurfaceStateCard
                kind="denied"
                title={t('computerUse.permission.title', { machine: props.machineName })}
                reason={t('computerUse.permission.body')}
            />
            {grantList}
            <View style={stylesheet.actions}>
                <RoundButton
                    size="small"
                    title={t('computerUse.permission.open', { machine: props.machineName })}
                    loading={props.openSettings === 'opening'}
                    onPress={() => props.onOpenSettings(firstDenied)}
                    testID={`${testID}-open-settings`}
                />
                <RoundButton
                    size="small"
                    display="secondary"
                    title={t('computerUse.permission.checkAgain')}
                    onPress={props.onCheckAgain}
                    testID={`${testID}-check-again`}
                />
            </View>
            {live || props.openSettings === 'failed' ? (
                <View style={stylesheet.liveLine}>
                    {live ? <ActivitySpinner size="small" color={theme.colors.text.secondary} /> : null}
                    <Text style={stylesheet.liveText} testID={`${testID}-${live ? 'opened' : 'open-failed'}`}>
                        {live
                            ? t('computerUse.permission.opened', { machine: props.machineName })
                            : t('computerUse.permission.openFailed')}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}
