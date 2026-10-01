import * as React from 'react';
import { getStorage } from '@/sync/domains/state/storage';
import { createWorkflowTriggerSetSelector } from '@/sync/store/domains/automations';
import type { WorkflowProjectTargetV1, WorkflowTriggerSetV1 } from '@happier-dev/protocol';

import {
    addWorkflowTrigger,
    listWorkflowTriggerSets,
    removeWorkflowTrigger,
    updateWorkflowTrigger,
} from '@/sync/domains/workflows/workflowTriggerActions';

import { formatTriggerSetSummary } from './formatTriggerSummary';
import {
    EMPTY_WORKFLOW_TRIGGER_DRAFT,
    isWorkflowTriggerDraftDirty,
    projectWorkflowTriggerRows,
    saveWorkflowTriggerDraft,
    type WorkflowTriggerDraft,
    type WorkflowTriggerWriter,
} from './workflowTriggerDraft';

const WORKFLOW_TRIGGER_WRITER: WorkflowTriggerWriter = {
    add: (request) => addWorkflowTrigger(request),
    update: (request) => updateWorkflowTrigger(request),
    remove: (request) => removeWorkflowTrigger(request),
};

export type WorkflowTriggerEditing = Readonly<{
    set: WorkflowTriggerSetV1 | null;
    draft: WorkflowTriggerDraft;
    setDraft: (next: WorkflowTriggerDraft) => void;
    dirty: boolean;
    /** The one summary the header chip and the section both show (04 §9.1). */
    summary: string;
    /**
     * Writes the pending trigger delta after the definition was saved (03 §5.3 "Save ordering").
     * `failed` keeps exactly the edits that were not applied.
     */
    save: (workflow: string, isCurrent: () => boolean) => Promise<'saved' | 'failed' | 'stale'>;
}>;

/**
 * The editor's trigger draft (FIN 04 §5.4): this Account's set on the saved workflow, read through
 * `workflow.trigger.list`, and the edits held until Save. Nothing is written while editing.
 */
export function useWorkflowTriggerEditing(params: Readonly<{
    /** The saved workflow, or `null` for a draft never saved (its first Save creates it, then its triggers). */
    definitionId: string | null;
    /** The editor's Where, which seeds the set's one machine when its first trigger is added. */
    projectTarget: WorkflowProjectTargetV1 | null;
}>): WorkflowTriggerEditing {
    const selector = React.useMemo(() => createWorkflowTriggerSetSelector(`workflow:${params.definitionId ?? ''}`, true), [params.definitionId]);
    const sets = getStorage()(selector);
    const set = params.definitionId === null ? null : sets[0] ?? null;
    const [draft, setDraft] = React.useState<WorkflowTriggerDraft>(EMPTY_WORKFLOW_TRIGGER_DRAFT);
    const stateRef = React.useRef({ set, draft, projectTarget: params.projectTarget });
    stateRef.current = { set, draft, projectTarget: params.projectTarget };

    const { definitionId } = params;
    React.useEffect(() => {
        if (definitionId === null) return;
        const controller = new AbortController();
        listWorkflowTriggerSets({ workflow: definitionId }, { signal: controller.signal })
            // Without the read the section shows the draft's own additions; Save still writes them.
            .catch(() => undefined);
        return () => controller.abort();
    }, [definitionId]);

    const save = React.useCallback<WorkflowTriggerEditing['save']>(async (workflow, isCurrent) => {
        const captured = stateRef.current;
        if (!isWorkflowTriggerDraftDirty(captured.draft)) return 'saved';
        const outcome = await saveWorkflowTriggerDraft({
            workflow,
            project: captured.projectTarget,
            set: captured.set,
            draft: captured.draft,
            writer: WORKFLOW_TRIGGER_WRITER,
        });
        if (!isCurrent()) return 'stale';
        // Edits made while saving stay pending; only what was written leaves the draft.
        setDraft((current) => (current === captured.draft
            ? (outcome.kind === 'saved' ? EMPTY_WORKFLOW_TRIGGER_DRAFT : outcome.remaining)
            : current));
        return outcome.kind;
    }, []);

    const summary = React.useMemo(
        () => formatTriggerSetSummary(projectWorkflowTriggerRows(set, draft).map((row) => row.trigger)),
        [draft, set],
    );
    return { set, draft, setDraft, dirty: isWorkflowTriggerDraftDirty(draft), summary, save };
}
