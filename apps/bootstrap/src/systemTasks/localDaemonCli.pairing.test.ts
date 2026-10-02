import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pairLocalMachineIfNeeded } from './localDaemonCli.js';

describe('bootstrap local machine repair pairing composition', () => {
  it('keeps the request packet through the actual CLI launcher and waits only after authenticated approval', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hsetup-current-pairing-'));
    const stateFile = join(directory, 'pending.json');
    const cliPath = join(directory, 'fixture-cli.cjs');
    const logPath = join(directory, 'commands.jsonl');
    writeFileSync(stateFile, JSON.stringify({ publicKey: 'current-key', pairingSecret: 'private-context' }), { mode: 0o600 });
    writeFileSync(cliPath, `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + '\\n');
if(argv[1]==='request')console.log(JSON.stringify({publicKey:'current-key',stateFile:${JSON.stringify(stateFile)},pairing:{secretB64Url:'private-context'},pairingRequirement:'v3'}));
else if(argv[1]==='approve'){
  if(argv[argv.indexOf('--request-file')+1]!==${JSON.stringify(stateFile)}) {console.error('Current recipient requires authenticated context');process.exit(1);}
  console.log(JSON.stringify({success:true}));
}else if(argv[1]==='wait')console.log(JSON.stringify({machineId:'current-repaired-machine'}));
else process.exit(2);
`);
    chmodSync(cliPath, 0o700);
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', cliPath);
    try {
      await expect(pairLocalMachineIfNeeded({ authenticated: true, machineId: null })).resolves.toBe('current-repaired-machine');
      const commands = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(commands.map((argv) => argv[1])).toEqual(['request', 'approve', 'wait']);
      expect(JSON.stringify(commands)).not.toContain('private-context');
    } finally {
      vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
    }
  });
});
