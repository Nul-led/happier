import { createHerdrClient } from '@/integrations/herdr/client';
import { runHerdrForeground } from '@/integrations/herdr/foreground';
import { HERDR_ACTION_TIMEOUT_MS, resolveHerdrRuntimeBinary } from '@/integrations/herdr/runtimeBinary';
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
  const client = createHerdrClient({
    binary,
    sessionName: plan.sessionName,
    socketPath: plan.socketPath,
    actionTimeoutMs,
    startupTimeoutMs: actionTimeoutMs,
  });
  await client.assertServerVersion();

  if (process.env.HERDR_PANE_ID && process.env.HERDR_SOCKET_PATH) {
    if (process.env.HERDR_SOCKET_PATH !== plan.socketPath) {
      throw new Error('Cannot attach to a different Herdr server from inside a Herdr pane');
    }
    const pane = await client.findPane(plan.terminalId);
    if (!pane) throw new Error('Herdr terminal is no longer available');
    await client.request('pane.focus', { pane_id: pane.paneId });
    return 0;
  }

  return await runHerdrForeground({
    binary,
    args: ['--session', plan.sessionName, 'terminal', 'attach', plan.terminalId],
    socketPath: plan.socketPath,
  });
}
