import { createHerdrClient, HerdrApiError } from '@/integrations/herdr/client';
import { runHerdrForeground } from '@/integrations/herdr/foreground';
import { HERDR_ACTION_TIMEOUT_MS, HERDR_STARTUP_TIMEOUT_MS, resolveHerdrRuntimeBinary } from '@/integrations/herdr/runtimeBinary';
import type { Metadata } from '@/api/types';

import { createTerminalAttachPlan } from './terminalAttachPlan';

export async function runHerdrAttach(params: Readonly<{
  terminal: NonNullable<Metadata['terminal']>;
}>): Promise<number> {
  const plan = createTerminalAttachPlan({ terminal: params.terminal, insideTmux: false });
  if (plan.type !== 'herdr') throw new Error('Session does not have a Herdr terminal attachment');

  const actionTimeoutMs = HERDR_ACTION_TIMEOUT_MS;
  const binary = await resolveHerdrRuntimeBinary({ actionTimeoutMs });
  if (!binary) throw new Error('A supported Herdr version is required to attach');
  const insideHerdr = Boolean(process.env.HERDR_PANE_ID && process.env.HERDR_SOCKET_PATH);
  if (insideHerdr && process.env.HERDR_SOCKET_PATH !== plan.socketPath) {
    throw new Error('Cannot attach to a different Herdr server from inside a Herdr pane');
  }
  const client = createHerdrClient({
    binary,
    sessionName: plan.sessionName,
    socketPath: plan.socketPath,
    actionTimeoutMs,
    startupTimeoutMs: HERDR_STARTUP_TIMEOUT_MS,
  });
  try {
    await client.assertServerVersion();
  } catch (error) {
    // Only an unreachable recorded namespace can be started here. Reachable
    // unsupported or malformed servers retain exact-server admission.
    if (!(error instanceof HerdrApiError) || error.code !== 'unreachable') throw error;
    await client.restoreRecordedServer();
  }
  let pane = await client.findPane(plan.terminalId);
  if (!pane) {
    const recordedPaneId = params.terminal.herdr?.paneId?.trim();
    if (!recordedPaneId) throw new Error('Herdr terminal is no longer available');
    // Released restore preserves the public pane, not its runtime terminal ID.
    // Opening this candidate grants neither Session identity nor pane custody.
    pane = await client.getPane(recordedPaneId);
    if (pane.paneId !== recordedPaneId) throw new Error('The recorded Herdr pane is unavailable');
    if (!insideHerdr) console.log('Opening the preserved Herdr pane; its Happier session still needs to reconnect.');
  }

  if (insideHerdr) {
    await client.request('pane.focus', { pane_id: pane.paneId });
    return 0;
  }

  return await runHerdrForeground({
    binary,
    args: ['terminal', 'attach', pane.terminalId],
    socketPath: client.socketPath ?? plan.socketPath,
    sessionName: plan.sessionName,
  });
}
