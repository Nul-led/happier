import { t } from '@/text';
import { resolveWorkStatusTone, type WorkStatusPresentation } from '@/components/work/status/resolveWorkStatusTone';
import type { SessionWorkStatusFacts } from '@/components/work/status/sessionWorkStatusFacts';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { describeWorkStatusBucket } from '@/components/work/status/workStatusBuckets';

export type TaskSessionStatus = Readonly<{
    state: 'working' | 'needs_you' | 'ready_for_review' | 'failed' | 'stopped';
    presentation: WorkStatusPresentation;
}>;

/** A task's work is reviewable, never automatically Done. Awareness still owns priority. */
export function resolveTaskSessionStatus(input: Readonly<{
    session: Pick<SessionListRenderableSession, 'latestTurnStatus'>;
    facts: SessionWorkStatusFacts;
}> | null): TaskSessionStatus | null {
    if (!input) return null;
    const presentation = resolveWorkStatusTone({ kind: 'session', facts: input.facts });
    const state = input.facts.awareness.operational.primary === 'failed' ? 'failed'
        : presentation.bucket === 'needs_you' ? 'needs_you'
            : presentation.bucket === 'working' ? 'working'
                : presentation.bucket === 'finished' ? 'ready_for_review'
                    : presentation.bucket === 'idle' && input.session.latestTurnStatus === 'cancelled' ? 'stopped'
                        : null;
    if (!state) return null;
    const word = state === 'ready_for_review' ? t('inbox.readySessions')
        : state === 'failed' ? t('inbox.failed')
            : state === 'stopped' ? t('workStatus.task.stopped')
                : describeWorkStatusBucket(state);
    return { state, presentation: { ...presentation, word } };
}
