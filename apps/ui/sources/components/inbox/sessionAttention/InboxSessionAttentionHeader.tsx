import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { SessionContextChips } from '@/components/sessions/context/SessionContextChips';
import { Icon } from '@/components/ui/icons/Icon';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import {
    SessionListIdentity,
    type SessionListIdentityDisplay,
} from '@/components/sessions/shell/SessionListIdentity';
import { SESSION_LIST_ROW_IDENTITY_METRICS } from '@/components/sessions/shell/resolveSessionListDensityViewState';
import type { Session } from '@/sync/domains/state/storageTypes';

export const InboxSessionAttentionHeader = React.memo(function InboxSessionAttentionHeader(props: Readonly<{
    session: Session;
    serverId: string | null;
    identityDisplay: SessionListIdentityDisplay;
    connected: boolean;
    sessionTitle: string;
    machineLabel: string | null;
    pathLabel: string | null;
    onOpenSession: () => void;
}>) {
    const { theme } = useUnistyles();

    return (
        <View style={styles.container}>
            {props.identityDisplay !== 'none' ? (
                <SessionListIdentity
                    session={props.session}
                    display={props.identityDisplay}
                    serverId={props.serverId}
                    color={theme.colors.text.primary}
                    avatarSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.slotSize}
                    agentLogoSize={SESSION_LIST_ROW_IDENTITY_METRICS.compact.agentLogoSize}
                    connected={props.connected}
                    testID={`inbox.session_attention.${props.serverId ?? 'local'}.${props.session.id}.identity`}
                />
            ) : null}
            <View style={styles.titleColumn}>
                <Text style={styles.title} numberOfLines={1}>
                    {props.sessionTitle}
                </Text>
                <SessionContextChips machineLabel={props.machineLabel} pathLabel={props.pathLabel} />
            </View>

            <IconButton
                accessibilityRole="button"
                accessibilityLabel={t('inbox.openSession', { session: props.sessionTitle })}
                variant="plain"
                onPress={props.onOpenSession}
                size={32}
                minimumInteractiveTargetSize={resolveMinimumInteractiveTargetSize(Platform.OS)}
                interactiveTargetGapPx={12}
                icon={<Icon name="arrow-square-out" size={16} color={theme.colors.text.primary} />}
            />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
    },
    titleColumn: {
        flex: 1,
        minWidth: 0,
        gap: 8,
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
}));
