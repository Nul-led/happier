import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test-only fake of the managed `happier` CLI used by bootstrap system-task tests. It answers the
 * JSON commands the local setup/repair/daemon kinds issue from a scenario file and records every
 * invocation so tests can assert the exact command sequence.
 */
export function createFakeHappierCli(scenario: Readonly<{
  serverCurrent?: Record<string, unknown>;
  authStatus?: Record<string, unknown>;
  authRequests?: readonly Record<string, unknown>[];
  authWaits?: readonly Record<string, unknown>[];
  serviceStatuses?: readonly Record<string, unknown>[];
  daemonStatuses?: readonly Record<string, unknown>[];
}>): Readonly<{
  cliPath: string;
  cleanup: () => void;
  readInvocations: () => string[][];
}> {
  const rootDir = mkdtempSync(join(tmpdir(), 'hsetup-cli-'));
  const cliPath = join(rootDir, 'fake-happier');
  const statePath = join(rootDir, 'scenario.json');
  const logPath = join(rootDir, 'invocations.log');

  writeFileSync(statePath, JSON.stringify({
    serverCurrent: scenario.serverCurrent ?? {
      ok: true,
      kind: 'server_current',
      data: {
        active: {
          id: 'cloud',
          serverUrl: 'https://relay.example.test',
          webappUrl: 'https://app.example.test',
        },
      },
    },
    authStatus: scenario.authStatus ?? {
      ok: true,
      kind: 'auth_status',
      data: {
        authenticated: true,
        credentialState: 'valid',
        machineRegistered: true,
        machineRegistrationState: 'server-confirmed',
        machineId: 'machine-local-1',
      },
    },
    authRequests: scenario.authRequests ?? [
      {
        publicKey: 'public-key-local-1',
      },
    ],
    authWaits: scenario.authWaits ?? [
      {
        success: true,
        machineId: 'machine-local-1',
      },
    ],
    serviceStatuses: scenario.serviceStatuses ?? [
      {
        ok: true,
        platform: process.platform,
        installed: true,
        daemon: { running: true, pid: 4321 },
        system: { ok: true, output: 'service ready' },
      },
    ],
    daemonStatuses: scenario.daemonStatuses ?? [
      {
        server: {
          serverUrl: 'https://relay.example.test',
          localServerUrl: null,
          publicServerUrl: 'https://relay.example.test',
          webappUrl: 'https://app.example.test',
        },
        daemon: {
          running: true,
          pid: 4321,
        },
        service: {
          installed: true,
          running: true,
        },
        auth: {
          authenticated: true,
          machineRegistered: true,
          machineId: 'machine-local-1',
          needsAuth: false,
        },
      },
    ],
  }, null, 2));

  writeFileSync(cliPath, `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');

const statePath = process.env.HAPPIER_FAKE_CLI_STATE_PATH;
const logPath = process.env.HAPPIER_FAKE_CLI_LOG_PATH;
const argv = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify(argv) + '\\n');

const state = JSON.parse(readFileSync(statePath, 'utf8'));
const command = argv.join(' ');

function printJson(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
}

if (command === 'server current --json') {
  printJson(state.serverCurrent);
  process.exit(0);
}

if (command === 'auth status --json') {
  printJson(state.authStatus);
  process.exit(0);
}

if (command === 'auth request --json') {
  const requests = Array.isArray(state.authRequests) ? state.authRequests : [];
  const next = requests.length > 0
    ? requests.shift()
    : {
        publicKey: 'public-key-local-default',
      };
  state.authRequests = requests;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  printJson(next);
  process.exit(0);
}

if (argv[0] === 'auth' && argv[1] === 'approve' && argv.includes('--json')) {
  printJson({ success: true });
  process.exit(0);
}

if (argv[0] === 'auth' && argv[1] === 'wait' && argv.includes('--json')) {
  const waits = Array.isArray(state.authWaits) ? state.authWaits : [];
  const next = waits.length > 0
    ? waits.shift()
    : {
        success: true,
        machineId: 'machine-local-default',
      };
  state.authWaits = waits;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  printJson(next);
  process.exit(0);
}

if (command === 'daemon service status --json' || command === 'service status --json') {
  const statuses = Array.isArray(state.serviceStatuses) ? state.serviceStatuses : [];
  const next = statuses.length > 0
    ? statuses.shift()
    : {
        ok: true,
        platform: process.platform,
        installed: true,
        daemon: { running: true, pid: 1234 },
        system: { ok: true, output: 'service ready' },
      };
  state.serviceStatuses = statuses;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  printJson(next);
  process.exit(0);
}

if (command === 'daemon status --json') {
  const statuses = Array.isArray(state.daemonStatuses) ? state.daemonStatuses : [];
  const next = statuses.length > 0
    ? statuses.shift()
    : {
        server: {
          serverUrl: 'https://relay.example.test',
          localServerUrl: null,
          publicServerUrl: 'https://relay.example.test',
          webappUrl: 'https://app.example.test',
        },
        daemon: {
          running: true,
          pid: 1234,
        },
        service: {
          installed: true,
          running: true,
        },
        auth: {
          authenticated: true,
          machineRegistered: true,
          machineId: 'machine-local-default',
          needsAuth: false,
        },
      };
  state.daemonStatuses = statuses;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  printJson(next);
  process.exit(0);
}

if (argv[0] === 'server' && argv[1] === 'set' && argv.includes('--json')) {
  printJson({ ok: true, kind: 'server_set' });
  process.exit(0);
}

if (
  argv.includes('--json')
  && (
    (
      argv[0] === 'service'
      && (argv[1] === 'install' || argv[1] === 'start' || argv[1] === 'stop' || argv[1] === 'restart')
    )
    || (
      argv[0] === 'daemon'
      && argv[1] === 'service'
      && (argv[2] === 'install' || argv[2] === 'start' || argv[2] === 'stop' || argv[2] === 'restart')
    )
  )
) {
  printJson({ ok: true, platform: process.platform });
  process.exit(0);
}

process.stderr.write('Unexpected fake happier args: ' + command + '\\n');
process.exit(1);
`);
  chmodSync(cliPath, 0o755);
  writeFileSync(logPath, '');

  return {
    cliPath,
    cleanup() {
      rmSync(rootDir, { recursive: true, force: true });
    },
    readInvocations() {
      const raw = readFileSync(logPath, 'utf8').trim();
      if (!raw) {
        return [];
      }
      return raw.split('\n').map((line) => JSON.parse(line) as string[]);
    },
  };
}


export function restoreEnvVar(key: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = previousValue;
}
