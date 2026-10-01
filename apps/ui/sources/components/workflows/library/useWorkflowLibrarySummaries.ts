import * as React from 'react';

import type { WorkflowRunSummariesResultV1 } from '@happier-dev/protocol/workflows/actionsV1';

import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { summarizeWorkflowRuns } from '@/sync/domains/workflows/workflowRunListActions';
import { subscribeVisibleWorkflowRunListInvalidation } from '@/sync/domains/workflows/workflowRunListInvalidation';

import { WORKFLOW_RUN_STRIP_LENGTH } from './workflowRunStrip';

export type WorkflowLibraryRunSummary = WorkflowRunSummariesResultV1['summaries'][number];

/**
 * The library home's one per-definition run summary read (03 §6.6, INT §3.1 #10): one
 * `workflow.run.summaries` call for the rendered page of saved-workflow rows, then one more for any
 * `remainingSourceArtifactIds` the byte budget did not serve. No per-row reads. `null` while the read
 * has not answered (or never could): the strip, "last run" and Needs you are then omitted, never guessed.
 * It reads again on the Account's Run-change wake, keeping the last answer meanwhile.
 */
export function useWorkflowLibrarySummaries(
    sourceArtifactIds: readonly string[],
): ReadonlyMap<string, WorkflowLibraryRunSummary> | null {
    const [summaries, setSummaries] = React.useState<ReadonlyMap<string, WorkflowLibraryRunSummary> | null>(null);
    const [wake, setWake] = React.useState(0);
    // One read per distinct page of ids, not per render.
    const key = sourceArtifactIds.join('\u0000');

    React.useEffect(() => {
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        return subscribeVisibleWorkflowRunListInvalidation({
            lifetime,
            isVisibleWindowLoaded: () => true,
            invalidate: () => setWake((value) => value + 1),
        });
    }, []);

    React.useEffect(() => {
        const ids = key.length === 0 ? [] : key.split('\u0000');
        if (ids.length === 0) {
            setSummaries(new Map());
            return;
        }
        const lifetime = captureActiveServerAccountScopeLifetime();
        if (lifetime === null) return;
        let cancelled = false;
        void (async () => {
            const collected = new Map<string, WorkflowLibraryRunSummary>();
            let pending: readonly string[] = ids;
            try {
                while (pending.length > 0) {
                    const page = await summarizeWorkflowRuns({ sourceArtifactIds: pending, recent: WORKFLOW_RUN_STRIP_LENGTH });
                    if (cancelled || !lifetime.isCurrent()) return;
                    for (const summary of page.summaries) collected.set(summary.sourceArtifactId, summary);
                    // The server serves what fits its byte budget and names the rest; a page that
                    // serves nothing would never finish, so it ends the read instead.
                    if (page.summaries.length === 0) break;
                    pending = page.remainingSourceArtifactIds;
                }
                setSummaries(collected);
            } catch {
                // A failed refresh keeps the last answer; with none, the facts stay omitted.
            }
        })();
        return () => { cancelled = true; };
    }, [key, wake]);

    return summaries;
}
