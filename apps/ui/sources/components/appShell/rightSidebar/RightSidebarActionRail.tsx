import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { PANE_ACTION_RAIL_WIDTH } from '@/components/appShell/panes/PaneActionRailContext';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { TabBadge } from '@/components/ui/navigation/tabBadge/TabBadge';
import { t } from '@/text';

export type RightSidebarRailAction = Readonly<{
    id: string;
    label: string;
    icon: IconName;
    active: boolean;
    disabled?: boolean;
    onPress: () => void;
    badgeCount?: number;
    badge?: React.ReactNode;
    tooltipContent?: React.ReactNode;
    /**
     * What the action works on (the session rail: code · the session · the machine). A hairline
     * separates consecutive actions of different groups; the order stays the caller's.
     */
    group?: string;
}>;

const styles = StyleSheet.create((theme) => ({
    rail: {
        width: PANE_ACTION_RAIL_WIDTH,
        flexGrow: 0,
        flexShrink: 0,
        minHeight: 0,
    },
    actions: { alignItems: 'center', paddingVertical: 4, gap: 4 },
    separator: {
        alignSelf: 'stretch',
        marginHorizontal: 10,
        marginVertical: 4,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border.default,
    },
    marker: {
        position: 'absolute', left: -9, top: 0, bottom: 0,
        width: 2, borderRadius: 1, backgroundColor: theme.colors.text.primary,
    },
}));

export function RightSidebarActionRail(props: Readonly<{
    actions: readonly RightSidebarRailAction[];
    testID?: string;
    testIDPrefix?: string;
}>) {
    const { theme } = useUnistyles();
    const prefix = props.testIDPrefix ?? 'right-sidebar-action-rail';
    return (
        <ScrollView
            testID={props.testID ?? 'right-sidebar-action-rail'}
            accessibilityRole="toolbar"
            accessibilityLabel={t('common.actions')}
            style={styles.rail}
            contentContainerStyle={styles.actions}
            showsVerticalScrollIndicator={false}
        >
            {props.actions.map((action, index) => (
                <React.Fragment key={action.id}>
                {index > 0 && action.group !== undefined && action.group !== props.actions[index - 1]!.group ? (
                    <View testID={`${prefix}:separator:${action.group}`} style={styles.separator} />
                ) : null}
                <IconButton
                    testID={`${prefix}:${action.id}`}
                    accessibilityLabel={action.label}
                    tooltip={action.label}
                    tooltipContent={action.tooltipContent}
                    tooltipPlacement="left"
                    selected={action.active}
                    selectedBackground={false}
                    disabled={action.disabled}
                    onPress={action.onPress}
                    variant="plain"
                    size={Platform.OS === 'web' ? 36 : Platform.OS === 'android' ? 48 : 44}
                    iconSize={18}
                    icon={(
                        <View pointerEvents="none">
                            {action.active ? <View style={styles.marker} /> : null}
                            <Icon name={action.icon} size={18} color={action.active ? theme.colors.text.primary : theme.colors.text.secondary} />
                            {action.badge}
                            {(action.badgeCount ?? 0) > 0 ? <TabBadge size="compact" variant="count" value={action.badgeCount ?? 0} tone="neutral" testID={`${prefix}:${action.id}:badge`} /> : null}
                        </View>
                    )}
                />
                </React.Fragment>
            ))}
        </ScrollView>
    );
}
