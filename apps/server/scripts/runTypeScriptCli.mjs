import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDir, '..');
process.chdir(serverRoot);
await import('../../../scripts/workspaces/runTypeScriptCli.mjs');
