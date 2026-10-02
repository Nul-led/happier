import { configuration } from '@/configuration';
import { createHerdrClient } from '@/integrations/herdr/client';
import { resolveHerdrRuntimeBinary } from '@/integrations/herdr/runtimeBinary';
import { runHerdrForeground } from '@/integrations/herdr/foreground';
import type { Metadata } from '@/api/types';

import { createTerminalAttachPlan } from './terminalAttachPlan';

export async function runHerdrAttach(params: Readonly<{
  terminal: NonNullable<Metadata['terminal']>;
}>): Promise<number> {
  const plan = createTerminalAttachPlan({ terminal: params.terminal, insideTmux: false });
  if (plan.type !== 'herdr') throw new Error('Session does not have a Herdr terminal attachment');

  const binary = await resolveHerdrRuntimeBinary({
    actionTimeoutMs: configuration.claudeUnifiedTerminalHostActionTimeoutMs,
  });
  if (!binary) throw new Error('A supported Herdr version is required to attach');

  const insideHerdr = Boolean(process.env.HERDR_PANE_ID && process.env.HERDR_SOCKET_PATH);
  if (insideHerdr && process.env.HERDR_SOCKET_PATH !== plan.socketPath) {
    throw new Error('Cannot attach to a different Herdr server from inside a Herdr pane');
  }
  const client = createHerdrClient({
    binary,
    sessionName: plan.sessionName,
    socketPath: plan.socketPath,
    actionTimeoutMs: configuration.claudeUnifiedTerminalHostActionTimeoutMs,
    startupTimeoutMs: configuration.claudeUnifiedTerminalHostActionTimeoutMs,
  });
  await client.assertServerVersion();

  if (insideHerdr) {
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
