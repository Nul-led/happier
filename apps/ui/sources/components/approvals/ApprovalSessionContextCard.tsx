import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionContextPresentation } from '@/sync/domains/session/presentation/sessionContextPresentation';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { t } from '@/text';
import { SessionContextChips } from '@/components/sessions/context/SessionContextChips';
import { Icon } from '@/components/ui/icons/Icon';
import { readApprovalSessionEndpointLabels } from './approvalEndpointLabels';

export const ApprovalSessionContextCard = React.memo(function ApprovalSessionContextCard(props: Readonly<{
    session: Session | SessionListRenderableSession | null;
    machine: Machine | null;
    serverId: string | null;
    context: SessionContextPresentation | null;
    /** Immutable, secret-free Home origin shown independently of the local route profile. */
    homeDisplayId?: string | null;
    requesterAgentId: string | null;
    requesterSurface: string;
}>) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const sessionTitle = props.session && (!props.serverId || props.context?.mayShowDecryptedContent === true)
        ? getSessionName(props.session)
        : null;
    const endpointLabels = readApprovalSessionEndpointLabels({
        session: props.session,
        machine: props.machine,
    });
    const machineLabel = endpointLabels.machineLabel;
    const pathLabel = props.serverId ? props.context?.workspace?.label ?? null : endpointLabels.pathLabel;
    const homeDisplayId = props.homeDisplayId ?? props.serverId;

    if (!sessionTitle && !pathLabel && !machineLabel && !props.requesterAgentId && !props.requesterSurface) {
        return null;
    }

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <View style={styles.titleColumn}>
                    {sessionTitle ? <Text style={styles.title}>{sessionTitle}</Text> : null}
                    <View style={styles.contextChips}>
                        <SessionContextChips machineLabel={machineLabel} pathLabel={pathLabel} />
                    </View>
                    {props.context?.contextLine ? (
                        <Text style={styles.homeLabel}>{props.context.contextLine}</Text>
                    ) : null}
                    {homeDisplayId ? (
                        <Text style={styles.homeLabel}>{t('actionConfirmations.homeTarget', { serverId: homeDisplayId })}</Text>
                    ) : null}
                </View>

                {props.session?.id ? (
                    <Pressable
                        testID="approvals.open-session"
                        accessibilityRole="button"
                        accessibilityLabel={t('runs.openSession')}
                        onPress={() => router.push(buildScopedSessionRouteHref({
                            sessionId: props.session!.id,
                            serverId: props.serverId,
                        }))}
                        style={({ pressed }) => [styles.openButton, pressed && styles.openButtonPressed]}
                    >
                        <Icon name="arrow-square-out" size={16} color={theme.colors.text.primary} />
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.requesterRow}>
                {props.requesterAgentId ? (
                    <View style={styles.requesterChip}>
                        <Icon name="sparkle" size={14} color={theme.colors.text.secondary} />
                        <Text style={styles.metaText}>{props.requesterAgentId}</Text>
                    </View>
                ) : null}
                <View style={styles.requesterChip}>
                    <Icon name="git-branch" size={14} color={theme.colors.text.secondary} />
                    <Text style={styles.metaText}>{props.requesterSurface}</Text>
                </View>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
        padding: 16,
        gap: 12,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    titleColumn: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    contextChips: {
        marginTop: 8,
    },
    homeLabel: {
        marginTop: 8,
        fontSize: 12,
        color: theme.colors.text.secondary,
    },
    metaText: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        lineHeight: 18,
    },
    openButton: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    openButtonPressed: {
        backgroundColor: theme.colors.surface.pressedOverlay,
    },
    requesterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    requesterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
}));
