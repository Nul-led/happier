import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(
  process.execPath,
  [
    join(packageDir, '..', '..', 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--config',
    'vitest.config.ts',
    'src/firstPartyRuntime/mutagenEngineAcquisition.live.test.ts',
  ],
  {
    cwd: packageDir,
    env: {
      ...process.env,
      HAPPIER_TEST_MUTAGEN_ENGINE_LIVE_ACQUISITION: '1',
    },
    stdio: 'inherit',
  },
);

child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
