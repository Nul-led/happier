import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { ...http, isAxiosError: () => false } }));

const sessionId = 'c123456789012345678901234';

import {
  enqueueWorkflowSessionInput,
  observeWorkflowDetachedExecutionRunInput,
  preflightWorkflowSessionInputAdmissionV2,
  sendWorkflowDetachedExecutionRunInput,
} from './stepExecution';

describe('Workflow Session step execution', () => {
  beforeEach(() => {
    http.get.mockReset();
    http.post.mockReset();
    http.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/account/encryption/currentness')) return {
        status: 200,
        data: { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null,
          updatedAt: 1, recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' } },
      };
      if (url.includes(`/v2/sessions/${sessionId}`)) return {
        status: 200,
        data: { session: createSessionRecordFixture({
          id: sessionId, active: true, encryptionMode: 'plain',
          machineId: 'machine-1',
          metadata: JSON.stringify({ machineId: 'machine-1' }),
        }) },
      };
      throw new Error(`Unexpected read: ${url}`);
    });
  });

  it('fails closed with the typed update requirement before Session mutation', async () => {
    expect(preflightWorkflowSessionInputAdmissionV2(undefined)).toEqual({
      ok: false,
      code: 'workflow_input_admission_update_required',
    });
    expect(preflightWorkflowSessionInputAdmissionV2({
      sessionInputAdmission: { protocolVersions: [1] },
    })).toEqual({
      ok: false,
      code: 'workflow_input_admission_update_required',
    });

    const machineAdmissionTransport = vi.fn();
    await expect(enqueueWorkflowSessionInput({
      credentials: { token: 'token', encryption: null },
      sessionId: 'session-1',
      machineOperationProtocolCapabilities: {
        sessionInputAdmission: { protocolVersions: [1] },
      },
      workflow: {
        purpose: 'invocation',
        runId: 'run-1',
        invocationRecordId: 'invocation-1',
      },
      text: 'Do the work',
      machineAdmissionTransport,
    })).resolves.toEqual({
      status: 'update_required',
      code: 'workflow_input_admission_update_required',
    });
    expect(machineAdmissionTransport).not.toHaveBeenCalled();
  });

  it('accepts only the exact Workflow V2 Session admission capability', () => {
    expect(preflightWorkflowSessionInputAdmissionV2({
      sessionInputAdmission: { protocolVersions: [1, 2] },
    })).toEqual({ ok: true });
    expect(preflightWorkflowSessionInputAdmissionV2({
      sessionInputAdmission: { protocolVersions: [1, 2], unexpected: true },
    })).toEqual({
      ok: false,
      code: 'workflow_input_admission_update_required',
    });
  });

  it('authors portable attachments in the canonical raw Session structured-input envelope', async () => {
    const attachment = {
      v: 1 as const, instanceId: 'workflow-attachment-1',
      attachment: { pluginId: 'acme.review', localId: 'review-context' }, key: 'review-42',
      value: { reviewId: 42 }, presentation: { label: 'Review 42', typeLabel: 'Review' },
    };
    const machineAdmissionTransport = vi.fn(async (request) => ({
      status: 'accepted' as const,
      localId: request.localId,
    }));
    await expect(enqueueWorkflowSessionInput({
      credentials: { token: 'token', encryption: null }, sessionId,
      machineOperationProtocolCapabilities: { sessionInputAdmission: { protocolVersions: [1, 2] } },
      workflow: { purpose: 'invocation', runId: 'run-1', invocationRecordId: 'inv-1' },
      text: 'Review', attachments: [attachment], machineAdmissionTransport,
    })).resolves.toEqual({ status: 'accepted', localId: expect.any(String) });
    expect(machineAdmissionTransport).toHaveBeenCalledWith(expect.objectContaining({
      content: { t: 'plain', v: expect.objectContaining({
        meta: expect.objectContaining({
          happierStructuredInputV1: { v: 1, composerAttachments: [attachment] },
        }),
      }) },
    }));
  });

  it('keeps Workflow V2 provenance on the exact attached Execution Run target', async () => {
    const machineAdmissionTransport = vi.fn(async (request) => ({
      status: 'accepted' as const,
      localId: request.localId,
    }));
    await expect(enqueueWorkflowSessionInput({
      credentials: { token: 'token', encryption: null }, sessionId,
      machineOperationProtocolCapabilities: { sessionInputAdmission: { protocolVersions: [1, 2] } },
      workflow: { purpose: 'invocation', runId: 'workflow-run-1', invocationRecordId: 'inv-1' },
      executionRunTarget: { runId: 'execution-run-1', resultContract: { kind: 'text' } },
      text: 'Continue the attached run',
      machineAdmissionTransport,
    })).resolves.toEqual({ status: 'accepted', localId: expect.any(String) });
    expect(machineAdmissionTransport).toHaveBeenCalledWith(expect.objectContaining({
      recipient: { kind: 'execution_run', runId: 'execution-run-1' },
      content: { t: 'plain', v: expect.objectContaining({
        meta: expect.objectContaining({
          happier: {
            kind: 'participant_message.v1',
            payload: { recipient: { kind: 'execution_run', runId: 'execution-run-1' } },
          },
          happierProvenanceV1: {
            v: 2,
            kind: 'workflow_invocation',
            runId: 'workflow-run-1',
            invocationRecordId: 'inv-1',
          },
        }),
      }) },
    }));
  });
});

