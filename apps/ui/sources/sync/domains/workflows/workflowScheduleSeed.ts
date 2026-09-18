import type {
    WorkflowDefinitionV1,
    WorkflowValidationIssue,
} from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowArtifactRevisionV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import { getTempData, storeTempData } from '@/utils/sessions/tempDataStore';

import { validateWorkflowEditorDraft } from './workflowAuthoring';
import type { WorkflowEditorDraft } from './workflowEditorDraft';

/**
 * The reviewed copy handed to the Automation wrapper by Schedule.
 *
 * Schedule copies content; it does not create a live link. A later library edit
 * or deletion must not change an Automation that was already saved, so the
 * wrapper receives frozen bytes plus honest provenance rather than a pointer to
 * a mutable Artifact.
 *
 * The seed travels through the existing temporary-data store, so the route
 * carries only an opaque id and no prompt, reference or setting ever appears in
 * a URL.
 */

export type WorkflowScheduleOrigin = Readonly<{
    definitionId: string;
    revision: WorkflowArtifactRevisionV1;
    /**
     * False when the editor has unsaved edits. The Automation still records
     * where the content came from, but must not claim it equals that revision.
     */
    matchesSavedRevision: boolean;
}>;

export type WorkflowScheduleSeed = Readonly<{
    name: string;
    /** Exact host-selected project, kept outside the portable definition. */
    project: WorkflowProjectTargetV1;
    /** The normalized definition exactly as reviewed on screen. */
    definition: WorkflowDefinitionV1;
    origin: WorkflowScheduleOrigin | null;
}>;

export type BuildWorkflowScheduleSeedResult =
    | Readonly<{ kind: 'available'; seed: WorkflowScheduleSeed }>
    | Readonly<{ kind: 'invalid'; issues: readonly WorkflowValidationIssue[] }>;

export type WorkflowScheduleSavedContext = Readonly<{
    definitionId: string;
    revision: WorkflowArtifactRevisionV1;
    /** The draft as it stood at that revision, used only to detect local edits. */
    definition: WorkflowEditorDraft;
}>;

/**
 * Freezes the reviewed draft for the Automation wrapper.
 *
 * An invalid draft is refused rather than scheduled: an Automation that cannot
 * run is worse than a visible repair prompt.
 */
export function buildWorkflowScheduleSeed(params: Readonly<{
    draft: WorkflowEditorDraft;
    saved: WorkflowScheduleSavedContext | null;
    project: WorkflowProjectTargetV1;
}>): BuildWorkflowScheduleSeedResult {
    const validation = validateWorkflowEditorDraft(params.draft);
    if (!validation.valid || validation.normalizedDefinition === undefined) {
        return { kind: 'invalid', issues: validation.issues };
    }

    let origin: WorkflowScheduleOrigin | null = null;
    if (params.saved !== null) {
        const savedValidation = validateWorkflowEditorDraft(params.saved.definition);
        const matchesSavedRevision = savedValidation.normalizedDefinition !== undefined
            && JSON.stringify(savedValidation.normalizedDefinition) === JSON.stringify(validation.normalizedDefinition)
            && params.saved.definition.name === params.draft.name;
        origin = {
            definitionId: params.saved.definitionId,
            revision: params.saved.revision,
            matchesSavedRevision,
        };
    }

    return {
        kind: 'available',
        seed: {
            name: params.draft.name,
            project: params.project,
            definition: validation.normalizedDefinition,
            origin,
        },
    };
}

const WORKFLOW_SCHEDULE_SEED_KIND = 'happier.workflow-schedule-seed.v1' as const;

type StoredWorkflowScheduleSeed = Readonly<{
    kind: typeof WORKFLOW_SCHEDULE_SEED_KIND;
    seed: WorkflowScheduleSeed;
}>;

/** Returns the opaque route parameter for a reviewed copy. */
export function storeWorkflowScheduleSeed(seed: WorkflowScheduleSeed): string {
    return storeTempData({ kind: WORKFLOW_SCHEDULE_SEED_KIND, seed } satisfies StoredWorkflowScheduleSeed);
}

/**
 * Reads a seed exactly once. The store is single-use by design, so returning to
 * the wrapper through history cannot silently reschedule stale content.
 */
export function readWorkflowScheduleSeed(dataId: string): WorkflowScheduleSeed | null {
    const stored = getTempData<StoredWorkflowScheduleSeed>(dataId);
    if (stored === null || stored.kind !== WORKFLOW_SCHEDULE_SEED_KIND) return null;
    return stored.seed;
}

export type WorkflowScheduleProvenance = 'unsaved' | 'savedRevision' | 'editedSinceSave';

/**
 * What the wrapper should tell the user about the copy it is about to save.
 * Each case is a different claim, so they stay distinguishable in copy.
 */
export function describeWorkflowScheduleProvenance(
    origin: WorkflowScheduleOrigin | null,
): WorkflowScheduleProvenance {
    if (origin === null) return 'unsaved';
    return origin.matchesSavedRevision ? 'savedRevision' : 'editedSinceSave';
}
