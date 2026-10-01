import './utils/env/env.mjs';

const rawArgv = process.argv.slice(2);
const argv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv;
const separatorIndex = argv.indexOf('--');
const helpScopeArgv = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
const command = helpScopeArgv.find((arg) => arg && !arg.startsWith('-'));

if (command === 'list' && !helpScopeArgv.includes('--help') && !helpScopeArgv.includes('-h')) {
  const { listAllStackNames } = await import('./utils/stack/stacks.mjs');
  const names = (await listAllStackNames()).filter((name) => name !== 'main');
  if (helpScopeArgv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ stacks: names }, null, 2)}\n`);
  } else if (names.length) {
    process.stdout.write(`[stack] stacks:\n${names.map((name) => `- ${name}`).join('\n')}\n`);
  } else {
    process.stdout.write('[stack] no stacks found\n');
  }
} else {
  await import('./stack_commands.mjs');
}