describe('Workflow detached Execution Run step execution', () => {
  it('sends the exact workflow input identity and execution-owned result contract', async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    await expect(sendWorkflowDetachedExecutionRunInput({
      runId: 'run-1',
      text: 'Do the work',
      localInputId: 'workflow-input-1',
      resultContract: { kind: 'decision', decisions: ['continue', 'stop'] },
      send,
    })).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      runId: 'run-1',
      message: 'Do the work',
      delivery: 'prompt',
      localInputId: 'workflow-input-1',
      resultContract: { kind: 'decision', decisions: ['continue', 'stop'] },
    });
  });

  it('rejoins only the exact input turn and returns its typed result', async () => {
    const get = vi.fn(async () => ({
      run: {
        runId: 'run-1', callId: 'call-1', sidechainId: 'sidechain-1', intent: 'agent',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        permissionMode: 'read_only', retentionPolicy: 'resumable', runClass: 'long_lived',
        ioMode: 'request_response', status: 'running', startedAtMs: 1,
        inputTurns: {
          occurrenceId: 'occurrence-1',
          last: {
            turnId: 'turn-2', inputIds: ['workflow-input-1'], state: 'completed',
            result: { kind: 'json', value: { changed: true } },
          },
        },
      },
    }));
    await expect(observeWorkflowDetachedExecutionRunInput({
      runId: 'run-1',
      localInputId: 'workflow-input-1',
      get,
    })).resolves.toEqual({ kind: 'completed', result: { changed: true } });
  });

  it('returns the recoverable Workflow interaction capacity code from the exact failed Run input', async () => {
    const get = vi.fn(async () => ({
      run: {
        runId: 'run-1', callId: 'call-1', sidechainId: 'sidechain-1', intent: 'agent',
        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        permissionMode: 'default', retentionPolicy: 'resumable', runClass: 'long_lived',
        ioMode: 'request_response', status: 'failed', startedAtMs: 1, finishedAtMs: 2,
        error: {
          code: 'workflow_interaction_capacity_exceeded',
          message: 'Workflow interaction exceeds durable capacity',
        },
        inputTurns: {
          occurrenceId: 'occurrence-1',
          last: { turnId: 'turn-1', inputIds: ['workflow-input-1'], state: 'failed' },
        },
      },
    }));

    await expect(observeWorkflowDetachedExecutionRunInput({
      runId: 'run-1', localInputId: 'workflow-input-1', get,
    })).resolves.toEqual({ kind: 'failed', code: 'workflow_interaction_capacity_exceeded' });
  });

  it('does not treat another turn or terminal run status as exact completion proof', async () => {
    const get = vi.fn(async () => ({
      run: {
        runId: 'run-1', callId: 'call-1', sidechainId: 'sidechain-1', intent: 'agent',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        permissionMode: 'read_only', retentionPolicy: 'resumable', runClass: 'long_lived',
        ioMode: 'request_response', status: 'succeeded', startedAtMs: 1, finishedAtMs: 2,
        inputTurns: {
          occurrenceId: 'occurrence-1',
          last: { turnId: 'turn-other', inputIds: ['other-input'], state: 'completed' },
        },
      },
    }));
    await expect(observeWorkflowDetachedExecutionRunInput({
      runId: 'run-1', localInputId: 'workflow-input-1', get,
    })).resolves.toEqual({ kind: 'outcome_uncertain', code: 'execution_run_input_not_observed' });
  });

  it('keeps observing an admitted attached input until Session Pending reaches the Run', async () => {
    const get = vi.fn(async () => ({
      run: {
        runId: 'run-1', callId: 'call-1', sidechainId: 'sidechain-1', intent: 'agent',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        permissionMode: 'read_only', retentionPolicy: 'resumable', runClass: 'long_lived',
        ioMode: 'request_response', status: 'running', startedAtMs: 1,
      },
    }));
    await expect(observeWorkflowDetachedExecutionRunInput({
      runId: 'run-1', localInputId: 'workflow-input-1', get,
    })).resolves.toEqual({ kind: 'pending' });
  });
});
