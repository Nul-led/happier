import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const callers = ['cli-smoke.sh', 'cli2-smoke.sh', 'stack-entrypoint.sh', 'remote-daemon-smoke.sh', 'remote-daemon-authenticated-cli-smoke.sh'];

// Run the authored approval statement at its real executable boundary, without
// installing artifacts, signing in, invoking SSH, or starting release services.
async function fixture(t, { caller, requirement = 'v3', pairing = true, fail = false }) {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-pairing-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = join(dir, 'cli.cjs');
  const log = join(dir, 'invocation.json');
  await writeFile(cli, `const fs=require('fs');const args=process.argv.slice(2);const i=args.indexOf('--request-file');let packet=null,mode=null,path=null;if(i>=0){path=args[i+1];packet=JSON.parse(fs.readFileSync(path,'utf8'));mode=fs.statSync(path).mode&511;}fs.writeFileSync(process.env.TEST_LOG,JSON.stringify({args,packet,mode,path}));if(process.env.REQUIRE_CONTEXT==='1'&&(!packet||!packet.pairing)){console.error('Current recipient rejects legacy approval');process.exit(8);}if(process.env.FAIL_APPROVAL==='1'){console.error('Approval failed');process.exit(9);}`);
  const packet = { publicKey: 'fixture-public-key', ...(requirement ? { pairingRequirement: requirement } : {}), ...(pairing ? { pairing: { secretB64Url: 'fixture-pairing-secret', createdAtMs: 1, expiresAtMs: 2 } } : {}) };
  const raw = await readFile(join(root, 'bin', caller), 'utf8');
  const approval = raw.match(/^[ \t]*HAPPIER_HOME_DIR=.*(?:\\\n[^\n]*)*(?:auth approve[^\n]*|approve_terminal_pairing[^\n]*)/m)?.[0];
  assert.ok(approval, `${caller} must have an executable approval statement`);
  const helper = join(root, 'bin', 'terminal-pairing.sh');
  const script = `set -euo pipefail\nif [[ -f "$1" ]]; then source "$1"; fi\nHAPPIER_PREFIX=(node "$2")\npublic_key=fixture-public-key\nremote_public_key=$public_key\nreq_json=$(cat)\nremote_auth_request_json=$req_json\n${approval}\n`;
  const result = spawnSync('bash', ['-c', script, 'fixture', helper, cli], {
    input: JSON.stringify(packet), encoding: 'utf8',
    env: { ...process.env, TMPDIR: dir, TEST_LOG: log, REQUIRE_CONTEXT: requirement === 'v3' ? '1' : '0', FAIL_APPROVAL: fail ? '1' : '0', APPROVER_HOME_DIR: dir, STACK_APPROVER_HOME_DIR: dir, PRIMARY_CLI_HOME_DIR: dir, HAPPIER_ACTIVE_SERVER_ID: 'fixture', HAPPIER_SERVER_URL: 'http://localhost:3005', HAPPIER_PUBLIC_SERVER_URL: 'http://localhost:3005', HAPPIER_WEBAPP_URL: 'http://localhost:3005', selected_server_id: 'fixture', selected_approver_server_id: 'fixture' },
  });
  const invocation = JSON.parse(await readFile(log, 'utf8'));
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-pairing-secret/);
  assert.ok(!invocation.args.includes('fixture-pairing-secret'));
  assert.ok(!(await readdir(dir)).some((name) => name.startsWith('happier-terminal-request.')));
  return { result, invocation, packet };
}

for (const caller of callers) {
  test(`${caller} preserves the current request context and cleans up`, async (t) => {
    const { result, invocation, packet } = await fixture(t, { caller });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(invocation.packet, packet);
    assert.equal(invocation.mode, 0o600);
    assert.deepEqual(invocation.args.slice(0, 5), ['auth', 'approve', '--json', '--public-key', packet.publicKey]);
  });
}

test('compatible older artifact with pairing keeps the public-key-only command', async (t) => {
  const { result, invocation } = await fixture(t, { caller: callers[0], requirement: 'compatible' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(invocation.args, ['auth', 'approve', '--json', '--public-key', 'fixture-public-key']);
  assert.equal(invocation.packet, null);
});

test('older public-key-only artifact keeps its command', async (t) => {
  const { result, invocation } = await fixture(t, { caller: callers[0], requirement: null, pairing: false });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(invocation.args, ['auth', 'approve', '--json', '--public-key', 'fixture-public-key']);
});

test('failed approval removes its private packet without leaking the secret', async (t) => {
  const { result, invocation } = await fixture(t, { caller: callers[0], fail: true });
  assert.equal(result.status, 9, result.stderr);
  assert.equal(invocation.mode, 0o600);
});
