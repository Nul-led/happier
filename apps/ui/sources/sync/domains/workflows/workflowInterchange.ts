import {
  WorkflowDocumentV1Schema,
  serializeWorkflowDocumentJsonV1,
  type WorkflowDocumentV1,
} from '@happier-dev/protocol/workflows/workflowDocumentV1';
import { validateWorkflowDefinition } from '@happier-dev/protocol/workflows/workflowValidationV1';
import type {
  WorkflowDefinitionV1,
  WorkflowIngressContextV1,
  WorkflowValidationIssue,
} from '@happier-dev/protocol/workflows/workflowV1';

import type { TranslationKeyNoParams } from '@/text';

import {
  buildWorkflowEditorDraftFromDefinition,
  firstBlockingWorkflowIssue,
  validateWorkflowEditorDraft,
} from './workflowAuthoring';
import type { WorkflowEditorDraft } from './workflowEditorDraft';

/**
 * JSON interchange for authored workflows.
 *
 * This is an adapter, not a parser: `WorkflowDocumentV1Schema` owns the
 * envelope and `validateWorkflowDefinition` owns the definition, exactly as
 * they do at save and at run admission. The module is pure string-in/string-out
 * so the editor, a test and any CLI caller share one behavior; the platform
 * file, share and download boundary stays with the caller.
 *
 * Import opens an unsaved review draft. It never runs, schedules, saves or
 * creates an Artifact, and a failed import returns the caller's draft
 * unchanged so a bad file cannot destroy open work.
 */

export type WorkflowImportFailureCode =
  | 'invalid_json'
  | 'unsupported_version'
  | 'invalid_document'
  | 'invalid_definition';

export type WorkflowImportResult =
  | Readonly<{
    ok: true;
    /** A fresh unsaved review draft. Never the caller's `currentDraft`. */
    draft: WorkflowEditorDraft;
    definition: WorkflowDefinitionV1;
  }>
  | Readonly<{
    ok: false;
    code: WorkflowImportFailureCode;
    /**
     * The authored envelope-failure copy, or `null` for `invalid_definition`,
     * where the canonical issues below are the message and the editor points
     * at each `path` with the existing `workflows.issue.<code>` copy.
     */
    messageKey: TranslationKeyNoParams | null;
    issues: readonly WorkflowValidationIssue[];
    /** The unchanged `currentDraft`, by identity. */
    draft: WorkflowEditorDraft;
    /**
     * Canonically normalized material that may be opened only for repair.
     * Structural parse failures have no normalized definition and therefore
     * never expose a draft that could silently discard unknown input.
     */
    repairDraft?: WorkflowEditorDraft;
  }>;

export type WorkflowExportResult =
  | Readonly<{ ok: true; json: string; document: WorkflowDocumentV1 }>
  | Readonly<{
    ok: false;
    issues: readonly WorkflowValidationIssue[];
    blockingIssue: WorkflowValidationIssue | null;
  }>;

function serializeValidatedWorkflowDefinition(
  definition: WorkflowDefinitionV1,
): Extract<WorkflowExportResult, Readonly<{ ok: true }>> {
  const document: WorkflowDocumentV1 = { kind: 'happier.workflow', version: 1, definition };
  return { ok: true, document, json: serializeWorkflowDocumentJsonV1(document) };
}

/**
 * The authored note the caller shows before sharing an exported file. The
 * definition schema already excludes credentials, staged media and every
 * runtime-only field, so this previews a consequence rather than describing a
 * filter.
 */
export const WORKFLOW_EXPORT_PRIVACY_NOTE_KEY: TranslationKeyNoParams =
  'workflows.interchange.exportPrivacyNote';

const IMPORT_FAILURE_MESSAGE_KEYS = {
  invalid_json: 'workflows.interchange.importFailedInvalidJson',
  unsupported_version: 'workflows.interchange.importFailedUnsupportedVersion',
  invalid_document: 'workflows.interchange.importFailedInvalidDocument',
} as const satisfies Readonly<Record<
  Exclude<WorkflowImportFailureCode, 'invalid_definition'>,
  TranslationKeyNoParams
>>;

type EnvelopeFailureCode = keyof typeof IMPORT_FAILURE_MESSAGE_KEYS;

/**
 * Which half of the document the canonical schema rejected. `kind` and the
 * document shape decide "is this a Happier workflow at all", `version` decides
 * "can this app read it", and anything else is a definition concern the
 * canonical validator reports with repairable paths.
 */
