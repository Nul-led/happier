import {
  WorkflowDefinitionArtifactBodyV1Schema,
  WorkflowDefinitionArtifactHeaderV1Schema,
  WorkflowDefinitionCreateRequestV1Schema,
  WorkflowDefinitionMetadataV1Schema,
  WorkflowDefinitionUpdateRequestV1Schema,
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  measureExternalActionResultResponseEnvelopeUtf8BytesV1,
  validateWorkflowDefinition,
  type WorkflowIngressContextV1,
} from '@happier-dev/protocol';
import type { z } from 'zod';

import { encodeAccountArtifactListCursor, type AccountArtifactRevision, type createAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';

type Store = ReturnType<typeof createAccountArtifactStore>;
type CreateInput = z.infer<typeof WorkflowDefinitionCreateRequestV1Schema>;
type UpdateInput = z.infer<typeof WorkflowDefinitionUpdateRequestV1Schema>;
type Metadata = z.infer<typeof WorkflowDefinitionMetadataV1Schema>;
type ArtifactHeader = z.infer<typeof WorkflowDefinitionArtifactHeaderV1Schema>;

function normalize(definition: CreateInput['definition'], context?: WorkflowIngressContextV1) {
  const validated = validateWorkflowDefinition(definition, context ? { context } : {});
  if (!validated.valid || !validated.normalizedDefinition) {
    throw Object.assign(new Error('workflow_definition_invalid'), { code: 'invalid_input', details: { issues: validated.issues } });
  }
  return validated.normalizedDefinition;
}

function header(definitionId: string, revision: AccountArtifactRevision, metadata: Metadata) {
  return WorkflowDefinitionArtifactHeaderV1Schema.parse({ kind: 'workflow-definition.v1', definitionId, revision, metadata });
}

function headerMatchesArtifact(
  artifact: Readonly<{ artifactId: string; headerVersion: number; bodyVersion?: number }>,
  artifactHeader: ArtifactHeader,
): boolean {
  return artifactHeader.definitionId === artifact.artifactId
    && artifactHeader.revision.headerVersion === artifact.headerVersion
    && (artifact.bodyVersion === undefined
      || artifactHeader.revision.bodyVersion === artifact.bodyVersion);
}

export function createWorkflowDefinitionActions(params: Readonly<{ artifactStore: Store }>) {
  const get = async ({ definitionId }: Readonly<{ definitionId: string }>) => {
    const artifact = await params.artifactStore.read(definitionId);
    if (!artifact) throw Object.assign(new Error('workflow_definition_not_found'), { code: 'content_unavailable' });
    const parsedHeader = WorkflowDefinitionArtifactHeaderV1Schema.safeParse(artifact.header);
    if (!parsedHeader.success || !headerMatchesArtifact({
      artifactId: artifact.artifactId,
      headerVersion: artifact.revision.headerVersion,
      bodyVersion: artifact.revision.bodyVersion,
    }, parsedHeader.data) || artifact.body === null) {
      throw Object.assign(new Error('workflow_definition_content_unavailable'), { code: 'content_unavailable' });
    }
    let candidate: unknown;
    try { candidate = JSON.parse(artifact.body); } catch { throw Object.assign(new Error('workflow_definition_content_unavailable'), { code: 'content_unavailable' }); }
    const parsedBody = WorkflowDefinitionArtifactBodyV1Schema.safeParse(candidate);
    if (!parsedBody.success) throw Object.assign(new Error('workflow_definition_content_unavailable'), { code: 'content_unavailable' });
    return { definitionId, revision: artifact.revision, definition: parsedBody.data.definition, metadata: parsedHeader.data.metadata };
  };
  return {
    list: async ({ limit, cursor: inputCursor }: Readonly<{ cursor?: string; limit?: number }>) => {
      const definitions: ArtifactHeader[] = [];
      // Opaque Artifact cursor of the last returned row. A page shortened by the
      // response ceiling resumes here, so the first omitted row is read next.
      let replayCursor: string | undefined;
      let cursor = inputCursor;
      do {
        let page: Awaited<ReturnType<Store['list']>>;
        try {
          page = await params.artifactStore.list({ limit: 500, cursor });
        } catch (error) {
          if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'invalid_cursor') {
            throw Object.assign(new Error('workflow_definition_cursor_invalid'), { code: 'invalid_input' });
          }
          throw error;
        }
        for (const artifact of page.items) {
          const parsed = WorkflowDefinitionArtifactHeaderV1Schema.safeParse(artifact.header);
          if (!parsed.success || !headerMatchesArtifact({
            artifactId: artifact.artifactId,
            headerVersion: artifact.headerVersion,
          }, parsed.data)) continue;
          const isExhaustedAtPageEnd = page.items.at(-1)?.artifactId === artifact.artifactId && !page.nextCursor;
          const rowCursor = encodeAccountArtifactListCursor(artifact);
          // Size the exact page this row could close, inside the complete public
          // response framing, so the outer envelope owner never has to replace a
          // completed list with `result_too_large`.
          const candidate = { definitions: [...definitions, parsed.data], ...(isExhaustedAtPageEnd ? {} : { nextCursor: rowCursor }) };
          if (measureExternalActionResultResponseEnvelopeUtf8BytesV1(candidate) > EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES) {
            if (replayCursor === undefined) {
              throw Object.assign(new Error('workflow_definition_header_exceeds_action_response'), { code: 'content_unavailable' });
            }
            return { definitions, nextCursor: replayCursor };
          }
          definitions.push(parsed.data);
          replayCursor = rowCursor;
          if (limit !== undefined && definitions.length >= limit) return candidate;
        }
        cursor = page.nextCursor;
      } while (cursor);
      return { definitions };
    },
    get,
    create: async (input: CreateInput, context?: WorkflowIngressContextV1) => {
      const definition = normalize(input.definition, context);
      const existingArtifact = await params.artifactStore.read(input.definitionId);
      if (existingArtifact) {
        const existing = await get({ definitionId: input.definitionId });
        if (JSON.stringify(existing.definition) === JSON.stringify(definition)
          && JSON.stringify(existing.metadata) === JSON.stringify(input.metadata)) return existing;
        throw Object.assign(new Error('workflow_definition_create_conflict'), { code: 'currentness_conflict' });
      }
      const initialRevision = { headerVersion: 1, bodyVersion: 1 };
      try {
        await params.artifactStore.create({ artifactId: input.definitionId,
          header: header(input.definitionId, initialRevision, input.metadata),
          body: JSON.stringify({ kind: 'workflow-definition.v1', definition }) });
      } catch (error) {
        if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'conflict') {
          throw Object.assign(new Error('workflow_definition_create_conflict'), { code: 'currentness_conflict' });
        }
        throw error;
      }
      const accepted = await get({ definitionId: input.definitionId });
      if (JSON.stringify(accepted.definition) !== JSON.stringify(definition)
        || JSON.stringify(accepted.metadata) !== JSON.stringify(input.metadata)) {
        throw Object.assign(new Error('workflow_definition_create_conflict'), { code: 'currentness_conflict' });
      }
      return accepted;
    },
    update: async (input: UpdateInput, context?: WorkflowIngressContextV1) => {
      const definition = normalize(input.definition, context);
      const existing = await get({ definitionId: input.definitionId });
      if (existing.revision.headerVersion !== input.expectedRevision.headerVersion
        || existing.revision.bodyVersion !== input.expectedRevision.bodyVersion) {
        throw Object.assign(new Error('artifact_version_mismatch'), { code: 'currentness_conflict' });
      }
      const nextRevision = { headerVersion: input.expectedRevision.headerVersion + 1, bodyVersion: input.expectedRevision.bodyVersion + 1 };
      const result = await params.artifactStore.update({ artifactId: input.definitionId,
        expectedRevision: input.expectedRevision, header: header(input.definitionId, nextRevision, input.metadata),
        body: JSON.stringify({ kind: 'workflow-definition.v1', definition }) });
      if (!result.ok) throw Object.assign(new Error(result.error), {
        code: result.errorCode === 'version_mismatch' ? 'currentness_conflict' : 'content_unavailable',
      });
      return { definitionId: input.definitionId, revision: result.revision, definition, metadata: input.metadata };
    },
    delete: async ({ definitionId }: Readonly<{ definitionId: string }>) => {
      const artifact = await params.artifactStore.read(definitionId);
      const parsedHeader = artifact ? WorkflowDefinitionArtifactHeaderV1Schema.safeParse(artifact.header) : null;
      if (!artifact || !parsedHeader?.success) {
        throw Object.assign(new Error('workflow_definition_not_found'), { code: 'content_unavailable' });
      }
      // The Artifact owner deletes by id without a revision precondition, so a
      // header that names another definition or a stale revision must be as
      // unreadable here as it is for get/list before anything is destroyed.
      if (!headerMatchesArtifact({
        artifactId: artifact.artifactId,
        headerVersion: artifact.revision.headerVersion,
        bodyVersion: artifact.revision.bodyVersion,
      }, parsedHeader.data)) {
        throw Object.assign(new Error('workflow_definition_content_unavailable'), { code: 'content_unavailable' });
      }
      const result = await params.artifactStore.delete(definitionId);
      if (!result.ok) throw Object.assign(new Error(result.error), { code: result.errorCode });
      return { deleted: true as const, definitionId };
    },
  };
}
