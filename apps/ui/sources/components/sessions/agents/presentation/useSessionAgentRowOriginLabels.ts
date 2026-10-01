import * as React from 'react';
import type { ExecutionRunLaunchOrigin } from '@happier-dev/protocol';

import { useSessionDiscussionTitles } from '@/components/sessions/conversations/useSessionDiscussionTitles';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import { t } from '@/text';

const NO_LABELS: ReadonlyMap<string, string> = new Map();

/** The Session conversation a Run was launched from, when it was launched from one here. */
export function readRunDiscussionOrigin(
    origin: ExecutionRunLaunchOrigin | null | undefined,
    sessionId: string,
): Readonly<{ discussionId: string; messageCount: number }> | null {
    if (!origin || origin.kind !== 'session_discussion' || origin.sessionId !== sessionId) return null;
    return { discussionId: origin.discussionId, messageCount: origin.messageIds.length };
}

/** "from Relay retry plan", or "from a conversation" while the title is unknown. */
export function formatRunDiscussionOriginLabel(title: string | null | undefined): string {
    const trimmed = title?.trim();
    return trimmed
        ? t('sessionConversation.origin.fromConversation', { title: trimmed })
        : t('sessionConversation.origin.fromUntitled');
}

/**
 * Where each roster row came from, keyed by subagent id — today only Agent conversations started
 * from a human conversation in this Session (Ask Agent). Rows with any other origin get no label.
 */
export function useSessionAgentRowOriginLabels(input: Readonly<{
    sessionId: string;
    serverId: string | null;
    subagents: readonly SessionSubagent[];
}>): ReadonlyMap<string, string> {
    const origins = React.useMemo(() => {
        const bySubagentId = new Map<string, string>();
        for (const subagent of input.subagents) {
            const origin = readRunDiscussionOrigin(subagent.runRef?.launchOrigin, input.sessionId);
            if (origin) bySubagentId.set(subagent.id, origin.discussionId);
        }
        return bySubagentId;
    }, [input.sessionId, input.subagents]);
    const discussionIds = React.useMemo(() => [...new Set(origins.values())].sort(), [origins]);
    const address = React.useMemo(
        () => discussionIds.length > 0 ? normalizeSessionAddress(input.serverId, input.sessionId) : null,
        [discussionIds.length, input.serverId, input.sessionId],
    );
    const titles = useSessionDiscussionTitles({ address, discussionIds });
    return React.useMemo(() => {
        if (origins.size === 0) return NO_LABELS;
        const labels = new Map<string, string>();
        for (const [subagentId, discussionId] of origins) {
            labels.set(subagentId, formatRunDiscussionOriginLabel(titles.get(discussionId)));
        }
        return labels;
    }, [origins, titles]);
}
