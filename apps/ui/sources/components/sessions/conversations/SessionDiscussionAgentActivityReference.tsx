import * as React from 'react';
import { Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SessionAgentActivitySummary } from '@/components/sessions/agents/presentation/SessionAgentActivitySummary';
import { resolveSessionAgentActivityPresentation } from '@/components/sessions/agents/presentation/sessionAgentActivityPresentation';
import type { AgentActivityEntry } from '@/sync/domains/session/agentActivity';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';

const stylesheet = StyleSheet.create((theme) => ({
    reference: {
        marginHorizontal: 14,
        marginVertical: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.surface.inset,
    },
    referencePressed: {
        opacity: 0.72,
    },
}));

/**
 * Conversation geometry around the shared Agent-activity identity leaf (Lane 05).
 *
 * Deliberately owns no Run state or presentation rules: the canonical merged entry and shared
 * resolver supply both, while the Discussion host supplies only placement and navigation.
 */
export const SessionDiscussionAgentActivityReference = React.memo((props: Readonly<{
    entry: AgentActivityEntry;
    /** `null` for a headline-only entry the local sources have not paged in. */
    subagent: SessionSubagent | null;
    onPress: () => void;
}>) => {
    const styles = stylesheet;
    const presentation = React.useMemo(() => resolveSessionAgentActivityPresentation({
        entry: props.entry,
        subagent: props.subagent,
    }), [props.entry, props.subagent]);
    const runId = props.entry.runId ?? props.subagent?.runRef?.runId ?? props.subagent?.id ?? props.entry.id;

    return (
        <Pressable
            testID={`session-discussion-agent-activity:${runId}`}
            accessibilityRole="button"
            accessibilityLabel={presentation.accessibilityLabel}
            onPress={props.onPress}
            style={({ pressed }) => [styles.reference, pressed ? styles.referencePressed : null]}
        >
            <SessionAgentActivitySummary
                testID={`session-discussion-agent-activity-summary:${runId}`}
                presentation={presentation}
            />
        </Pressable>
    );
});
