#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runHomeIrohRealIntegration } from './run-home-iroh-real-integration.mjs';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = resolve(packageDir, '../..');
const relayDir = join(repoRoot, 'deploy', 'iroh-relay');
const testConfigPath = join(packageDir, 'scripts', 'relay-docker-test.toml');

function docker(args, { capture = false } = {}) {
  return execFileSync('docker', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })?.trim() ?? '';
}

export function parsePublishedRelayPort(output) {
  const match = /^127\.0\.0\.1:(\d+)$/u.exec(output.trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
    throw new Error(`Docker did not publish the Iroh relay on one loopback TCP port: ${output.trim()}`);
  }
  return Number(match[1]);
}

async function waitForRelayPort(port) {
  const deadline = Date.now() + 30_000;
  let lastError = 'connection not attempted';
  while (Date.now() < deadline) {
    try {
      await new Promise((resolveReady, reject) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolveReady(); });
        socket.once('error', reject);
        socket.setTimeout(2_000, () => socket.destroy(new Error('relay port probe timed out')));
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error(`Stock Docker Iroh relay did not accept TCP within 30 seconds (${lastError})`);
}

/** One pinned stock relay container; the existing source runner owns all tests/builds. */
export async function runHomeIrohDockerIntegration({
  runDocker = docker,
  awaitRelay = waitForRelayPort,
  runIntegration = runHomeIrohRealIntegration,
  env = process.env,
  runId = randomUUID(),
} = {}) {
  const suffix = runId.replace(/[^a-zA-Z0-9]/gu, '').slice(0, 20).toLowerCase();
  const image = `happier-iroh-relay-e2e:${suffix}`;
  const container = `happier-iroh-relay-e2e-${suffix}`;
  let started = false;
  let primaryError = null;
  try {
    runDocker(['build', '-t', image, '-f', join(relayDir, 'Dockerfile'), relayDir]);
    runDocker([
      'run', '-d', '--name', container,
      '-p', '127.0.0.1::8080/tcp',
      '--mount', `type=bind,src=${testConfigPath},dst=/etc/iroh/relay.toml,readonly`,
      '--entrypoint', '/usr/local/bin/iroh-relay',
      image, '--config-path', '/etc/iroh/relay.toml',
    ], { capture: true });
    started = true;
    const port = parsePublishedRelayPort(runDocker(['port', container, '8080/tcp'], { capture: true }));
    await awaitRelay(port);
    runIntegration({
      dockerOnly: true,
      env: { ...env, HAPPIER_TEST_IROH_EXTERNAL_RELAY_URL: `http://127.0.0.1:${port}` },
    });
  } catch (error) {
    primaryError = error;
    if (started) {
      try {
        const logs = runDocker(['logs', '--tail', '100', container], { capture: true });
        if (logs) process.stderr.write(`Docker Iroh relay logs:\n${logs}\n`);
      } catch { /* preserve the original failure */ }
    }
  } finally {
    for (const args of [
      ['rm', '-f', container],
      ['image', 'rm', image],
    ]) {
      try {
        runDocker(args, { capture: true });
      } catch (cleanupError) {
        if (!primaryError) primaryError = cleanupError;
        else process.stderr.write(`Docker Iroh cleanup failed: ${String(cleanupError)}\n`);
      }
    }
  }
  if (primaryError) throw primaryError;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runHomeIrohDockerIntegration();
}
