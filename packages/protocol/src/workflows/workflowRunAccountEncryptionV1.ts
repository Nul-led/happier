import { AccountEncryptionMigrateWorkflowRunDirectiveSchema, type AccountEncryptionMigrateAutomationsInventoryResponse,
  type AccountEncryptionMigrateWorkflowRunDirective } from '../account/encryptionMigrate.js';
import type { AvailableAutomationAccountEncryptionV1 } from '../automations/automationAccountCurrentnessV1.js';
import { prepareWorkflowRunDataKeyV1, resolveWorkflowRunDataKeyV1 } from './workflowRunDataKeyV1.js';
import {
  parseWorkflowStoredContentEnvelopeV1, serializeWorkflowStoredContentEnvelopeV1,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1, sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowCheckpointStoredEnvelopeV1, sealWorkflowCheckpointStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1, sealWorkflowProgressStoredEnvelopeV1,
  openWorkflowFinalResultStoredEnvelopeV1, sealWorkflowFinalResultStoredEnvelopeV1,
} from './workflowStoredContentV1.js';

/** Stages all current private Run rows under one replacement key in the active V4 directive. */
export function convertWorkflowRunAccountEncryptionV1(params: Readonly<{
  accountId: string;
  run: AccountEncryptionMigrateAutomationsInventoryResponse['runs'][number];
  sourceEncryption: AvailableAutomationAccountEncryptionV1;
  /** Proposed target material; it does not activate or override the persisted Account mode. */
  targetEncryption: AvailableAutomationAccountEncryptionV1;
  randomBytes: (length: number) => Uint8Array;
}>): Readonly<{ workflow: AccountEncryptionMigrateWorkflowRunDirective; resultEnvelope: string | null }> {
  const source = params.run.workflow;
  const unavailable = () => Object.assign(new Error('content_unavailable'), { code: 'content_unavailable' });
  if (!source || source.keyCensus.runId !== params.run.runId || source.keyCensus.ownerAccountId !== params.accountId) throw unavailable();
  const resolved = resolveWorkflowRunDataKeyV1({ encryption: params.sourceEncryption, census: source.keyCensus });
  if (resolved.kind !== 'available') throw unavailable();
  const prepared = prepareWorkflowRunDataKeyV1({ accountId: params.accountId, encryption: params.targetEncryption,
    census: source.keyCensus, randomBytes: params.randomBytes });
  const openMode = resolved.encryption.runCrypto;
  const sealMode = prepared.runCrypto.mode === 'plain' ? prepared.runCrypto
    : { ...prepared.runCrypto, randomBytes: params.randomBytes };
  const binding = { v: 1 as const, accountId: params.accountId, runId: params.run.runId };
  const accepted = openWorkflowAcceptedSnapshotStoredEnvelopeV1({ ...openMode,
    binding: { ...binding, purpose: 'accepted_snapshot' },
    envelope: parseWorkflowStoredContentEnvelopeV1(source.acceptedSnapshotEnvelope) });
  if (accepted.kind !== 'available') throw unavailable();
  const acceptedSnapshotEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
    ...sealMode, binding: { ...binding, purpose: 'accepted_snapshot' }, acceptedSnapshot: accepted.content,
  }));
  let checkpointEnvelope: string | null = null;
  if (source.checkpointEnvelope !== null) {
    const checkpoint = openWorkflowCheckpointStoredEnvelopeV1({ ...openMode,
      binding: { ...binding, purpose: 'checkpoint' }, envelope: parseWorkflowStoredContentEnvelopeV1(source.checkpointEnvelope) });
    if (checkpoint.kind !== 'available') throw unavailable();
    checkpointEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
      ...sealMode, binding: { ...binding, purpose: 'checkpoint' }, checkpoint: checkpoint.content,
    }));
  }
  let resultEnvelope: string | null = null;
  if (params.run.resultEnvelope !== null) {
    const finalResult = openWorkflowFinalResultStoredEnvelopeV1({ ...openMode,
      binding: { ...binding, purpose: 'final_result' }, envelope: parseWorkflowStoredContentEnvelopeV1(params.run.resultEnvelope) });
    if (finalResult.kind !== 'available') throw unavailable();
    resultEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowFinalResultStoredEnvelopeV1({
      ...sealMode, binding: { ...binding, purpose: 'final_result' }, finalResult: finalResult.content,
    }));
  }
  const invocations = source.invocations.map(row => {
    const { index } = row;
    if (index.runId !== params.run.runId) throw unavailable();
    const rowBinding = { ...binding, purpose: 'invocation_progress' as const,
      recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
      memberOrdinal: index.memberOrdinal, attempt: index.attempt };
    const progress = openWorkflowProgressStoredEnvelopeV1({ ...openMode, binding: rowBinding,
      envelope: parseWorkflowStoredContentEnvelopeV1(row.contentEnvelope) });
    if (progress.kind !== 'available') throw unavailable();
    return { id: index.id, expectedContentRevision: index.contentRevision, sourceContentEnvelope: row.contentEnvelope,
      contentEnvelope: serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        ...sealMode, binding: rowBinding, progress: progress.content,
      })) };
  });
  return { resultEnvelope, workflow: AccountEncryptionMigrateWorkflowRunDirectiveSchema.parse({
    sourceAcceptedSnapshotEnvelope: source.acceptedSnapshotEnvelope, acceptedSnapshotEnvelope,
    sourceCheckpointEnvelope: source.checkpointEnvelope, checkpointEnvelope,
    expectedDataEncryptionKey: source.keyCensus.dataEncryptionKey,
    recipientKeyEnvelopes: prepared.recipientKeyEnvelopes, invocations,
  }) };
}
