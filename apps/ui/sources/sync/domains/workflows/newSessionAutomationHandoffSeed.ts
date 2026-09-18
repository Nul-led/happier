import type { AutomationRunExecutionTargetV1 } from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import { buildSessionServerStartSpawnDraftV1FromAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';
import type { SessionAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraft';
import type { NewSessionAutomationDraft } from '@/sync/domains/automations/automationDraft';
import { getTempData, storeTempData } from '@/utils/sessions/tempDataStore';

import { projectLegacyAutomationRecipeToEditorDraft } from './automationRecipeWorkflowDraft';
import { createWorkflowEditorDraft, type WorkflowEditorDraft } from './workflowEditorDraft';

/**
 * New Session's Automation entry, handed to the shared Automation editor.
 *
 * The chip no longer embeds a second settings editor: it transfers the draft
 * the person actually composed — prompt, authoring selections, exact machine
 * and project folder, plus any triggers already chosen — and the shared editor
 * owns it from there. The transfer travels through the existing temporary-data
 * store, so no prompt or setting ever appears in a URL, and the source draft is
 * untouched until the destination owns the handoff.
 */

export type NewSessionAutomationHandoffSeed = Readonly<{
    name: string;
    description: string | null;
    enabled: boolean;
    /** The composed prompt and settings as the canonical one-step definition. */
    draft: WorkflowEditorDraft;
    /** Exact placement, when the composed draft already resolved one. */
    project: WorkflowProjectTargetV1 | null;
    triggers: NewSessionAutomationDraft['triggers'];
}>;

/**
 * Projects the live New Session draft into the shared editor's vocabulary.
 *
 * A composed draft that can produce a canonical spawn carries its complete
 * selection through the same seam a saved one-shot Automation uses. When it
 * cannot — an unresolved machine, or a target that has no spawn — the authored
 * prompt still transfers and the destination shows the placement as
 * unresolved rather than inventing one.
 */
export function buildNewSessionAutomationHandoffSeed(params: Readonly<{
    draftId: string;
    authoring: SessionAuthoringDraft;
    automation: NewSessionAutomationDraft;
}>): NewSessionAutomationHandoffSeed {
    const prompt = params.authoring.prompt;
    const name = params.automation.name.trim();
    const base = {
        name,
        description: params.automation.description.trim() || null,
        enabled: params.automation.enabled,
        triggers: params.automation.triggers,
    };

    let target: AutomationRunExecutionTargetV1 | null = null;
    try {
        target = {
            kind: 'newSession',
            spawn: buildSessionServerStartSpawnDraftV1FromAuthoringDraft({
                draft: params.authoring,
                permissionMode: params.authoring.permissionMode ?? 'default',
                configurationUpdatedAtMs: params.authoring.permissionModeUpdatedAt ?? 0,
            }),
        };
    } catch {
        target = null;
    }

    if (target !== null) {
        const projection = projectLegacyAutomationRecipeToEditorDraft({
            draftId: params.draftId,
            name,
            program: { v: 1, prompt },
            target,
            machineId: null,
        });
        return { ...base, draft: projection.draft, project: projection.project };
    }

    const machineId = params.authoring.executionTarget?.kind === 'machine'
        ? params.authoring.executionTarget.target.machineId
        : null;
    return {
        ...base,
        draft: createWorkflowEditorDraft({
            draftId: params.draftId,
            name,
            blocks: [{
                kind: 'step',
                id: 'step-1',
                document: { text: prompt, references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        }),
        project: machineId === null
            ? null
            : { machineId, directory: params.authoring.directory },
    };
}

const NEW_SESSION_AUTOMATION_HANDOFF_KIND = 'happier.new-session-automation-handoff.v1' as const;

type StoredHandoffSeed = Readonly<{
    kind: typeof NEW_SESSION_AUTOMATION_HANDOFF_KIND;
    seed: NewSessionAutomationHandoffSeed;
}>;

/** Returns the opaque route parameter carrying the composed draft. */
export function storeNewSessionAutomationHandoffSeed(seed: NewSessionAutomationHandoffSeed): string {
    return storeTempData({ kind: NEW_SESSION_AUTOMATION_HANDOFF_KIND, seed } satisfies StoredHandoffSeed);
}

/**
 * Reads the handoff exactly once. Returning through history therefore cannot
 * silently reseed a stale composed draft over edited work.
 */
export function readNewSessionAutomationHandoffSeed(dataId: string): NewSessionAutomationHandoffSeed | null {
    const stored = getTempData<StoredHandoffSeed>(dataId);
    if (stored === null || stored.kind !== NEW_SESSION_AUTOMATION_HANDOFF_KIND) return null;
    return stored.seed;
}
