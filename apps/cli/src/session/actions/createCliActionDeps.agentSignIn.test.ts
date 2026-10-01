import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionExecutor } from '@happier-dev/protocol';
const { callMachineRpc } = vi.hoisted(() => ({ callMachineRpc: vi.fn() }));
vi.mock('@/session/transport/rpc/machineRpc', async (original) => ({
  ...await original<typeof import('@/session/transport/rpc/machineRpc')>(), callMachineRpc,
}));
import { createCliActionDeps } from './createCliActionDeps';

describe('machine Agent sign-in Actions', () => {
  beforeEach(() => callMachineRpc.mockReset());
  it.each(['cli', 'mcp'] as const)('starts the typed native terminal through %s and checks its uncached native status', async (surface) => {
    const credentials = { token: 'fixture', encryption: { type: 'legacy' as const, secret: new Uint8Array(32) } };
    const executor = createActionExecutor(createCliActionDeps({ token: credentials.token, credentials,
      sessionId: 'session', mode: 'plain', ctx: null }));
    callMachineRpc.mockResolvedValueOnce({ method: 'native', launch: { kind: 'agent_login', agentId: 'codex' } });
    callMachineRpc.mockResolvedValueOnce({ ok: true, terminalId: 'login-terminal', reused: false });
    expect(await executor.execute('machines.agents.signIn.start', { machineId: 'machine', agentId: 'codex', method: 'native' },
      // MCP reaches this operation after the canonical approval owner admits its replay.
      { surface, authority: 'present_user', ...(surface === 'mcp' ? { bypassApprovals: true }
        : { presentUserConfirmation: { actionId: 'machines.agents.signIn.start' } }) }))
      .toMatchObject({ ok: true, result: { terminalKey: 'provider-login:machine:codex' } });
    expect(callMachineRpc).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'daemon.terminal.ensure',
      request: { terminalKey: 'provider-login:machine:codex', launch: { kind: 'agent_login', agentId: 'codex' } } }));
    callMachineRpc.mockResolvedValueOnce({ status: 'signedIn', accountLabel: 'fixture@example.invalid', checkedAt: 1,
      nativeLogin: 'login_terminal', connectedServices: [] });
    expect(await executor.execute('machines.agents.signIn.status', { machineId: 'machine', agentId: 'codex' },
      { surface: 'mcp', authority: 'present_user' })).toMatchObject({ ok: true, result: { status: 'signedIn' } });
  });
  it('uses the connected-account command owner, including manual-input results', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ method: 'connected', command: { operation: 'beginConnect',
      service: { pluginId: 'happier.agent.gemini', localId: 'gemini-account' }, modeId: 'api-key' } })
      .mockResolvedValueOnce({ status: 'unavailable', code: 'connected_account_daemon_runtime_unavailable' });
    const executor = createActionExecutor(createCliActionDeps({ token: 'fixture', sessionId: 'session', mode: 'plain', ctx: null,
      machineActionDirectTargetTransport: { machineId: 'machine', invoke } }));
    expect(await executor.execute('machines.agents.signIn.start', { machineId: 'machine', agentId: 'gemini' },
      { surface: 'cli', authority: 'present_user', presentUserConfirmation: { actionId: 'machines.agents.signIn.start' } }))
      .toMatchObject({ ok: true, result: { status: 'unavailable' } });
    expect(invoke).toHaveBeenLastCalledWith('daemon.connectedAccounts.authentication.command', expect.objectContaining({
      v: 1, machineId: 'machine', command: expect.objectContaining({ operation: 'beginConnect' }),
    }), undefined);
  });

  it.each(['machines.agents.signIn.start', 'machines.agents.signIn.status'] as const)(
    'rejects a different Home before %s can reach the admitted machine', async (actionId) => {
      const invoke = vi.fn(async (method: string) => method === 'daemon.agents.signIn.prepare'
        ? { method: 'native', launch: { kind: 'agent_login', agentId: 'codex' } }
        : { status: 'signedIn', accountLabel: null, checkedAt: 1, nativeLogin: 'login_terminal', connectedServices: [] });
      const executor = createActionExecutor({
        ...createCliActionDeps({ token: 'fixture', sessionId: 'session', mode: 'plain', ctx: null,
          serverId: 'home-1', serverHttpBaseUrl: 'https://home-1.test', machineActionDirectTargetTransport: { machineId: 'machine', invoke },
        }),
        isActionApprovalRequired: () => false,
      });
      expect(await executor.execute(actionId, { machineId: 'machine', agentId: 'codex' }, {
        surface: 'cli', authority: 'present_user', serverId: 'home-2',
      })).toMatchObject({ ok: false, errorCode: 'action_failed', error: 'server_scope_mismatch' });
      expect(invoke).not.toHaveBeenCalled();
      expect(callMachineRpc).not.toHaveBeenCalled();
    },
  );
});
