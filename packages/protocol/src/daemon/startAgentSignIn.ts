import { AgentSignInPrepareResponseSchema, machineAgentSignInTerminalKey, type AgentSignInPrepareRequest, type MachinesAgentsSignInStartOutput } from './agentSignIn.js';
import type { ConnectedAccountAttemptResponse, ConnectedAccountDaemonCommand } from '../connect/connectedAccountDaemonRpcV1.js';
import type { DaemonTerminalEnsureRequest, DaemonTerminalEnsureResponse, DaemonTerminalCloseResponse } from './terminal.js';

/** One sequence; the existing terminal and Connected Account owners retain execution. */
export async function startMachineAgentSignIn(
  input: AgentSignInPrepareRequest & { machineId: string },
  operations: Readonly<{
    prepare(request: AgentSignInPrepareRequest): Promise<unknown>;
    beginConnect(command: ConnectedAccountDaemonCommand): Promise<ConnectedAccountAttemptResponse>;
    ensureTerminal(request: DaemonTerminalEnsureRequest): Promise<DaemonTerminalEnsureResponse>;
    closeTerminal(terminalId: string): Promise<DaemonTerminalCloseResponse>;
    signal?: AbortSignal;
  }>,
): Promise<MachinesAgentsSignInStartOutput> {
  const { machineId, ...request } = input;
  const cancelled = { ok: false as const, errorCode: 'sign_in_cancelled', error: 'Sign-in cancelled' };
  if (operations.signal?.aborted) return cancelled;
  const prepared = AgentSignInPrepareResponseSchema.parse(await operations.prepare(request));
  if ('ok' in prepared) return prepared;
  if (operations.signal?.aborted) return cancelled;
  if (prepared.method === 'connected') return await operations.beginConnect(prepared.command);
  const terminalKey = machineAgentSignInTerminalKey(machineId, request.agentId);
  // Acquisition must retain its response even after cancellation: only that
  // response identifies the process that needs closing. The daemon owns reuse
  // and initial dimensions; visual attachment is not launch admission.
  const ensured = await operations.ensureTerminal({ terminalKey, launch: prepared.launch });
  if (!ensured.ok) return ensured;
  if (operations.signal?.aborted) {
    const closed = await operations.closeTerminal(ensured.terminalId);
    return closed.ok ? cancelled : closed;
  }
  return { terminalKey };
}
