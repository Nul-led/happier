import { createServer, type Server } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveNonCollidingRelayPort } from './resolveNonCollidingRelayPort.js';

const openServers: Server[] = [];
const temporaryHomes: string[] = [];

async function listenOnLoopback(port = 0): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  openServers.push(server);
  return server;
}

function requireListeningPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP loopback listener');
  return address.port;
}

async function createHomeDir(): Promise<string> {
  const homeDir = await mkdtemp(join(tmpdir(), 'happier-relay-port-planner-'));
  temporaryHomes.push(homeDir);
  return homeDir;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
  await Promise.all(temporaryHomes.splice(0).map(async (homeDir) => {
    await rm(homeDir, { recursive: true, force: true });
  }));
});

describe('resolveNonCollidingRelayPort', () => {
  it('selects another bindable port when the fresh default is occupied by an unrelated process', async () => {
    const occupyingServer = await listenOnLoopback();
    const occupiedPort = requireListeningPort(occupyingServer);

    const selectedPort = await resolveNonCollidingRelayPort({
      platform: 'linux',
      mode: 'user',
      channel: 'preview',
      homeDir: await createHomeDir(),
      defaultPort: occupiedPort,
      configuredPort: null,
    });

    expect(selectedPort).not.toBe(occupiedPort);
    const verificationServer = await listenOnLoopback(selectedPort);
    expect(requireListeningPort(verificationServer)).toBe(selectedPort);
  });

  it('keeps a persisted port stable when another process occupies it', async () => {
    const occupyingServer = await listenOnLoopback();
    const occupiedPort = requireListeningPort(occupyingServer);

    await expect(resolveNonCollidingRelayPort({
      platform: 'linux',
      mode: 'user',
      channel: 'preview',
      homeDir: await createHomeDir(),
      defaultPort: 3005,
      configuredPort: occupiedPort,
    })).resolves.toBe(occupiedPort);
  });
});
