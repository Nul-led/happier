import type { PermissionMode } from '@/api/types';
import type {
  ProviderBoundModelRef,
  CallerInputConstraintsV1,
  SessionInputCausalPermissionAuthorityV1,
  SessionMediaItemV1,
  WorkerUpdateV1,
  SessionMessageProvenance,
} from '@happier-dev/protocol';
import type { HappierStructuredInputV1 } from '@happier-dev/protocol/runtime';
import type { SessionFollowReconciledContext } from '@/agent/runtime/session/follow/sessionFollowContextReconciler';
import type { WorkflowInvocationIdentity } from '@/agent/runtime/session/contextOnly/hostContextOnlyInput';
import type { WorkflowStepWithdrawal } from '@/agent/runtime/session/contextOnly/workflowStepWithdrawal';

export type HostContextOnlyInput = (
  | Readonly<{ kind: 'session_follow'; prepared: SessionFollowReconciledContext }>
  | Readonly<{
      kind: 'worker_update'; update: WorkerUpdateV1;
      recheckAdmission: (signal: AbortSignal) => Promise<boolean>;
      acknowledgeAccepted: () => void;
    }>
  | Readonly<{
      kind: 'workflow_step'; localInputId: string; text: string;
      workflowInvocation: WorkflowInvocationIdentity;
      workDepth: number;
      isWorkflowStepDeliverable: (input: Readonly<{ localInputId: string }>) => Promise<boolean>;
      withdrawal: WorkflowStepWithdrawal;
      acknowledgeAccepted: () => void;
    }>
) & Readonly<{ commitHostEvent: (workerEvents?: readonly Readonly<{ localId: string; update: WorkerUpdateV1 }>[]) => Promise<void> }>;

export type PermissionModeQueuedPromptMode = Readonly<{
  callerInputConstraints?: CallerInputConstraintsV1;
  permissionMode: PermissionMode;
  appendSystemPrompt?: string | null;
  modelSelection?: ProviderBoundModelRef;
  suppressUserEcho?: boolean;
  providerPromptAlreadyResolved?: boolean;
  /** Exact admitted-input authority; this is part of the batching identity. */
  causalPermissionAuthority?: SessionInputCausalPermissionAuthorityV1;
  /** Host-rendered descriptive block; exact bytes are part of batching identity. */
  inputContextBlock?: string;
  /** Protected admission provenance retained as data for host turn stamping. */
  inputProvenance?: SessionMessageProvenance;
}>;

export type PermissionModeQueuedPrompt = Readonly<{
  text: string;
  localId: string | null;
  localIds?: readonly string[];
  structuredInput?: HappierStructuredInputV1;
  /** Exact durable items matched to the admitted Composer SessionMedia refs. */
  sessionMedia?: readonly SessionMediaItemV1[];
  /** Exact transcript rows used only to suppress replay of host-consumed local commands. */
  userMessageSeq?: number | null;
  userMessageSeqs?: readonly number[];
  /** Immutable authority for the exact admitted input(s) in this queue batch. */
  causalPermissionAuthority?: SessionInputCausalPermissionAuthorityV1;
  /** Host-rendered descriptive block applied only at the provider boundary. */
  inputContextBlock?: string;
  inputProvenance?: SessionMessageProvenance;
  /** Trusted host-only turn input. It is never inserted into MessageQueue/Pending/transcript. */
  hostContextOnly?: HostContextOnlyInput;
}>;

function appendUniqueString(target: string[], value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0 || target.includes(value)) return;
  target.push(value);
}

function appendUniqueSeq(target: number[], value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return;
  if (target.includes(value as number)) return;
  target.push(value as number);
}

export function normalizePermissionModeQueuedPromptLocalIds(
  prompt: PermissionModeQueuedPrompt,
): string[] {
  const localIds: string[] = [];
  appendUniqueString(localIds, prompt.localId);
  for (const localId of prompt.localIds ?? []) {
    appendUniqueString(localIds, localId);
  }
  return localIds;
}

export function normalizePermissionModeQueuedPromptUserMessageSeqs(
  prompt: PermissionModeQueuedPrompt,
): number[] {
  const seqs: number[] = [];
  for (const seq of prompt.userMessageSeqs ?? []) {
    appendUniqueSeq(seqs, seq);
  }
  appendUniqueSeq(seqs, prompt.userMessageSeq);
  return seqs;
}

export function readHighestPermissionModeQueuedPromptUserMessageSeq(
  prompt: PermissionModeQueuedPrompt,
): number | null {
  const seqs = normalizePermissionModeQueuedPromptUserMessageSeqs(prompt);
  return seqs.length === 0 ? null : Math.max(...seqs);
}

export function combinePermissionModeQueuedPrompts(
  prompts: readonly PermissionModeQueuedPrompt[],
): PermissionModeQueuedPrompt {
  if (prompts.some((prompt) => prompt.hostContextOnly)) {
    throw new Error('Host context-only prompts cannot be queued or batched');
  }
  if (prompts.length > 1 && prompts.some((prompt) => prompt.structuredInput)) {
    // Structured input carries one message's fresh dispatch-time context. Queue insertion must
    // isolate it, so reaching the prose batcher would either merge incompatible context or drop
    // a later structured entry.
    throw new Error('Cannot combine multiple structured prompts');
  }
  const [first] = prompts;
  const localIds: string[] = [];
  const userMessageSeqs: number[] = [];
  for (const prompt of prompts) {
    for (const localId of normalizePermissionModeQueuedPromptLocalIds(prompt)) {
      appendUniqueString(localIds, localId);
    }
    for (const seq of normalizePermissionModeQueuedPromptUserMessageSeqs(prompt)) {
      appendUniqueSeq(userMessageSeqs, seq);
    }
  }
  const maxUserMessageSeq = userMessageSeqs.length === 0 ? null : Math.max(...userMessageSeqs);
  return {
    text: prompts.map((prompt) => prompt.text).join('\n'),
    localId: first?.localId ?? null,
    ...(first?.structuredInput ? { structuredInput: first.structuredInput } : {}),
    ...(first?.sessionMedia ? { sessionMedia: first.sessionMedia } : {}),
    ...(localIds.length === 0 ? {} : { localIds }),
    ...(maxUserMessageSeq === null ? {} : { userMessageSeq: maxUserMessageSeq }),
    ...(userMessageSeqs.length === 0 ? {} : { userMessageSeqs }),
    ...(first?.causalPermissionAuthority
      ? { causalPermissionAuthority: first.causalPermissionAuthority }
      : {}),
    ...(first?.inputContextBlock
      ? { inputContextBlock: first.inputContextBlock }
      : {}),
    ...(first?.inputProvenance ? { inputProvenance: first.inputProvenance } : {}),
  };
}
