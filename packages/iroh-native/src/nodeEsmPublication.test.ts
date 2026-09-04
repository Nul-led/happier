import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('Node ESM publication', () => {
  it('publishes the lifecycle loader as a named export under the production TSX import hook', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "import { loadIrohNodeNative } from '@happier-dev/iroh-native/node'; if (typeof loadIrohNodeNative !== 'function') process.exit(2);",
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  }, 30_000);
});
