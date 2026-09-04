import { describe, expect, it, vi } from 'vitest';

describe('executeSessionHandoffAction', () => {
  const status = { handoffId: 'handoff_1', status: 'completed' as const, phase: 'finalizing' as const, recoveryActions: [] };

  it('returns the handoff id when the action executor returns a successful handoff result', async () => {
    const { executeSessionHandoffAction } = await import('./executeSessionHandoffAction');

    const execute = vi.fn(async () => ({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status,
      },
    }));

    const result = await executeSessionHandoffAction({
      execute: execute as any,
      sessionId: 'sess_1',
      targetMachineId: 'machine_target',
      context: { defaultSessionId: 'sess_1', surface: 'ui', placement: 'session_info' } as any,
    });

    expect(result).toEqual({ ok: true, result: { handoffId: 'handoff_1', status } });
  });

  it('passes optional handoff options through to the action executor', async () => {
    const { executeSessionHandoffAction } = await import('./executeSessionHandoffAction');

    const execute = vi.fn(async () => ({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status,
      },
    }));

    await executeSessionHandoffAction({
      execute: execute as any,
      sessionId: 'sess_1',
      targetMachineId: 'machine_target',
      targetPath: '/home/guest/workspace',
      targetSessionStorageMode: 'persisted',
      workspaceAction: { kind: 'none' },
      context: { defaultSessionId: 'sess_1', surface: 'ui', placement: 'session_info' } as any,
    });

    expect(execute).toHaveBeenCalledWith(
      'session.handoff',
      {
        sessionId: 'sess_1',
        targetMachineId: 'machine_target',
        targetPath: '/home/guest/workspace',
        targetSessionStorageMode: 'persisted',
        workspaceAction: { kind: 'none' },
      },
      expect.anything(),
    );
  });

  it('returns the daemon-committed workspace outcome from the action result', async () => {
    const { executeSessionHandoffAction } = await import('./executeSessionHandoffAction');

    const execute = vi.fn(async () => ({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status,
        workspace: { kind: 'relationship', relationshipId: 'relationship-1', created: false },
      },
    }));

    await expect(executeSessionHandoffAction({
      execute: execute as any,
      sessionId: 'sess_1',
      targetMachineId: 'machine_target',
      workspaceAction: { kind: 'relationship', relationshipId: 'relationship-1', flushBeforeCommit: true },
      context: { defaultSessionId: 'sess_1', surface: 'ui', placement: 'session_info' } as any,
    })).resolves.toEqual({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status,
        workspace: { kind: 'relationship', relationshipId: 'relationship-1', created: false },
      },
    });
  });

  it('returns a normalized error when the action executor rejects the request', async () => {
    const { executeSessionHandoffAction } = await import('./executeSessionHandoffAction');

    const execute = vi.fn(async () => ({
      ok: false,
      errorCode: 'unsupported_action',
      error: 'unsupported_action:session.handoff',
    }));

    const result = await executeSessionHandoffAction({
      execute: execute as any,
      sessionId: 'sess_1',
      targetMachineId: 'machine_target',
      context: { defaultSessionId: 'sess_1', surface: 'ui', placement: 'session_info' } as any,
    });

    expect(result).toEqual({ ok: false, error: 'unsupported_action:session.handoff' });
  });

  it('fails when the action result does not include a handoff id', async () => {
    const { executeSessionHandoffAction } = await import('./executeSessionHandoffAction');

    const execute = vi.fn(async () => ({
      ok: true,
      result: {
        status,
      },
    }));

    const result = await executeSessionHandoffAction({
      execute: execute as any,
      sessionId: 'sess_1',
      targetMachineId: 'machine_target',
      context: { defaultSessionId: 'sess_1', surface: 'ui', placement: 'session_info' } as any,
    });

    expect(result).toEqual({ ok: false, error: 'unsupported_session_handoff_result' });
  });
});
