import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import type { SessionAgentActivityRow } from '@/components/sessions/agents/presentation/sessionAgentActivityRows';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import { t } from '@/text';

import { groupSessionSubagents } from './groupSessionSubagents';
import { SessionSubagentGroup } from './SessionSubagentGroup';

const stylesheet = StyleSheet.create((theme) => ({
    section: {
        gap: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    title: {
        color: theme.colors.text.secondary,
        fontSize: 14,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    // The canonical badge shape (components/ui/status/StatusPill): background-only, 8px radius. A
    // bordered capsule counting agents was a different species from every other count in the app.
    countPill: {
        minWidth: 22,
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 0,
        backgroundColor: theme.colors.state.neutral.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    countText: {
        color: theme.colors.state.neutral.foreground,
        fontSize: 12,
        fontWeight: '700',
    },
    empty: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
}));

export const SessionSubagentList = React.memo((props: Readonly<{
    sessionId: string;
    serverId?: string | null;
    testID: string;
    title: string;
    emptyLabel: string;
    /**
     * Merged entry + local row pairs, in roster order. The entry carries the canonical
     * status and attention; the subagent carries the operational handles a control needs.
     * Passing them together is what removed the host-local `pendingPermissionById` index.
     */
    rows: readonly SessionAgentActivityRow[];
    activityPreviewById: ReadonlyMap<string, string>;
    onOpenPreview: (subagent: SessionSubagent) => void;
    onOpenFull: (subagent: SessionSubagent) => void;
    onOpenAdvanced: (subagent: SessionSubagent) => void;
    onLaunchTeammate?: ((teamId: string) => void) | null;
}>) => {
    const styles = stylesheet;
    const groups = React.useMemo(() => groupSessionSubagents(props.rows), [props.rows]);

    return (
        <View testID={props.testID} style={styles.section}>
            <View style={styles.header}>
                <Text style={styles.title}>{props.title}</Text>
                <View testID={`session-agents-section-count:${props.testID}`} style={styles.countPill}>
                    <Text style={styles.countText}>{t('session.subagents.panel.sectionCount', { count: props.rows.length })}</Text>
                </View>
            </View>
            {groups.length === 0 ? (
                <Text style={styles.empty}>{props.emptyLabel}</Text>
            ) : groups.map((group) => (
                <SessionSubagentGroup
                    key={group.key}
                    sessionId={props.sessionId}
                    serverId={props.serverId}
                    label={group.label}
                    rows={group.items}
                    activityPreviewById={props.activityPreviewById}
                    onOpenPreview={props.onOpenPreview}
                    onOpenFull={props.onOpenFull}
                    onOpenAdvanced={props.onOpenAdvanced}
                    onLaunchTeammate={props.onLaunchTeammate}
                />
            ))}
        </View>
    );
});
