import * as React from 'react';

import { StatusPill } from '@/components/ui/status/StatusPill';
import { WORK_STATUS_PILL_VARIANT } from '@/components/work/status/resolveWorkStatusTone';
import { sessionWorkStatusFactsFromStatus } from '@/components/work/status/sessionWorkStatusFacts';
import { useServerCredentialAccountScopes } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { areServerAccountScopesEqual } from '@/sync/domains/scope/serverAccountScope';
import { storage, useSessionListRenderableWithServerScope } from '@/sync/domains/state/storage';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { projectTaskSessionLinks, type TaskSessionLink } from '@/sync/domains/todos/taskSessionLink';
import { useSessionStatus } from '@/utils/sessions/sessionUtils';
import { resolveTaskSessionStatus } from '@/components/zen/model/taskSessionStatus';

function SessionStatusPill({ session }: Readonly<{ session: SessionListRenderableSession }>) {
    // The input is already Home-qualified; never join it to an ambient same-id transcript.
    const awareness = useSessionStatus(session, { subscribeToSession: false, subscribeToTranscript: false });
    const status = resolveTaskSessionStatus({ session, facts: sessionWorkStatusFactsFromStatus(session, awareness) });
    return status ? <StatusPill
        testID="zen-task-session-status"
        label={status.presentation.word}
        variant={WORK_STATUS_PILL_VARIANT[status.presentation.tone]}
        hideDot
        labelVariant="phrase"
        labelNumberOfLines={1}
        style={{ maxWidth: 160, flexShrink: 1 }}
    /> : null;
}

export function TaskSessionStatusPill({ link }: Readonly<{ link: TaskSessionLink }>) {
    const bindings = useServerCredentialAccountScopes([link.serverId]);
    const binding = bindings.get(link.serverId);
    const session = useSessionListRenderableWithServerScope(link.serverId, link.sessionId);
    return session && binding?.isCurrent() && areServerAccountScopesEqual(binding.scope, link)
        ? <SessionStatusPill session={session} />
        : null;
}

/** The latest linked attempt's status, subscribed locally to this task and Session. */
export function TaskStatusPill({ taskId }: Readonly<{ taskId: string }>) {
    const linkedSessions = storage((state) => state.todoState?.todos[taskId]?.linkedSessions);
    const scope = storage((state) => state.profileScope);
    const link = React.useMemo(() => projectTaskSessionLinks({ linkedSessions }, scope)[0], [linkedSessions, scope]);
    return link ? <TaskSessionStatusPill link={link} /> : null;
}
