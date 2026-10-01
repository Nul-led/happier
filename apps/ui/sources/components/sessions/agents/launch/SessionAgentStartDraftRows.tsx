import * as React from 'react';
import { View } from 'react-native';

import { SessionAgentActivitySummary } from '@/components/sessions/agents/presentation/SessionAgentActivitySummary';
import type { SessionAgentActivityPresentation } from '@/components/sessions/agents/presentation/sessionAgentActivityPresentation';
import { WorkRowShell } from '@/components/sessions/work/WorkItemRow';
import type { IconName } from '@/components/ui/icons/Icon';
import { t } from '@/text';

import type { AgentStartDraft } from './agentStartDrafts';

const DRAFT_ICON: Readonly<Record<'conversation' | 'review' | 'plan' | 'delegate', IconName>> = {
    conversation: 'chat-circle',
    review: 'shield-check',
    plan: 'list-checks',
    delegate: 'arrow-elbow-down-right',
};

function presentDraft(draft: AgentStartDraft): SessionAgentActivityPresentation {
    const kind = draft.intent ?? 'conversation';
    const title = t(`agentStart.startRow.${kind}` as const);
    const subtitle = t('agentStart.startRow.subtitle');
    return {
        title,
        phase: 'finished',
        agentId: null,
        startedAtMs: null,
        atMs: null,
        // A finished-phase line ends with its status label: "Draft · starts when you send".
        facts: [],
        statusLabel: subtitle,
        statusTone: 'neutral',
        attention: null,
        iconName: DRAFT_ICON[kind],
        accentName: null,
        accessibilityLabel: `${title}, ${subtitle}`,
    };
}

/**
 * The Start row (lab `convo-S1`/`S3`: "New review · Draft · starts when you send"): each unsent start
 * open beside the Session sits at the head of the Work list until its first Send turns it into its
 * Run, so a draft is never lost behind other tabs. Pressing it brings that draft forward.
 */
export const SessionAgentStartDraftRows = React.memo((props: Readonly<{
    drafts: readonly AgentStartDraft[];
    onOpen: (tabKey: string) => void;
}>) => {
    if (props.drafts.length === 0) return null;
    return (
        <View testID="session-work-start-drafts">
            {props.drafts.map((draft) => (
                <SessionAgentStartDraftRow key={draft.tabKey} draft={draft} onOpen={props.onOpen} />
            ))}
        </View>
    );
});

const SessionAgentStartDraftRow = React.memo((props: Readonly<{
    draft: AgentStartDraft;
    onOpen: (tabKey: string) => void;
}>) => {
    const { draft, onOpen } = props;
    const presentation = React.useMemo(() => presentDraft(draft), [draft]);
    const onPress = React.useCallback(() => onOpen(draft.tabKey), [draft.tabKey, onOpen]);
    return (
        <WorkRowShell
            testID={`session-work-start-draft:${draft.tabKey}`}
            accessibilityLabel={presentation.accessibilityLabel}
            selected={draft.active}
            onPress={onPress}
        >
            <SessionAgentActivitySummary testID={`session-work-start-draft-summary:${draft.tabKey}`} presentation={presentation} />
        </WorkRowShell>
    );
});
