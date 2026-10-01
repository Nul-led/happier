import type { WorkflowRunSummaryV1 } from '@happier-dev/protocol/workflows/workflowProgressV1';

import type { WorkflowLibraryDefinition } from '@/components/workflows/library/workflowLibraryReads';
import { isTerminalWorkflowRunState } from '@/components/workflows/presentation/workflowLifecyclePresentation';

/**
 * What the Workflows column shows from each owner's read (FIN 04 §3.3). Each function is a pure
 * projection: the column never decides a lifecycle, an attention state or a trigger's schedule.
 */

/**
 * Your saved workflows and the ones shared with you. The definition list names the caller's access
 * on each row; a row without it, or with `owner`, is yours.
 */
export function splitLibraryDefinitions(definitions: readonly WorkflowLibraryDefinition[]): Readonly<{
    library: readonly WorkflowLibraryDefinition[];
    sharedWithYou: readonly WorkflowLibraryDefinition[];
}> {
    const library: WorkflowLibraryDefinition[] = [];
    const sharedWithYou: WorkflowLibraryDefinition[] = [];
    for (const definition of definitions) {
        (definition.access === undefined || definition.access === 'owner' ? library : sharedWithYou).push(definition);
    }
    return { library, sharedWithYou };
}

/**
 * How many settled runs the column previews under History. This is a presentation length (lab
 * `nav-N1` draws a short preview under "All runs"), not a bound on what History holds: the full list
 * is one press away.
 */
export const HISTORY_PREVIEW_LENGTH = 5;

/** The column's History preview: settled runs only, so a live run is never listed twice. */
export function selectHistoryPreviewRuns<Run extends Pick<WorkflowRunSummaryV1, 'id' | 'state'>>(runs: readonly Run[]): readonly Run[] {
    return runs.filter((run) => isTerminalWorkflowRunState(run.state)).slice(0, HISTORY_PREVIEW_LENGTH);
}
