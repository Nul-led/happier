import chalk from 'chalk';

import { configuration } from '@/configuration';
import {
  DEFAULT_ZELLIJ_ACTION_TIMEOUT_MS,
  defaultZellijAttachActions,
  type ZellijAttachActions,
} from '@/integrations/zellij/actions';
import { resolveZellijRuntimeBinary } from '@/integrations/zellij/runtimeBinary';
import { prepareZellijSocketDir, resolveZellijSocketDir } from '@/integrations/zellij/socketDir';

import { createTerminalAttachPlan } from './terminalAttachPlan';
import type { TerminalAttachmentInfo } from './terminalAttachmentInfo';

export async function runZellijAttach(
  params: Readonly<{
    sessionId: string;
    terminal: NonNullable<TerminalAttachmentInfo['terminal']>;
  }>,
  deps: Readonly<{
    resolveZellijBinaryFn?: () => Promise<string | null>;
    actions?: ZellijAttachActions;
    happyHomeDir?: string;
    prepareSocketDirFn?: (socketDir: string) => Promise<void>;
  }> = {},
): Promise<number> {
  const plan = createTerminalAttachPlan({ terminal: params.terminal, insideTmux: false });
  if (plan.type !== 'zellij') {
    const reason = plan.type === 'not-attachable'
      ? plan.reason
      : 'Session is not backed by a Zellij terminal host.';
    console.error(chalk.red('Error:'), reason);
    return 1;
  }

  const zellijBinary = await (deps.resolveZellijBinaryFn ?? resolveZellijRuntimeBinary)();
  if (!zellijBinary) {
    console.error(chalk.red('Error:'), 'Bundled Zellij is unavailable; cannot attach to this terminal-hosted session.');
    return 1;
  }

  const socketDir = resolveZellijSocketDir(deps.happyHomeDir ?? configuration.happyHomeDir);
  await (deps.prepareSocketDirFn ?? prepareZellijSocketDir)(socketDir);
  const actions = deps.actions ?? defaultZellijAttachActions;
  const env = { ZELLIJ_SOCKET_DIR: socketDir };

  if (plan.paneId) {
    await actions.focusPane({
      zellijBinary,
      env: { ...env, ZELLIJ_SESSION_NAME: plan.sessionName },
      paneId: plan.paneId,
      timeoutMs: DEFAULT_ZELLIJ_ACTION_TIMEOUT_MS,
    }).catch(() => {});
  }

  const result = await actions.attachForeground({
    zellijBinary,
    env,
    sessionName: plan.sessionName,
  });
  if (result.exitCode !== 0) {
    console.error(chalk.red('Error:'), result.stderr || result.stdout || `Zellij attach exited with ${result.exitCode}.`);
  }
  return result.exitCode;
}