function classifyEnvelopeFailure(
  error: Readonly<{ issues: readonly Readonly<{ path: readonly PropertyKey[] }>[] }>,
): Exclude<EnvelopeFailureCode, 'invalid_json'> | null {
  const heads = error.issues.map((issue) => issue.path[0]);
  if (heads.some((head) => head === undefined || head === 'kind')) return 'invalid_document';
  if (heads.some((head) => head === 'version')) return 'unsupported_version';
  return null;
}

export function importWorkflowDocument(params: Readonly<{
  source: string;
  /** The draft currently open in the editor; returned unchanged on failure. */
  currentDraft: WorkflowEditorDraft;
  draftId: string;
  /** The document carries no title, so the review draft is unnamed by default. */
  name?: string;
  /** The same trusted host context the validator receives at save and start. */
  context?: WorkflowIngressContextV1;
}>): WorkflowImportResult {
  const failure = (
    code: WorkflowImportFailureCode,
    issues: readonly WorkflowValidationIssue[] = [],
    repairDraft?: WorkflowEditorDraft,
  ): WorkflowImportResult => ({
    ok: false,
    code,
    messageKey: code === 'invalid_definition' ? null : IMPORT_FAILURE_MESSAGE_KEYS[code],
    issues,
    draft: params.currentDraft,
    ...(repairDraft === undefined ? {} : { repairDraft }),
  });

  let value: unknown;
  try {
    value = JSON.parse(params.source) as unknown;
  } catch {
    return failure('invalid_json');
  }

  const parsedDocument = WorkflowDocumentV1Schema.safeParse(value);
  if (!parsedDocument.success) {
    const envelopeFailure = classifyEnvelopeFailure(parsedDocument.error);
    if (envelopeFailure !== null) return failure(envelopeFailure);
  }

  // The envelope is a Happier workflow of a readable version, so the definition
  // goes to the one canonical validator. It accepts the documented ingress
  // dialect a hand-written file may use and returns the normalized definition
  // the editor stores, or the path-addressed issues that prevented it.
  const definitionInput = parsedDocument.success
    ? parsedDocument.data.definition
    : (value as Readonly<Record<string, unknown>>).definition;
  const validation = validateWorkflowDefinition(
    definitionInput,
    params.context === undefined ? {} : { context: params.context },
  );
  const definition = validation.normalizedDefinition;
  if (!validation.valid || definition === undefined) {
    return failure(
      'invalid_definition',
      validation.issues,
      definition === undefined
        ? undefined
        : buildWorkflowEditorDraftFromDefinition({
          draftId: params.draftId,
          name: params.name ?? '',
          definition,
        }),
    );
  }

  return {
    ok: true,
    definition,
    draft: buildWorkflowEditorDraftFromDefinition({
      draftId: params.draftId,
      name: params.name ?? '',
      definition,
    }),
  };
}

/**
 * Serializes the reviewed draft through the canonical codec. An invalid draft
 * is refused with the same issues the editor already shows, so export cannot
 * publish a document the app itself would reject on import.
 */
export function exportWorkflowDocument(params: Readonly<{
  draft: WorkflowEditorDraft;
  context?: WorkflowIngressContextV1;
}>): WorkflowExportResult {
  const validation = validateWorkflowEditorDraft(
    params.draft,
    params.context === undefined ? {} : { context: params.context },
  );
  const definition = validation.normalizedDefinition;
  if (!validation.valid || definition === undefined) {
    return {
      ok: false,
      issues: validation.issues,
      blockingIssue: firstBlockingWorkflowIssue(validation),
    };
  }

  return serializeValidatedWorkflowDefinition(definition);
}

/**
 * Serializes an already-opened saved or frozen Run definition through the same
 * validator and file codec as the editor. Callers never reconstruct authored
 * content from progress, results, transcripts, or list projections.
 */
export function exportWorkflowDefinition(params: Readonly<{
  definition: WorkflowDefinitionV1;
  context?: WorkflowIngressContextV1;
}>): WorkflowExportResult {
  const validation = validateWorkflowDefinition(
    params.definition,
    params.context === undefined ? {} : { context: params.context },
  );
  const definition = validation.normalizedDefinition;
  if (!validation.valid || definition === undefined) {
    return {
      ok: false,
      issues: validation.issues,
      blockingIssue: firstBlockingWorkflowIssue(validation),
    };
  }
  return serializeValidatedWorkflowDefinition(definition);
}
