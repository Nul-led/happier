import {
    AutomationStoredWorkflowDefinitionRecipeV2Schema,
    AutomationStoredWorkflowDefinitionV2Schema,
    type AutomationStoredWorkflowDefinitionRecipeV2,
} from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { AutomationTemplateEncryptionMaterialUnavailableError } from '@/sync/domains/automations/automationTemplateAvailability';

import type { WorkflowScheduleSeed } from './workflowScheduleSeed';

/** The reviewed definition an Automation's workflow recipe seals, once opened. */
export type OpenedAutomationWorkflowDefinition =
    ReturnType<typeof AutomationStoredWorkflowDefinitionV2Schema.parse>;

/**
 * Opens the frozen workflow copy of a saved Automation for editing.
 *
 * This is the reader half of the writer below, and it deliberately uses the
 * same Account-mode envelope contract as the incumbent one-shot recipe reader
 * (`openAutomationRecipeForAuthoring`): a plain Account reads `{t:'plain'}`
 * directly, an E2EE Account decrypts through the caller's Account codec, and
 * unavailable material fails closed rather than presenting an empty editor that
 * would overwrite the stored definition on Save.
 */
export async function openAutomationWorkflowRecipeForAuthoring(params: Readonly<{
    recipe: AutomationStoredWorkflowDefinitionRecipeV2;
    decryptRaw?: (ciphertext: string) => Promise<unknown | null>;
    isCurrent?: () => boolean;
}>): Promise<OpenedAutomationWorkflowDefinition> {
    const recipe = AutomationStoredWorkflowDefinitionRecipeV2Schema.parse(params.recipe);
    const isCurrent = params.isCurrent ?? (() => true);
    const opened = recipe.workflow.t === 'plain'
        ? recipe.workflow.v
        : params.decryptRaw
            ? await params.decryptRaw(recipe.workflow.c)
            : null;
    if (!isCurrent()) throw new Error('Automation authoring authority changed');
    const parsed = AutomationStoredWorkflowDefinitionV2Schema.safeParse(opened);
    if (!parsed.success) throw new AutomationTemplateEncryptionMaterialUnavailableError();
    return parsed.data;
}

/**
 * Builds the Automation recipe that freezes a reviewed workflow copy.
 *
 * Schedule copies content, so this writes an immutable accepted snapshot rather
 * than a pointer: a later library edit or deletion cannot change an Automation
 * that was already saved. Validation, normalization and the snapshot shape all
 * come from the canonical Protocol owners; this adapter only chooses the
 * Account-mode envelope and the template version.
 */
export async function buildAutomationWorkflowRecipe(params: Readonly<{
    credentials: AuthCredentials;
    automationId: string;
    templateVersion: number;
    seed: WorkflowScheduleSeed;
    encryptRaw?: (value: unknown) => Promise<string>;
    isCurrent?: () => boolean;
}>): Promise<AutomationStoredWorkflowDefinitionRecipeV2> {
    const isCurrent = params.isCurrent ?? (() => true);

    // A copy that is not byte-identical to the saved revision must not claim to
    // be it. Only an untouched copy carries the Artifact source.
    const origin = params.seed.origin;
    const reviewedDefinition = {
        definition: params.seed.definition,
        metadata: { title: params.seed.name.trim() },
        project: params.seed.project,
        ...(origin !== null && origin.matchesSavedRevision
            ? { source: { definitionId: origin.definitionId, revision: origin.revision } }
            : {}),
    };

    const mode = await fetchAccountEncryptionMode(params.credentials);
    if (!isCurrent()) throw new Error('Automation authoring authority changed');

    let workflow: unknown;
    if (mode.mode === 'plain') {
        workflow = { t: 'plain', v: reviewedDefinition };
    } else {
        if (!params.encryptRaw) {
            // Fail closed: an unavailable key never downgrades to plaintext.
            throw new AutomationTemplateEncryptionMaterialUnavailableError();
        }
        const ciphertext = await params.encryptRaw(reviewedDefinition);
        if (!isCurrent()) throw new Error('Automation authoring authority changed');
        workflow = { t: 'encrypted', c: ciphertext };
    }

    return AutomationStoredWorkflowDefinitionRecipeV2Schema.parse({
        v: 2,
        templateVersion: params.templateVersion,
        workflow,
        triggerEvidence: null,
    });
}
