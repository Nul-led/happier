import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// This assertion intentionally pays for a fresh Node + TSX process. Bound the
// child itself (not only Vitest) and leave the same contention headroom used by
// the protocol import-boundary suite, so a stuck loader cannot pin this worker.
const NODE_ESM_PUBLICATION_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);

describe('Node ESM publication', () => {
  it('publishes the complete Node consumer boundary under the production TSX import hook', async () => {
    await expect(execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        [
          "import { classifyIrohHomeCarrierFailure, IrohError, loadIrohNodeNative, readIrohRelayConfigFromEnv } from '@happier-dev/iroh-native/node';",
          "if (typeof classifyIrohHomeCarrierFailure !== 'function') process.exit(2);",
          "if (typeof IrohError !== 'function') process.exit(3);",
          "if (typeof loadIrohNodeNative !== 'function') process.exit(4);",
          "if (typeof readIrohRelayConfigFromEnv !== 'function') process.exit(5);",
        ].join(' '),
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        timeout: NODE_ESM_PUBLICATION_TIMEOUT_MS,
      },
    )).resolves.toBeDefined();
  }, NODE_ESM_PUBLICATION_TIMEOUT_MS + 5_000);
});
