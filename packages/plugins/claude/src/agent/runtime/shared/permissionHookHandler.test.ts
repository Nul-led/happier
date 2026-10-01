import { describe, expect, it, vi } from 'vitest';

import { createClaudePermissionHookHandler } from './permissionHookHandler.js';

describe('createClaudePermissionHookHandler Agent tool interception', () => {
  it.each(['PreToolUse', 'PermissionRequest'] as const)('preserves a transformed provider-native input through %s', async (hookEventName) => {
    const before = vi.fn(async () => ({
      status: 'continue' as const,
      input: { command: 'pwd', intercepted: true },
    }));
    const requestDecision = vi.fn(async () => ({ decision: 'approved' }));
    const handler = createClaudePermissionHookHandler({
      agentRuntime: { toolExecution: { before } },
      sessions: { current: { permissions: { requestDecision } } },
    } as never);

    const response = await handler({
      hook_event_name: hookEventName,
      session_id: 'provider-session-1',
      tool_name: 'Bash',
      tool_use_id: 'call-1',
      tool_input: { command: 'pwd' },
    });

    expect(before).toHaveBeenCalledOnce();
    expect(before).toHaveBeenCalledWith({
      callId: 'call-1',
      name: 'Bash',
      input: { command: 'pwd' },
    });
    expect(requestDecision).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'call-1',
      input: { command: 'pwd', intercepted: true },
    }), expect.any(Object));
    expect(response.hookSpecificOutput?.decision).toEqual(expect.objectContaining({
      behavior: 'allow',
      updatedInput: { command: 'pwd', intercepted: true },
    }));
  });

  it('approves unchanged PermissionRequest input without a rewrite while retaining permission updates', async () => {
    const originalInput = { command: 'pwd', options: { paths: ['a', 'b'], verbose: false } };
    const approvedInput = { options: { verbose: false, paths: ['a', 'b'] }, command: 'pwd' };
    // Host JSON boundaries may return null-prototype records with different property order.
    Object.setPrototypeOf(approvedInput, null);
    Object.setPrototypeOf(approvedInput.options, null);
    const updatedPermissions = [{ type: 'setMode', mode: 'default' }];
    const handler = createClaudePermissionHookHandler({
      agentRuntime: { toolExecution: { before: async (request) => ({ status: 'continue', input: request.input }) } },
      sessions: { current: { permissions: {
        requestDecision: async () => ({ decision: 'approved', updatedInput: approvedInput, updatedPermissions }),
      } } },
    });

    const response = await handler({
      hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'original-call',
      tool_input: originalInput,
    });

    expect(response.hookSpecificOutput?.decision).toEqual({ behavior: 'allow', updatedPermissions });
    expect(response.hookSpecificOutput).not.toHaveProperty('updatedInput');
  });

  it('maps an explicit interception rejection to the existing provider-native denial', async () => {
    const requestDecision = vi.fn(async () => ({ decision: 'approved' }));
    const handler = createClaudePermissionHookHandler({
      agentRuntime: {
        toolExecution: {
          before: vi.fn(async () => ({
            status: 'rejected' as const,
            code: 'plugin_policy_denied',
            message: 'Denied by plugin policy',
          })),
        },
      },
      sessions: { current: { permissions: { requestDecision } } },
    } as never);

    const response = await handler({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'call-2',
      tool_input: { command: 'rm -rf build' },
    });

    expect(requestDecision).not.toHaveBeenCalled();
    expect(response.hookSpecificOutput?.decision).toEqual({
      behavior: 'deny',
      message: 'Denied by plugin policy',
      interrupt: true,
    });
  });
});
