import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCommandSuite, type CommandSuiteEntry } from './lib/runCommandSuite.ts';
import { runYarnCommand } from './lib/runYarnCommand.ts';

export const ROOT_TEST_COMMANDS = {
  unit: [
    { id: 'privacy-kit', args: ['workspace', 'privacy-kit', 'test'] },
    { id: '@happier-dev/protocol', args: ['workspace', '@happier-dev/protocol', 'test'] },
    { id: '@happier-dev/peer-mediation', args: ['workspace', '@happier-dev/peer-mediation', 'test'] },
    { id: '@happier-dev/transfers', args: ['workspace', '@happier-dev/transfers', 'test'] },
    { id: '@happier-dev/voice-modelpacks', args: ['workspace', '@happier-dev/voice-modelpacks', 'test'] },
    { id: '@happier-dev/terminal-native', args: ['workspace', '@happier-dev/terminal-native', 'test'] },
    { id: '@happier-dev/sherpa-native', args: ['workspace', '@happier-dev/sherpa-native', 'test'] },
    { id: '@happier-dev/agents', args: ['workspace', '@happier-dev/agents', 'test'] },
    { id: '@happier-dev/cli-common', args: ['workspace', '@happier-dev/cli-common', 'test'] },
    { id: '@happier-dev/support', args: ['workspace', '@happier-dev/support', 'test'] },
    { id: '@happier-dev/connection-supervisor', args: ['workspace', '@happier-dev/connection-supervisor', 'test'] },
    { id: '@happier-dev/session-core', args: ['workspace', '@happier-dev/session-core', 'test'] },
    { id: '@happier-dev/bootstrap', args: ['workspace', '@happier-dev/bootstrap', 'test'] },
    { id: '@happier-dev/plugin-sdk', args: ['workspace', '@happier-dev/plugin-sdk', 'test'] },
    { id: '@happier-dev/plugin-ui', args: ['workspace', '@happier-dev/plugin-ui', 'test'] },
    { id: '@happier-dev/sdk', args: ['workspace', '@happier-dev/sdk', 'test'] },
    { id: '@happier-dev/channels-protocol', args: ['workspace', '@happier-dev/channels-protocol', 'test'] },
    { id: '@happier-dev/triage-protocol', args: ['workspace', '@happier-dev/triage-protocol', 'test'] },
    { id: '@happier-dev/triage-sources', args: ['workspace', '@happier-dev/triage-sources', 'test'] },
    { id: '@happier-dev/ssh-native', args: ['workspace', '@happier-dev/ssh-native', 'test'] },
    { id: '@happier-dev/audio-stream-native', args: ['workspace', '@happier-dev/audio-stream-native', 'test'] },
    { id: 'docs', args: ['workspace', 'docs', 'test'] },
    { id: '@happier-dev/app', args: ['workspace', '@happier-dev/app', 'test'] },
    { id: '@happier-dev/cli', args: ['workspace', '@happier-dev/cli', 'test:unit'] },
    { id: 'apps/server', args: ['--cwd', 'apps/server', 'test:unit'] },
    { id: 'packages/relay-server', args: ['--cwd', 'packages/relay-server', 'test'] },
    { id: 'apps/stack', args: ['--cwd', 'apps/stack', 'test:unit'] },
  ],
  integration: [
    { id: '@happier-dev/app', args: ['workspace', '@happier-dev/app', 'test:integration'] },
    { id: '@happier-dev/cli', args: ['workspace', '@happier-dev/cli', 'test:integration'] },
    { id: 'apps/server', args: ['--cwd', 'apps/server', 'test:integration'] },
    { id: 'apps/stack', args: ['--cwd', 'apps/stack', 'test:integration'] },
  ],
} as const satisfies Record<string, readonly CommandSuiteEntry[]>;

export async function runRootTests(lane: string): Promise<void> {
  if (lane !== 'unit' && lane !== 'integration') throw new Error('Test lane must be unit or integration');
  await runCommandSuite<CommandSuiteEntry>({
    commands: ROOT_TEST_COMMANDS[lane],
    suiteName: `Root ${lane} test suite`,
    runCommand: (command) => runYarnCommand(command, process.cwd()),
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runRootTests(process.argv[2]).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
