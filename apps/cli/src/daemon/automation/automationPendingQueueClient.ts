import type { StoredCredentials } from '@/persistence';
import { isAxiosError } from 'axios';
import { discardPendingQueueV2Messages } from '@/api/session/pendingQueueV2Transport';
import { sendSessionMessage } from '@/session/services/sendSessionMessage';
import { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { callSessionRpc } from '@/session/transport/rpc/sessionRpc';
import {
  buildAutomationSessionInputAdmissionV1,
  deriveAutomationSessionInputLocalIdV1,
} from '@/session/services/sessionInputAdmissionIdentity';
import {
  HAPPIER_STRUCTURED_INPUT_METADATA_KEY_V1,
  type MentionRefV1,
  type SessionInputAdmissionResultV1,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

/**
 * Automation is a non-interactive producer. It delegates the complete
 * request-envelope, encryption, equality-evidence, and authenticated-machine
 * admission path to the canonical Session Message sender. This leaf owns only
 * Automation's run facts and the stable local identity.
 */
export async function enqueueAutomationPrompt(params: Readonly<{
  credentials: StoredCredentials;
  sessionId: string;
  automationId: string;
  runId: string;
  prompt: string;
  displayText?: string;
  /**
   * The composer references the frozen template carried, already admitted
   * against this exact rendered prompt by the Protocol materializer. They are
   * handed to the canonical Session sender in the one structured-input
   * envelope an interactive send uses, so provider context is still
   * reconstructed at dispatch rather than frozen here.
   */
  mentions?: readonly MentionRefV1[];
  signal?: AbortSignal;
  machineAdmissionTransport: NonNullable<Parameters<typeof sendSessionMessage>[0]['machineAdmissionTransport']>;
}>): Promise<SessionInputAdmissionResultV1> {
  const prompt = params.prompt.trim();
  if (!prompt) return { status: 'rejected', code: 'session_input_invalid' };

  const localId = deriveAutomationSessionInputLocalIdV1({
    automationId: params.automationId,
    runId: params.runId,
  });
  const inputAdmission = buildAutomationSessionInputAdmissionV1({
    automationId: params.automationId,
    runId: params.runId,
  });
  const displayText = typeof params.displayText === 'string' && params.displayText.trim().length > 0
    ? params.displayText
    : undefined;
  const mentions = params.mentions ?? [];
  const messageMeta = {
    ...(displayText ? { displayText } : {}),
    ...(mentions.length > 0
      ? { [HAPPIER_STRUCTURED_INPUT_METADATA_KEY_V1]: { v: 1, mentions: [...mentions] } }
      : {}),
  };
  const result = await sendSessionMessage({
    credentials: params.credentials,
    idOrPrefix: params.sessionId,
    message: prompt,
    wait: false,
    timeoutMs: 30_000,
    localId,
    requestedAction: { v: 1, kind: 'enqueue' },
    ...(Object.keys(messageMeta).length > 0 ? { messageMeta } : {}),
    inputAdmission,
    machineAdmissionTransport: params.machineAdmissionTransport,
    ...(params.signal ? { signal: params.signal } : {}),
  });

  return result.admissionResult;
}

/**
 * Authoritative Automation Run cancellation retires only its stable input.
 * Generic worker/lease/attempt aborts must never call this function.
 */
export async function discardAutomationPromptAfterRunCancellation(params: Readonly<{
  credentials: StoredCredentials;
  sessionId: string;
  automationId: string;
  runId: string;
}>): Promise<void> {
  const localId = deriveAutomationSessionInputLocalIdV1({
    automationId: params.automationId,
    runId: params.runId,
  });
  try {
    await discardPendingQueueV2Messages({
      token: params.credentials.token,
      sessionId: params.sessionId,
      localIds: [localId],
      reason: 'session_input_cancelled',
    });
    // The exact input was still pending and is now durably retired. There is
    // no materialized turn for the loaded Session runtime to cancel.
    return;
  } catch (error) {
    // Canonical materialization deletes the pending row after committing the
    // user message. Only that exact not-found outcome advances to the loaded
    // runtime check; every other discard failure remains visible to the worker.
    if (!isAxiosError(error) || error.response?.status !== 404) throw error;
    const responseData: unknown = error.response.data;
    if (
      typeof responseData !== 'object'
      || responseData === null
      || !('error' in responseData)
      || typeof responseData.error !== 'string'
    ) {
      throw error;
    }
    if (responseData.error === 'session-not-found') return;
    if (responseData.error !== 'not-found') throw error;
  }

  // Pending retirement is durable server truth. If the same input has already
  // materialized, ask the loaded Session owner to cancel only the turn whose
  // canonical admission witness still carries this exact localId. Older or
  // unreachable runtimes safely leave the already-retired input as a no-op.
  try {
    const transport = await resolveSessionTransportContext({
      credentials: params.credentials,
      idOrPrefix: params.sessionId,
    });
    if (!transport.ok || transport.sessionId !== params.sessionId) return;
    const rpc = {
      token: params.credentials.token,
      sessionId: transport.sessionId,
      method: `${transport.sessionId}:${SESSION_RPC_METHODS.SESSION_INPUT_CANCEL_EXACT_TURN_V1}`,
      request: { sessionId: transport.sessionId, localId },
    };
    if (transport.mode === 'plain') {
      await callSessionRpc({ ...rpc, mode: 'plain' });
    } else {
      await callSessionRpc({ ...rpc, mode: 'e2ee', ctx: transport.ctx });
    }
  } catch {
    // An unreachable/older loaded runtime cannot broaden cancellation to the
    // whole Session. The durable pending discard above remains authoritative.
  }
}
