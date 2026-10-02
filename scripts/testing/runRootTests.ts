import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCommandSuite, type CommandSuiteEntry } from './lib/runCommandSuite.ts';
import { runYarnCommand } from './lib/runYarnCommand.ts';
import { selectSharedPackageTestCommands } from './runSharedPackageTests.ts';

export const ROOT_TEST_COMMANDS = {
  unit: [
    ...selectSharedPackageTestCommands('local'),
    { id: '@happier-dev/plugin-sdk', args: ['workspace', '@happier-dev/plugin-sdk', 'test'] },
    { id: '@happier-dev/plugin-ui', args: ['workspace', '@happier-dev/plugin-ui', 'test'] },
    { id: '@happier-dev/sdk', args: ['workspace', '@happier-dev/sdk', 'test'] },
    { id: '@happier-dev/app', args: ['workspace', '@happier-dev/app', 'test'] },
    { id: '@happier-dev/cli', args: ['workspace', '@happier-dev/cli', 'test:unit'] },
    { id: 'apps/server', args: ['--cwd', 'apps/server', 'test:unit'] },
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
