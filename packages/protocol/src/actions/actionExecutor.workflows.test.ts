import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';

describe('createActionExecutor (Workflow family)', () => {
  it('routes a strict normalized input through the single Workflow dependency', async () => {
    const workflowAction = vi.fn(async () => ({
      valid: true,
      normalizedDefinition: {
        version: 1,
        inputs: [],
        defaults: {},
        blocks: [{
          kind: 'step',
          id: 'step-1',
          document: { text: 'Summarize', references: [], attachments: [] },
          input: [],
          result: { kind: 'text' },
        }],
      },
      issues: [],
      targetValidation: 'not_requested',
    }));
    const executor = createActionExecutor({
      workflowAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.validate', {
      definition: { blocks: ['Summarize'] },
    }, { surface: 'ui' })).resolves.toMatchObject({ ok: true });
    expect(workflowAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'workflow.validate',
      input: { definition: { blocks: ['Summarize'] } },
    }));
  });

  it('executes a discoverable Workflow operation through the generic MCP action transport without surface rejection', async () => {
    const workflowAction = vi.fn(async () => ({ runs: [] }));
    const executor = createActionExecutor({
      workflowAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    // `workflow.run.list` is not a direct MCP tool, but the generic external
    // MCP `action_execute` transport must still reach the Workflow owner
    // instead of failing closed on surface availability.
    await expect(executor.execute('workflow.run.list', {}, { surface: 'mcp' }))
      .resolves.toMatchObject({ ok: true });
    expect(workflowAction).toHaveBeenCalledOnce();
  });

  it('fails closed before execution when the Workflow dependency is absent', async () => {
    const executor = createActionExecutor({
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);
    await expect(executor.execute('workflow.validate', {
      definition: { blocks: ['Summarize'] },
    }, { surface: 'ui' })).resolves.toEqual({
      ok: false,
      errorCode: 'unsupported_action',
      error: 'unsupported_action:workflow.validate',
    });
  });

  it('rejects caller-supplied Workflow authorization before the Workflow owner runs', async () => {
    const workflowAction = vi.fn();
    const executor = createActionExecutor({
      workflowAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.run.start', {
      runId: '11111111-1111-4111-8111-111111111111',
      source: {
        kind: 'inline',
        definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
      },
      authorization: {
        admittedPermissionCeiling: 'yolo',
        principal: { kind: 'host' },
      },
    }, {
      surface: 'api',
      authority: 'account_automation',
      actionCaller: { kind: 'host' },
      externalActionCredential: {
        accountId: 'account-1',
        principalId: 'principal-1',
        credentialId: 'credential-1',
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'invalid_parameters',
      error: 'invalid_parameters',
    });
    expect(workflowAction).not.toHaveBeenCalled();
  });

  it('host-stamps the effective controller permission for a direct start', async () => {
    const workflowAction = vi.fn(async () => ({
      ok: false as const,
      errorCode: 'target_unavailable' as const,
      error: 'target_unavailable',
    }));
    const executor = createActionExecutor({
      workflowAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await executor.execute('workflow.run.start', {
      runId: '11111111-1111-4111-8111-111111111111',
      source: { kind: 'inline', definition: { blocks: ['Summarize'] } },
    }, {
      surface: 'api',
      authority: 'account_automation',
      actionCaller: { kind: 'host' },
      externalActionCredential: {
        accountId: 'account-1',
        principalId: 'principal-1',
        credentialId: 'credential-1',
      },
      externalActionTarget: {
        kind: 'machine',
        machineId: 'machine-1',
        project: { machineId: 'machine-1', directory: '/repo' },
      },
    });

    expect(workflowAction).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ callerPermissionMode: 'yolo' }),
    }));
  });

  it('preserves a Workflow Run mediated source in the canonical Action permission context', async () => {
    const workflowAction = vi.fn(async () => ({
      ok: false as const,
      errorCode: 'target_unavailable' as const,
      error: 'target_unavailable',
    }));
    const executor = createActionExecutor({
      workflowAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await executor.execute('workflow.run.get', { runId: 'run-1' }, {
      surface: 'agent',
      authority: 'account_automation',
      actionCaller: {
        kind: 'workflowRun',
        runId: 'run-parent',
        authorization: {
          admittedPermissionCeiling: 'read-only',
          principal: { kind: 'host' },
          sourceAuthority: {
            mediatorPluginId: 'happier.channels',
            sourceRef: 'channels:binding:binding-1',
            sourceRevisionOrEpoch: '4:7',
            remoteApprovalMaxScope: 'session',
          },
        },
      },
    });

    expect(workflowAction).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        callerPermissionMode: 'read-only',
        causalPermissionAuthority: {
          kind: 'admittedSessionInputV1',
          admittedPermissionCeiling: 'read-only',
          sourceAuthority: {
            kind: 'mediatedExternal',
            mediatorPluginId: 'happier.channels',
            sourceRef: 'channels:binding:binding-1',
            sourceRevisionOrEpoch: '4:7',
            admittedPermissionCeiling: 'read-only',
            remoteApprovalMaxScope: 'session',
          },
        },
      }),
    }));
  });

  it('forwards the host-stamped Action context separately from normalized Workflow input', async () => {
    const context = {
      surface: 'agent' as const,
      authority: 'account_automation' as const,
      actionCaller: { kind: 'host' as const },
      callerPermissionMode: 'yolo',
      causalPermissionAuthority: {
        kind: 'admittedSessionInputV1' as const,
        admittedPermissionCeiling: 'default',
      },
      sessionInputSource: {
        sourceSessionId: 'session-1',
        sourceTurnId: 'turn-1',
        via: 'mcp' as const,
      },
    };
    const workflowAction = vi.fn(async (args) => {
      expect(args.context).toEqual({
        ...context,
        callerPermissionMode: 'default',
      });
      expect(args.input).toEqual({
        definition: { blocks: ['Summarize'] },
      });
      expect(args.input).not.toHaveProperty('authorization');
      return {
        ok: false as const,
        errorCode: 'invalid_input' as const,
        error: 'invalid_input',
      };
    });
    const executor = createActionExecutor({
      workflowAction,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.validate', {
      definition: { blocks: ['Summarize'] },
    }, context)).resolves.toMatchObject({ ok: false, errorCode: 'invalid_input' });
    expect(workflowAction).toHaveBeenCalledOnce();
  });

  it('does not publish an unrecognized Workflow operation error', async () => {
    const executor = createActionExecutor({
      workflowAction: vi.fn(async () => ({
        ok: false,
        errorCode: 'workflow_private_internal_failure',
        error: 'private detail',
      })),
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.validate', {
      definition: { blocks: ['Summarize'] },
    }, { surface: 'ui' })).resolves.toEqual({
      ok: false,
      errorCode: 'content_unavailable',
      error: 'content_unavailable',
    });
  });

  it('does not publish details for Workflow failures that do not define them', async () => {
    const executor = createActionExecutor({
      workflowAction: vi.fn(async () => ({
        ok: false,
        errorCode: 'run_not_found',
        error: 'private lookup detail',
        details: { storageKey: 'private-key' },
      })),
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.run.get', {
      runId: 'missing-run',
    }, { surface: 'ui' })).resolves.toEqual({
      ok: false,
      errorCode: 'content_unavailable',
      error: 'content_unavailable',
    });
  });

  it('preserves a closed Workflow operation error and its details', async () => {
    const executor = createActionExecutor({
      workflowAction: vi.fn(async () => ({
        ok: false,
        errorCode: 'workflow_wait_self_dependency',
        error: 'The current Session is an execution target',
        details: { runId: 'run-1' },
      })),
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.validate', {
      definition: { blocks: ['Summarize'] },
    }, { surface: 'ui' })).resolves.toEqual({
      ok: false,
      errorCode: 'workflow_wait_self_dependency',
      error: 'The current Session is an execution target',
      details: { runId: 'run-1' },
    });
  });

  it('fails closed when a self-dependency failure omits its required Run handle', async () => {
    const executor = createActionExecutor({
      workflowAction: vi.fn(async () => ({
        ok: false,
        errorCode: 'workflow_wait_self_dependency',
        error: 'The current Session is an execution target',
      })),
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workflow.validate', {
      definition: { blocks: ['Summarize'] },
    }, { surface: 'ui' })).resolves.toEqual({
      ok: false,
      errorCode: 'content_unavailable',
      error: 'content_unavailable',
    });
  });
});
