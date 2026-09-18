import { describe, expect, it, vi } from 'vitest';

import {
  WORKFLOW_CANCEL_REQUESTED_ABORT_REASON,
  WorkflowRuntimeInterruption,
  type WorkflowStepExecutor,
} from './coordinator';
import {
  createProductionFreshWorkflowSessionConversation,
  createProductionWorkflowConversationOwner,
  createProductionWorkflowSessionStepExecutor,
  createWorkflowSessionStepExecutor,
} from './sessionStepExecutor';
import { preflightWorkflowSessionInputAdmissionV2 } from './stepExecution';

const sessionCreation = vi.hoisted(() => ({
  createSpawnedSession: vi.fn(async () => ({ sessionId: 'new-session' })),
  prepareSessionCreationTarget: vi.fn(async () => ({
    ok: true as const,
    directory: '/repo',
    directoryCreationRequired: false,
    checkout: null,
  })),
}));
const accountSettingsBootstrap = vi.hoisted(() => ({
  bootstrapAccountSettingsContext: vi.fn(),
}));
vi.mock('@/session/services/createSpawnedSession', () => sessionCreation);
vi.mock('@/session/creation/prepareSessionCreationTarget', () => ({
  prepareSessionCreationTarget: sessionCreation.prepareSessionCreationTarget,
}));
vi.mock('@/settings/accountSettings/bootstrapAccountSettingsContext', () => accountSettingsBootstrap);

const resolveSupportedMachineOperationProtocolCapabilities = async () => ({
  sessionInputAdmission: { protocolVersions: [1, 2] },
});

