import { describe, expect, it, vi } from 'vitest';

import {
  CurrentSessionPresentationActionInputV1Schema,
  CurrentSessionPresentationActionResultV1Schema,
} from '../sessions/presentation/currentSessionPresentationV1.js';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { getActionSpec, isInternalActionId } from './actionSpecs.js';

describe('current-Session presentation Action', () => {
  it('publishes one internal Agent/MCP ActionSpec over the strict presentation intent', () => {
    const spec = getActionSpec('session.presentation.apply');
    expect(spec).toMatchObject({
      id: 'session.presentation.apply',
      requiredAuthority: 'account_automation',
      executionPlacement: 'session',
      safety: 'safe',
      sideEffectClass: 'write',
      approval: { result: 'required' },
      bindings: { mcpToolName: 'session_presentation_apply' },
      surfaces: {
        ui: false,
        voice: false,
        agent: true,
        mcp: true,
        cli: false,
        rpc: false,
        api: false,
        plugin: false,
      },
    });
    expect(spec.inputSchema).toBe(CurrentSessionPresentationActionInputV1Schema);
    expect(spec.outputSchema).toBe(CurrentSessionPresentationActionResultV1Schema);
    expect(isInternalActionId('session.presentation.apply')).toBe(true);
  });

  it('admits the host-stamped runtime principal and delegates one exact intent', async () => {
    const presentationApply = vi.fn(async () => ({ status: 'applied' as const, revision: 'nonce-a:2' }));
    const executor = createActionExecutor({
      currentSessionPresentationApply: presentationApply,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);
    const signal = new AbortController().signal;
    const context = {
      surface: 'agent' as const,
      authority: 'account_automation' as const,
      defaultSessionId: 'session-a',
      actionRequestId: 'tool-call-a',
      signal,
    };

    await expect(executor.execute('session.presentation.apply', {
      intent: { kind: 'board.item.reveal', widgetId: 'note-a' },
    }, context)).resolves.toEqual({
      ok: true,
      result: { status: 'applied', revision: 'nonce-a:2' },
    });

    expect(presentationApply).toHaveBeenCalledWith({
      input: { intent: { kind: 'board.item.reveal', widgetId: 'note-a' } },
      context,
      signal,
    });
  });

  it('rejects caller-selected Session identity and unavailable producers before effects', async () => {
    const presentationApply = vi.fn(async () => ({ status: 'applied' as const, revision: 'nonce-a:2' }));
    const executor = createActionExecutor({
      currentSessionPresentationApply: presentationApply,
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('session.presentation.apply', {
      sessionId: 'session-b',
      intent: { kind: 'companion.show' },
    }, {
      surface: 'agent',
      authority: 'account_automation',
      defaultSessionId: 'session-a',
      actionRequestId: 'tool-call-a',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'invalid_parameters',
      error: 'invalid_parameters',
    });
    expect(presentationApply).not.toHaveBeenCalled();

    const unavailable = createActionExecutor({
      isActionApprovalRequired: () => false,
    } as unknown as ActionExecutorDeps);
    await expect(unavailable.execute('session.presentation.apply', {
      intent: { kind: 'companion.show' },
    }, {
      surface: 'agent',
      authority: 'account_automation',
      defaultSessionId: 'session-a',
      actionRequestId: 'tool-call-a',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'unsupported_action',
      error: 'unsupported_action:session.presentation.apply',
    });
  });
});
