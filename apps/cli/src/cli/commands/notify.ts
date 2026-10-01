import type { CommandContext } from '@/cli/commandRegistry';
import { findCompiledActionCliCommand, listCompiledActionCliCommands } from '@/cli/actions/compiledCommands';
import { runCompiledActionCliCommand } from '@/cli/actions/executeCommand';

/** The compatibility entry delegates parsing, policy and delivery to the Action. */
export async function handleNotifyCliCommand(context: CommandContext): Promise<void> {
  const command = findCompiledActionCliCommand(['notify'], listCompiledActionCliCommands());
  if (!command) throw new Error('notifications.notify_me CLI surface unavailable');
  await runCompiledActionCliCommand({ command, argv: context.args });
}