describe('workflow Session step executor', () => {
  it('re-reads exact-target capabilities at admission and refuses a post-construction downgrade before Session mutation', async () => {
    let currentCapabilities: unknown = {
      sessionInputAdmission: { protocolVersions: [1, 2] },
    };
    const materializeConversation = vi.fn(async () => ({
      sessionId: 'session-1',
      machineAdmissionTransport: vi.fn(),
    }));
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation',
        // Adversarial stale preparation snapshot: the admission attempt must
        // ignore this and resolve the exact target again.
        machineOperationProtocolCapabilities: {
          sessionInputAdmission: { protocolVersions: [1, 2] },
        },
        existing: null,
      }),
      resolveMachineOperationProtocolCapabilities: async () => currentCapabilities,
      materializeConversation,
      sessionInput: {
        preflight: preflightWorkflowSessionInputAdmissionV2,
        enqueue,
        observe: async () => ({
          ok: true, sessionId: 'session-1', localId: 'local-1',
          result: { kind: 'final_text', text: 'done' },
        }),
      },
    } as Parameters<typeof createWorkflowSessionStepExecutor>[0]);
    currentCapabilities = null;

    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({
      kind: 'failed',
      code: 'workflow_input_admission_update_required',
    });
    expect(materializeConversation).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('observes an exact-target capability upgrade after construction', async () => {
    let currentCapabilities: unknown = null;
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation',
        existing: null,
      }),
      resolveMachineOperationProtocolCapabilities: async () => currentCapabilities,
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: {
        preflight: preflightWorkflowSessionInputAdmissionV2,
        enqueue,
        observe: async () => ({
          ok: true, sessionId: 'session-1', localId: 'local-1',
          result: {
            kind: 'final_text', text: 'done',
            usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
          },
        }),
      },
    } as Parameters<typeof createWorkflowSessionStepExecutor>[0]);
    currentCapabilities = { sessionInputAdmission: { protocolVersions: [1, 2] } };

    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({
      kind: 'completed', result: 'done',
      usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
    });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      machineOperationProtocolCapabilities: currentCapabilities,
    }));
  });

  it('preserves owner-reported usage when the exact Session input fails', async () => {
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation', existing: null,
      }),
      resolveMachineOperationProtocolCapabilities: async () => ({
        sessionInputAdmission: { protocolVersions: [1, 2] },
      }),
      materializeConversation: async () => ({
        sessionId: 'session-1', machineAdmissionTransport: vi.fn(),
      }),
      sessionInput: {
        preflight: () => ({ ok: true }),
        enqueue: async () => ({ status: 'accepted', localId: 'local-1' }),
        observe: async () => ({
          ok: true, sessionId: 'session-1', localId: 'local-1',
          result: {
            kind: 'failed', message: 'provider failed',
            usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
          },
        }),
      },
    } as Parameters<typeof createWorkflowSessionStepExecutor>[0]);

    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({
      kind: 'failed', code: 'session_input_failed',
      usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
    });
  });

  it('preserves owner-reported usage when the exact Session input is cancelled', async () => {
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation', existing: null,
      }),
      resolveMachineOperationProtocolCapabilities: async () => ({
        sessionInputAdmission: { protocolVersions: [1, 2] },
      }),
      materializeConversation: async () => ({
        sessionId: 'session-1', machineAdmissionTransport: vi.fn(),
      }),
      sessionInput: {
        preflight: () => ({ ok: true }),
        enqueue: async () => ({ status: 'accepted', localId: 'local-1' }),
        observe: async () => ({
          ok: true, sessionId: 'session-1', localId: 'local-1',
          result: {
            kind: 'cancelled', message: 'provider cancelled',
            usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
          },
        }),
        cancel: async () => ({ kind: 'pending_retired' }),
      },
    } as Parameters<typeof createWorkflowSessionStepExecutor>[0]);

    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({
      kind: 'cancelled', code: 'session_input_pending_retired',
      usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
    });
  });

  it('admits the exact-target V2 path after a fresh supported read', async () => {
    const currentCapabilities = { sessionInputAdmission: { protocolVersions: [1, 2] } };
    const materializeConversation = vi.fn(async () => ({
      sessionId: 'session-1', machineAdmissionTransport: vi.fn(),
    }));
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation',
        existing: null,
      }),
      resolveMachineOperationProtocolCapabilities: async () => currentCapabilities,
      materializeConversation,
      sessionInput: {
        preflight: preflightWorkflowSessionInputAdmissionV2,
        enqueue,
        observe: async () => ({
          ok: true, sessionId: 'session-1', localId: 'local-1',
          result: { kind: 'final_text', text: 'done' },
        }),
      },
    } as Parameters<typeof createWorkflowSessionStepExecutor>[0]);

    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'completed', result: 'done' });
    expect(materializeConversation).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('persists exact input correspondence after admission and before observation', async () => {
    const events: string[] = [];
    const enqueueWorkflowSessionInput = vi.fn();
    const observeWorkflowSessionInputResult = vi.fn();
    enqueueWorkflowSessionInput.mockResolvedValue({ status: 'accepted', localId: 'local-1' });
    observeWorkflowSessionInputResult.mockImplementation(async () => {
      events.push('observe');
      return { ok: true, sessionId: 'session-1', localId: 'local-1', result: { kind: 'final_text', text: 'done' } };
    });
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: async (params) => {
        expect(params.workspace).toEqual({ machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' });
        return { kind: 'workflow_session_conversation', existing: null };
      },
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: {
        preflight: () => ({ ok: true }),
        enqueue: enqueueWorkflowSessionInput,
        observe: observeWorkflowSessionInputResult,
      },
    });
    await expect(execute({
      runId: 'run-1', step: { timeoutMs: 100 }, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: async (value: Parameters<WorkflowStepExecutor>[0]['invocation']['execution']) => {
        events.push('commit');
        expect(value).toEqual({ kind: 'session', sessionId: 'session-1', localInputId: 'local-1' });
      },
    } as never)).resolves.toEqual({ kind: 'completed', result: 'done' });
    expect(events).toEqual(['commit', 'observe']);
  });

  it('reobserves durable Session correspondence without preparing or enqueueing a second input', async () => {
    const prepareConversation = vi.fn();
    const enqueue = vi.fn();
    const observe = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      localId: 'local-1',
      result: { kind: 'final_text' as const, text: 'rejoined' },
    }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation,
      materializeConversation: vi.fn(),
      sessionInput: { preflight: vi.fn(), enqueue, observe },
    });
    await expect(execute({
      runId: 'run-1', step: {},
      invocation: {
        logicalInvocationRecordId: 'inv-1',
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'local-1' },
      },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'completed', result: 'rejoined' });
    expect(prepareConversation).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', localId: 'local-1' }));
  });

  it('propagates the coordinator currentness signal to an in-flight Session observation without a default deadline', async () => {
    const controller = new AbortController();
    const observe = vi.fn(async (input: { signal?: AbortSignal; deadlineMs?: number }) => {
      expect(input.signal).toBe(controller.signal);
      expect(input).not.toHaveProperty('deadlineMs');
      controller.abort();
      return {
        ok: true as const,
        sessionId: 'session-1',
        localId: 'local-1',
        result: { kind: 'cancelled' as const, message: 'cancelled' },
      };
    });
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: vi.fn(),
      materializeConversation: vi.fn(),
      sessionInput: {
        preflight: vi.fn(), enqueue: vi.fn(), observe,
        cancel: async () => ({ kind: 'turn_cancel_requested' }),
      },
    });
    await expect(execute({
      runId: 'run-1', step: {}, signal: controller.signal,
      invocation: { logicalInvocationRecordId: 'inv-1', execution: { kind: 'session', sessionId: 'session-1', localInputId: 'local-1' } },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'cancelled', code: 'session_input_turn_cancel_requested' });
  });

  it('reports an aborted exact observation as cancellation rather than attention', async () => {
    const controller = new AbortController();
    controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON);
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: vi.fn(), materializeConversation: vi.fn(),
      sessionInput: {
        preflight: vi.fn(), enqueue: vi.fn(),
        observe: async () => ({ ok: false, code: 'cancelled' }),
        cancel: async () => ({ kind: 'pending_retired' }),
      },
    });
    await expect(execute({
      runId: 'run-1', step: {}, signal: controller.signal,
      invocation: { logicalInvocationRecordId: 'inv-1', execution: { kind: 'session', sessionId: 'session-1', localInputId: 'local-1' } },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' }, onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'cancelled', code: 'session_input_pending_retired' });
  });

  it('refuses to reinterpret detached Run correspondence as Session correspondence', async () => {
    const prepareConversation = vi.fn();
    const observe = vi.fn();
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation,
      materializeConversation: vi.fn(),
      sessionInput: { preflight: vi.fn(), enqueue: vi.fn(), observe },
    });
    await expect(execute({
      runId: 'run-1', step: {},
      invocation: {
        logicalInvocationRecordId: 'inv-1',
        execution: { kind: 'detached_run', runId: 'execution-run-1', localInputId: 'local-1' },
      },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'failed', code: 'workflow_execution_target_mismatch' });
    expect(prepareConversation).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it('adds the canonical per-turn result instruction before exact Session admission', async () => {
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: async () => ({ kind: 'workflow_session_conversation', existing: null }),
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: {
        preflight: () => ({ ok: true }),
        enqueue,
        observe: async () => ({ ok: true, sessionId: 'session-1', localId: 'local-1', result: { kind: 'final_text', text: '"continue"' } }),
      },
    });
    await execute({
      runId: 'run-1', step: { result: { kind: 'decision', decisions: ['continue', 'stop'] } },
      invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'Judge', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Return only one strict JSON string'),
    }));
  });

  it('refuses a step broader than the immutable admitted Run ceiling before Session mutation', async () => {
    const prepareConversation = vi.fn();
    const enqueue = vi.fn();
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null }, prepareConversation,
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      materializeConversation: vi.fn(),
      sessionInput: { preflight: vi.fn(), enqueue, observe: vi.fn(), cancel: vi.fn() },
    });
    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] },
      execution: { permissionMode: 'safe-yolo' },
      authorization: { admittedPermissionCeiling: 'read-only', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'failed', code: 'workflow_permission_escalation_denied' });
    expect(prepareConversation).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('leaves live Session permission revalidation with canonical input admission', async () => {
    const enqueue = vi.fn(async () => ({
      status: 'rejected' as const,
      code: 'session_input_permission_ceiling_rejected' as const,
    }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation', existing: null,
      }),
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: { preflight: () => ({ ok: true }), enqueue, observe: vi.fn() },
    });
    await expect(execute({
      runId: 'run-1', step: {}, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] },
      execution: { permissionMode: 'safe-yolo' },
      authorization: {
        admittedPermissionCeiling: 'safe-yolo',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({
      kind: 'failed',
      code: 'session_input_permission_ceiling_rejected',
    });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'safe-yolo',
      sourceAuthority: {
        mediatorPluginId: 'happier.channels',
        sourceRef: 'channels:binding:binding-1',
        sourceRevisionOrEpoch: '4:7',
        remoteApprovalMaxScope: 'session',
      },
    }));
  });

  it('uses the contextual default rather than widening an omitted Session step to the Run ceiling', async () => {
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: async () => ({
        kind: 'workflow_session_conversation', existing: null,
      }),
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: {
        preflight: () => ({ ok: true }), enqueue,
        observe: async () => ({ ok: true, sessionId: 'session-1', localId: 'local-1', result: { kind: 'final_text', text: 'done' } }),
      },
    });
    await execute({
      runId: 'run-1', step: { result: { kind: 'text' } }, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' }, onInputAccepted: vi.fn(),
    } as never);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'default' }));
  });

  it('retires or cancels the exact accepted Session input when observation is aborted', async () => {
    const controller = new AbortController();
    const cancel = vi.fn(async () => ({ kind: 'turn_cancel_requested' as const }));
    const observe = vi.fn(async (input: { signal?: AbortSignal }) => {
      expect(input.signal).toBe(controller.signal);
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return { ok: false as const, code: 'cancelled' as const };
    });
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: vi.fn(), materializeConversation: vi.fn(),
      sessionInput: {
        preflight: vi.fn(), enqueue: vi.fn(), cancel,
        observe,
      },
    });
    const execution = execute({
      runId: 'run-1', step: {}, signal: controller.signal,
      invocation: { logicalInvocationRecordId: 'inv-1', execution: { kind: 'session', sessionId: 'session-1', localInputId: 'local-1' } },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' }, onInputAccepted: vi.fn(),
    } as never);
    await vi.waitFor(() => expect(observe).toHaveBeenCalledOnce());
    controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON);

    await expect(execution).resolves.toEqual({ kind: 'cancelled', code: 'session_input_turn_cancel_requested' });
    expect(cancel).toHaveBeenCalledWith({
      credentials: { token: 'token', encryption: null },
      sessionId: 'session-1', localId: 'local-1',
    });
  });

  it('leaves the accepted Session input running when the claim is interrupted without a cancellation reason', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const observe = vi.fn(async (input: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return { ok: false as const, code: 'cancelled' as const };
    });
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: vi.fn(), materializeConversation: vi.fn(),
      sessionInput: { preflight: vi.fn(), enqueue: vi.fn(), cancel, observe },
    });
    const execution = execute({
      runId: 'run-1', step: {}, signal: controller.signal,
      invocation: { logicalInvocationRecordId: 'inv-1', execution: { kind: 'session', sessionId: 'session-1', localInputId: 'local-1' } },
      input: { text: 'work', references: [], attachments: [], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' }, onInputAccepted: vi.fn(),
    } as never);
    await vi.waitFor(() => expect(observe).toHaveBeenCalledOnce());
    // Daemon shutdown / lease loss: this attempt only stops observing.
    controller.abort();

    await expect(execution).rejects.toBeInstanceOf(WorkflowRuntimeInterruption);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('carries portable Composer attachments into canonical Session structured-input admission', async () => {
    const attachment = {
      v: 1 as const,
      instanceId: 'workflow-attachment-1',
      attachment: { pluginId: 'acme.review', localId: 'review-context' },
      key: 'review-42',
      value: { reviewId: 42 },
      presentation: { label: 'Review 42', typeLabel: 'Review' },
    };
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const execute = createWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null },
      resolveMachineOperationProtocolCapabilities: resolveSupportedMachineOperationProtocolCapabilities,
      prepareConversation: async () => ({ kind: 'workflow_session_conversation', existing: null }),
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: {
        preflight: () => ({ ok: true }), enqueue,
        observe: async () => ({ ok: true, sessionId: 'session-1', localId: 'local-1', result: { kind: 'final_text', text: 'done' } }),
      },
    });
    await execute({
      runId: 'run-1', step: { result: { kind: 'text' } }, invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'Review', references: [], attachments: [attachment], values: [] }, execution: {},
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' }, onInputAccepted: vi.fn(),
    } as never);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ attachments: [attachment] }));
  });

  it('materializes shared, fresh, from-step, and existing conversations without a workflow-owned Session registry', async () => {
    const createFreshConversation = vi.fn(async () => ({ sessionId: 'new-session', machineId: 'machine-1', directory: '/repo/subdir' }));
    const resolveSharedRunConversation = vi.fn(async () => ({ sessionId: 'shared-session', machineId: 'machine-1', directory: '/repo/subdir' }));
    const resolveProducerConversation = vi.fn(async () => ({ sessionId: 'producer-session', machineId: 'machine-1', directory: '/repo/subdir' }));
    const execute = createProductionWorkflowSessionStepExecutor({
      credentials: { token: 'token', encryption: null }, machineId: 'machine-1',
      resolveMachineOperationProtocolCapabilities: async () => ({
        sessionInputAdmission: { protocolVersions: [1, 2] },
      }),
      machineAdmissionTransport: vi.fn(), createFreshConversation,
      resolveSharedRunConversation, resolveProducerConversation,
      resolveExistingSessionConversation: async ({ sessionId, machineId }) => ({ sessionId, machineId, directory: '/repo/subdir' }),
      sessionInput: {
        preflight: () => ({ ok: true }),
        enqueue: async ({ sessionId }) => ({ status: 'accepted', localId: `local-${sessionId}` }),
        observe: async ({ sessionId, localId }) => ({ ok: true, sessionId, localId, result: { kind: 'final_text', text: sessionId } }),
      },
    });
    const base = {
      runId: 'run-1', step: { result: { kind: 'text' } }, invocation: { logicalInvocationRecordId: 'inv-1', invocationPath: { blockId: 'work', scope: [] } },
      input: { text: 'work', references: [], attachments: [], values: [] },
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      workspace: { machineId: 'machine-1', directory: '/repo/subdir', checkoutRootPath: '/repo' }, onInputAccepted: vi.fn(),
    };
    await expect(execute({ ...base, execution: { conversation: { kind: 'shared_run' } } } as never)).resolves.toMatchObject({ result: 'shared-session' });
    await expect(execute({ ...base, invocation: { ...base.invocation, logicalInvocationRecordId: 'inv-2' }, execution: { conversation: { kind: 'fresh' }, agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } } } as never)).resolves.toMatchObject({ result: 'new-session' });
    await expect(execute({ ...base, invocation: { ...base.invocation, logicalInvocationRecordId: 'inv-3' }, execution: { conversation: { kind: 'from_step', producer: { blockId: 'prior', scope: { kind: 'current' } } } } } as never)).resolves.toMatchObject({ result: 'producer-session' });
    await expect(execute({ ...base, invocation: { ...base.invocation, logicalInvocationRecordId: 'inv-4' }, execution: { conversation: { kind: 'existing_session', sessionId: 'existing-session', machineId: 'machine-1' } } } as never)).resolves.toMatchObject({ result: 'existing-session' });
    expect(createFreshConversation).toHaveBeenCalledWith(expect.objectContaining({
      creationKey: 'workflow:run-1:inv-2',
      workspace: { machineId: 'machine-1', directory: '/repo/subdir', checkoutRootPath: '/repo' },
      selection: expect.objectContaining({
        agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
      }),
    }));
  });

  it('compares retained Session workspace paths through the canonical cross-platform path owner', async () => {
    const conversations = createProductionWorkflowConversationOwner({
      machineId: 'machine-1',
      createFreshConversation: vi.fn(),
      resolveSharedRunConversation: async () => ({
        sessionId: 'shared-session',
        machineId: 'machine-1',
        directory: 'C:\\Users\\Alice\\repo\\packages\\app',
      }),
      resolveProducerConversation: vi.fn(),
      resolveExistingSessionConversation: vi.fn(),
    });

    const prepared = await conversations.prepare({
      runId: 'run-1',
      invocation: { logicalInvocationRecordId: 'inv-1' },
      execution: { conversation: { kind: 'shared_run' } },
    } as never);
    expect(prepared).toMatchObject({ existing: { sessionId: 'shared-session' } });
    await expect(conversations.materialize(prepared, {
      runId: 'run-1', invocation: { logicalInvocationRecordId: 'inv-1' },
      execution: { conversation: { kind: 'shared_run' } },
      workspace: {
        machineId: 'machine-1',
        directory: 'c:/users/alice/repo/packages/app',
        checkoutRootPath: 'c:/users/alice/repo',
      },
    } as never)).resolves.toMatchObject({ sessionId: 'shared-session' });

    const sibling = createProductionWorkflowConversationOwner({
      machineId: 'machine-1', createFreshConversation: vi.fn(),
      resolveSharedRunConversation: async () => ({
        sessionId: 'shared-session', machineId: 'machine-1',
        directory: 'C:\\Users\\Alice2\\repo\\packages\\app',
      }),
      resolveProducerConversation: vi.fn(), resolveExistingSessionConversation: vi.fn(),
    });
    const siblingPrepared = await sibling.prepare({
      runId: 'run-1', invocation: { logicalInvocationRecordId: 'inv-1' },
      execution: { conversation: { kind: 'shared_run' } },
    } as never);
    await expect(sibling.materialize(siblingPrepared, {
      runId: 'run-1', invocation: { logicalInvocationRecordId: 'inv-1' },
      execution: { conversation: { kind: 'shared_run' } },
      workspace: {
        machineId: 'machine-1', directory: 'c:/users/alice/repo/packages/app',
        checkoutRootPath: 'c:/users/alice/repo',
      },
    } as never)).rejects.toMatchObject({ code: 'conversation_workspace_mismatch' });
  });

  it('rejects an existing Session with a new worktree during conversation preflight', async () => {
    const resolveExistingSessionConversation = vi.fn();
    const conversations = createProductionWorkflowConversationOwner({
      machineId: 'machine-1', createFreshConversation: vi.fn(),
      resolveSharedRunConversation: vi.fn(), resolveProducerConversation: vi.fn(),
      resolveExistingSessionConversation,
    });

    await expect(conversations.prepare({
      runId: 'run-1', invocation: { logicalInvocationRecordId: 'inv-1' },
      execution: {
        conversation: { kind: 'existing_session', sessionId: 'session-1', machineId: 'machine-1' },
        workspace: { kind: 'new_worktree', source: { kind: 'original' } },
      },
    } as never)).rejects.toMatchObject({ code: 'conversation_workspace_mismatch' });
    expect(resolveExistingSessionConversation).not.toHaveBeenCalled();
  });

  it('creates fresh conversations through canonical target preparation and Session creation owners', async () => {
    sessionCreation.createSpawnedSession.mockClear();
    sessionCreation.prepareSessionCreationTarget.mockClear();
    const create = createProductionFreshWorkflowSessionConversation({
      credentials: { token: 'token', encryption: null },
      serverId: 'server-1',
      machineId: 'machine-1',
      machineAdmissionTransport: vi.fn(),
    });
    const agentTarget = {
      kind: 'agent' as const,
      identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
    };
    await expect(create({
      selection: {
        agentTarget,
        connectedServices: { v: 2, bindingsByServiceId: {} },
        permissionMode: 'read_only',
        sessionConfigOptionOverrides: { v: 1, updatedAt: 1, overrides: {} },
      },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      creationKey: 'workflow:run-1:inv-1',
    })).resolves.toEqual({ sessionId: 'new-session', machineId: 'machine-1', directory: '/repo' });
    expect(sessionCreation.prepareSessionCreationTarget).toHaveBeenCalledWith({
      request: {
        directory: '/repo',
      },
    });
    expect(sessionCreation.createSpawnedSession).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/repo',
      approvedNewDirectoryCreation: false,
      spawnNonce: 'workflow:run-1:inv-1',
      agentTarget,
      permissionMode: 'read-only',
      sessionConfigOptionOverrides: { v: 1, updatedAt: 1, overrides: {} },
    }));
  });

  it('resolves fresh Team resource defaults through the injected current Home catalog', async () => {
    sessionCreation.createSpawnedSession.mockClear();
    accountSettingsBootstrap.bootstrapAccountSettingsContext.mockResolvedValueOnce({
      settings: {
        connectedServicesDefaultAuthByAgentIdV1: {
          v: 1,
          bindingsByAgentId: {
            codex: {
              v: 2,
              bindingsByServiceId: {
                'happier.agent.codex/openai-codex': {
                  source: 'team_resource', serverId: 'server-1', accountId: 'account-1',
                  teamId: 'team-1', resourceId: 'resource-1', expectedResourceRevision: 4,
                  deliveryMode: 'brokered',
                },
              },
            },
          },
        },
      },
    });
    const resolveTeamCredentialResourceCatalog = vi.fn(async () => ({
      serverId: 'server-1', accountId: 'account-1',
      resources: [{
        id: 'resource-1', teamId: 'team-1', displayName: 'Shared Codex account',
        resourceRevision: 4, readiness: { kind: 'available' as const }, recoveryAction: null,
        mayBroker: true, mayReceiveDirect: false, directMaterialState: 'never_delivered' as const,
        sessionUsePolicy: 'personal_allowed' as const, providerModels: [],
        connectedServiceSelections: [{
          source: 'team_resource' as const, resourceId: 'resource-1', deliveryMode: 'brokered' as const,
        }],
        sourcePresentation: {
          kind: 'connected_service' as const,
          service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
        },
      }],
    }));
    const create = createProductionFreshWorkflowSessionConversation({
      credentials: { token: 'token', encryption: null },
      serverId: 'server-1',
      machineId: 'machine-1',
      machineAdmissionTransport: vi.fn(),
      resolveTeamCredentialResourceCatalog,
    });

    await create({
      selection: {
        agentTarget: {
          kind: 'agent',
          identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
        },
      },
      workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
      creationKey: 'workflow:run-1:inv-team',
    });

    expect(resolveTeamCredentialResourceCatalog).toHaveBeenCalledWith({ teamIds: ['team-1'] });
    expect(sessionCreation.createSpawnedSession).toHaveBeenCalledWith(expect.objectContaining({
      connectedServices: {
        v: 2,
        bindingsByServiceId: {
          'happier.agent.codex/openai-codex': {
            source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'brokered',
          },
        },
      },
    }));
  });
});
