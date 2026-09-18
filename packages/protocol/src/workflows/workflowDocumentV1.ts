import { z } from 'zod';

import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import { WorkflowDefinitionV1Schema } from './workflowV1.js';

export const WorkflowDocumentV1Schema = z.object({
  kind: z.literal('happier.workflow'),
  version: z.literal(1),
  definition: WorkflowDefinitionV1Schema,
}).strict();
export type WorkflowDocumentV1 = z.infer<typeof WorkflowDocumentV1Schema>;

export type WorkflowDocumentParseErrorCodeV1 =
  | 'workflow_document_invalid_json'
  | 'workflow_document_unsupported_version'
  | 'workflow_document_invalid';

export class WorkflowDocumentParseErrorV1 extends TypeError {
  readonly code: WorkflowDocumentParseErrorCodeV1;

  constructor(code: WorkflowDocumentParseErrorCodeV1, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkflowDocumentParseErrorV1';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseWorkflowDocumentV1(value: unknown): WorkflowDocumentV1 {
  const result = WorkflowDocumentV1Schema.safeParse(value);
  if (result.success) return result.data;
  if (
    isRecord(value)
    && value.kind === 'happier.workflow'
    && Object.hasOwn(value, 'version')
    && value.version !== 1
  ) {
    throw new WorkflowDocumentParseErrorV1(
      'workflow_document_unsupported_version',
      `Unsupported Workflow document version: ${String(value.version)}`,
      { cause: result.error },
    );
  }
  throw new WorkflowDocumentParseErrorV1(
    'workflow_document_invalid',
    'Workflow document does not match the version 1 schema',
    { cause: result.error },
  );
}

export function parseWorkflowDocumentJsonV1(json: string): WorkflowDocumentV1 {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw new WorkflowDocumentParseErrorV1(
      'workflow_document_invalid_json',
      'Workflow document is not valid JSON',
      { cause: error },
    );
  }
  return parseWorkflowDocumentV1(value);
}

/** Stable JSON interchange projection derived from the one executable document schema. */
export function serializeWorkflowDocumentJsonV1(document: unknown): string {
  return createCanonicalJsonSigningInput(parseWorkflowDocumentV1(document));
}
