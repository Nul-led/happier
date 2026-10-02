import { expect, it } from 'vitest';
import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { waitForExecutionRunTerminal } from '../execution/runs/waitForTerminal.js';
import { WaitActionResultV1Schema } from './specs/wait.js';

// Only the session RPC boundary is substituted; Action policy and the run waiter stay real.
function executor(allowed = true) {
  return createActionExecutor({
    isActionEnabled: (id) => id !== 'execution.run.wait' || allowed,
    executionRunWait: async (_sessionId, request, options) => waitForExecutionRunTerminal({
      runId: request.runId, timeoutMs: null, signal: options?.signal,
      readRun: async () => ({ ok: true, data: { run: {
        runId: request.runId, callId: 'call', sidechainId: 'call', intent: 'delegate',
        backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, permissionMode: 'read_only',
        retentionPolicy: 'ephemeral', runClass: 'bounded', ioMode: 'request_response', startedAtMs: 1, status: 'failed',
      } } }),
      waitForTerminal: async () => { throw new Error('Terminal work must not wait'); },
    }),
  } as unknown as ActionExecutorDeps);
}
const input = { target: { kind: 'execution_run', serverId: 'home', machineId: 'machine', sessionId: 'session', runId: 'run' }, condition: { kind: 'terminal' } };
it('executes through canonical policy and returns failure as terminal evidence', async () => {
  expect(await executor().execute('wait', input, { surface: 'cli', serverId: 'home' })).toMatchObject({ ok: true, result: { disposition: 'matched', snapshot: { status: 'failed' } } });
});
it('refuses a target outside the captured Home before touching the transport', async () => {
  const result = await executor().execute('wait', { ...input, timeout: { durationMs: 1000 } }, { surface: 'cli', serverId: 'other' });
  expect(result).toMatchObject({ ok: true, result: { disposition: 'permission_denied' } });
  if (result.ok) expect(WaitActionResultV1Schema.safeParse(result.result).success).toBe(true);
});
it('does not bypass a disabled domain Action', async () => {
  expect(await executor(false).execute('wait', input, { surface: 'cli', serverId: 'home' })).toMatchObject({ ok: true, result: { disposition: 'permission_denied' } });
});
