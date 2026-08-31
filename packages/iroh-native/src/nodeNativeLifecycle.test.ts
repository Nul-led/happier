import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { loadIrohNodeNative, resolveIrohNodeAddonPath } from './nodeNative';
import { IROH_NODE_NATIVE_EXPORTS, type NodeIrohNativeModule } from './nodeNative.types';

/**
 * Shared-owner behavior through the real binding: when the addon artifact is
 * built for this host, exercise create endpoint → start acceptor → status →
 * tunnel leases → release → shutdown against the one native runtime. When no
 * artifact exists the suite reports skipped (not-run), never a fake runtime.
 */
// Remote source synchronization intentionally removes ignored native outputs
// from the mirrored package directory. An explicit test-only package root lets
// the deciding run load the freshly built addon from a non-mirrored temp path
// while every TypeScript test byte still comes from the current checkout.
const packageRoot = process.env.HAPPIER_IROH_TEST_PACKAGE_ROOT ?? join(import.meta.dirname, '..');
const addonPath = resolveIrohNodeAddonPath(packageRoot);
const hasBuiltAddon = existsSync(addonPath);
const loaded = loadIrohNodeNative(packageRoot);
if (process.env.HAPPIER_IROH_REQUIRE_NODE_ADDON === '1' && !hasBuiltAddon) {
  throw new Error(`required Iroh lifecycle addon is missing: ${addonPath}`);
}
if (hasBuiltAddon && !loaded.available) {
  throw new Error(`built Iroh lifecycle addon failed to load: ${loaded.message}`);
}
const describeWhenNative = hasBuiltAddon ? describe : describe.skip;

function startEchoServer(): Promise<{ server: Server; port: number; connections: { count: number } }> {
  return new Promise((resolve, reject) => {
    const connections = { count: 0 };
    const server = createServer((socket) => {
      connections.count += 1;
      socket.on('data', (chunk) => {
        socket.write(chunk);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('echo server address missing'));
        return;
      }
      resolve({ server, port: address.port, connections });
    });
  });
}

function startAdmissionServer(
  expectedRemoteEndpointId: string,
  applicationPort: number | null,
): Promise<{ server: Server; port: number; requests: string[] }> {
  return new Promise((resolve, reject) => {
    const requests: string[] = [];
    const server = createServer((socket) => {
      let request = '';
      socket.on('data', (chunk) => {
        request += chunk.toString('utf8');
        const split = request.indexOf('\r\n\r\n');
        if (split < 0) return;
        const length = Number(/\r\nContent-Length: (\d+)\r\n/i.exec(request.slice(0, split + 4))?.[1] ?? -1);
        if (request.length < split + 4 + length) return;
        requests.push(request);
        const applicationPortHeader =
          applicationPort === null ? '' : `X-Happier-Iroh-Application-Port: ${applicationPort}\r\n`;
        socket.end(
          `HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: ${expectedRemoteEndpointId}\r\n${applicationPortHeader}Content-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('admission server address missing'));
      resolve({ server, port: address.port, requests });
    });
  });
}

function echoOverPort(port: number, payload: string): Promise<void> {
  return echoOverRuntimeOrigin(`http://127.0.0.1:${port}`, payload);
}

function loopbackPortOf(origin: string): number {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error(`runtime origin must be a loopback http origin: ${origin}`);
  }
  return Number(url.port);
}

function echoOverRuntimeOrigin(origin: string, payload: string): Promise<void> {
  const port = loopbackPortOf(origin);
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    socket.setTimeout(20_000);
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (received.length >= payload.length) {
        socket.destroy();
        resolve();
      }
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`echo timeout on ${origin}`));
    });
    socket.on('error', reject);
  });
}

/** Resolves true once `origin` refuses connections (bounded polling). */
async function expectOriginDown(origin: string): Promise<boolean> {
  const port = loopbackPortOf(origin);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.setTimeout(2_000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!up) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

describeWhenNative('Iroh Node lifecycle binding over the shared native runtime', () => {
  let echo: { server: Server; port: number; connections: { count: number } } | null = null;
  let admission: { server: Server; port: number; requests: string[] } | null = null;
  let keyDir: string | null = null;

  const native: NodeIrohNativeModule | null = loaded.available ? loaded.native : null;

  function requireNative(): NodeIrohNativeModule {
    if (!native) throw new Error('native addon unexpectedly unavailable');
    return native;
  }

  afterEach(async () => {
    if (echo) {
      const server = echo.server;
      echo = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (admission) {
      const server = admission.server;
      admission = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (keyDir) {
      const dir = keyDir;
      keyDir = null;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports availability and typed null for unknown handles', async () => {
    const addon = requireNative();
    const availability = addon.getAvailability();
    expect(availability.available).toBe(true);
    expect(availability.surface).toEqual([...IROH_NODE_NATIVE_EXPORTS]);
    await expect(addon.getEndpointStatus('missing-handle')).resolves.toBeNull();
    await expect(addon.getTunnelStatus('missing-tunnel')).resolves.toBeNull();
  });

  it('serves two tunnel leases on one shared endpoint, releases one, and shuts down', { timeout: 90_000 }, async () => {
    const addon = requireNative();
    echo = await startEchoServer();
    keyDir = await mkdtemp(join(tmpdir(), 'happier-iroh-node-binding-'));
    const serverKey = join(keyDir, 'server.key');
    const clientKey = join(keyDir, 'client.key');

    const serverEndpoint = await addon.createEndpoint({ keyPath: serverKey, relayPolicy: 'disabled' });
    const serverStatus = await addon.getEndpointStatus(serverEndpoint.endpointHandle);
    expect(serverStatus?.active).toBe(true);
    const directAddress = serverStatus?.directAddresses[0];
    if (typeof directAddress !== 'string') throw new Error('endpoint status missing a direct address');

    const acceptor = await addon.startHomeAcceptor({
      endpointHandle: serverEndpoint.endpointHandle,
      targetPort: echo.port,
    });
    expect(acceptor.reused).toBe(false);
    expect(acceptor.status.running).toBe(true);

    const clientEndpoint = await addon.createEndpoint({ keyPath: clientKey, relayPolicy: 'disabled' });
    const leaseRequest = {
      endpointHandle: clientEndpoint.endpointHandle,
      homeServerIdentityId: 'srv_home_a',
      endpointId: serverEndpoint.endpointId,
      directAddresses: [directAddress],
    };
    const first = await addon.ensureHomeTunnel(leaseRequest);
    const second = await addon.ensureHomeTunnel({ ...leaseRequest, homeServerIdentityId: 'srv_home_b' });
    // Compatible leases share the one endpoint handle — no second runtime.
    expect(first.endpointHandle).toBe(clientEndpoint.endpointHandle);
    expect(second.endpointHandle).toBe(clientEndpoint.endpointHandle);
    expect(first.runtimeOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(second.runtimeOrigin).not.toBe(first.runtimeOrigin);

    await echoOverRuntimeOrigin(first.runtimeOrigin, 'iroh-node-binding-bytes-a');
    await echoOverRuntimeOrigin(second.runtimeOrigin, 'iroh-node-binding-bytes-b');

    const status = await addon.getTunnelStatus(first.tunnelId);
    expect(status?.connectionActive).toBe(true);
    expect(status?.observedPath).toBe('direct');

    await addon.releaseHomeTunnel(first.tunnelId);
    expect(await expectOriginDown(first.runtimeOrigin)).toBe(true);
    const sibling = await addon.getTunnelStatus(second.tunnelId);
    expect(sibling?.connectionActive).toBe(true);

    await addon.stopHomeAcceptor({ endpointHandle: serverEndpoint.endpointHandle });
    await addon.shutdownEndpoint({ endpointHandle: clientEndpoint.endpointHandle });
    await addon.shutdownEndpoint({ endpointHandle: serverEndpoint.endpointHandle });
    await expect(addon.getEndpointStatus(clientEndpoint.endpointHandle)).resolves.toBeNull();
  });

  it('moves real bytes through the lifecycle-only machine tunnel to the admission-selected application port', { timeout: 90_000 }, async () => {
    const addon = requireNative();
    echo = await startEchoServer();
    keyDir = await mkdtemp(join(tmpdir(), 'happier-iroh-machine-binding-'));
    const serverEndpoint = await addon.createEndpoint({ keyPath: join(keyDir, 'server.key'), relayPolicy: 'disabled', capProfile: 'machineBulk' });
    const clientEndpoint = await addon.createEndpoint({ keyPath: join(keyDir, 'client.key'), relayPolicy: 'disabled', capProfile: 'machineBulk' });
    // The trusted local admission response — not an acceptor input — selects
    // the application loopback port for the authenticated stream.
    admission = await startAdmissionServer(clientEndpoint.endpointId, echo.port);
    await addon.startMachineAcceptor({
      endpointHandle: serverEndpoint.endpointHandle,
      admissionPort: admission.port,
    });
    const serverStatus = await addon.getEndpointStatus(serverEndpoint.endpointHandle);
    const directAddress = serverStatus?.directAddresses[0];
    if (!directAddress) throw new Error('machine endpoint direct address missing');
    const handshakeJson = JSON.stringify({ v: 1, operationId: 'node-machine-operation' });
    const tunnel = await addon.startMachineTunnel({
      endpointHandle: clientEndpoint.endpointHandle,
      endpointId: serverEndpoint.endpointId,
      directAddresses: [directAddress],
      handshakeJson,
    });
    expect(tunnel.localPort).toBeGreaterThan(0);
    // The tunnel surfaces the normalized authenticated remote identity.
    expect(tunnel.remoteEndpointId).toBe(serverEndpoint.endpointId);
    await echoOverPort(tunnel.localPort, 'node-machine-native-nonzero-bytes');
    expect(admission.requests).toHaveLength(1);
    expect(admission.requests[0]).toContain(`X-Happier-Iroh-Remote-Endpoint-Id: ${clientEndpoint.endpointId}\r\n`);
    expect(admission.requests[0]?.endsWith(handshakeJson)).toBe(true);
    const status = await addon.getMachineTunnelStatus(tunnel.machineTunnelId);
    expect(status?.streamsOpened).toBe(1);
    expect(status?.remoteEndpointId).toBe(serverEndpoint.endpointId);
    const acceptorStatus = await addon.getMachineAcceptorStatus(serverEndpoint.endpointHandle);
    expect(acceptorStatus?.streamsAccepted).toBe(1);
    await addon.stopMachineTunnel(tunnel.machineTunnelId);
    await expect(addon.getMachineTunnelStatus(tunnel.machineTunnelId)).resolves.toBeNull();
    expect(await expectOriginDown(`http://127.0.0.1:${tunnel.localPort}`)).toBe(true);
    await addon.stopMachineAcceptor({ endpointHandle: serverEndpoint.endpointHandle });
    await expect(addon.getMachineAcceptorStatus(serverEndpoint.endpointHandle)).resolves.toBeNull();
    await addon.shutdownEndpoint({ endpointHandle: clientEndpoint.endpointHandle });
    await addon.shutdownEndpoint({ endpointHandle: serverEndpoint.endpointHandle });
  });

  it('rejects the stream without any application contact when admission omits the application port', { timeout: 90_000 }, async () => {
    const addon = requireNative();
    echo = await startEchoServer();
    keyDir = await mkdtemp(join(tmpdir(), 'happier-iroh-machine-binding-'));
    const serverEndpoint = await addon.createEndpoint({ keyPath: join(keyDir, 'server.key'), relayPolicy: 'disabled', capProfile: 'machineBulk' });
    const clientEndpoint = await addon.createEndpoint({ keyPath: join(keyDir, 'client.key'), relayPolicy: 'disabled', capProfile: 'machineBulk' });
    // Approved 2xx admission with an exact echo but no application-port
    // selection must reject before any application connection.
    admission = await startAdmissionServer(clientEndpoint.endpointId, null);
    await addon.startMachineAcceptor({
      endpointHandle: serverEndpoint.endpointHandle,
      admissionPort: admission.port,
    });
    const serverStatus = await addon.getEndpointStatus(serverEndpoint.endpointHandle);
    const directAddress = serverStatus?.directAddresses[0];
    if (!directAddress) throw new Error('machine endpoint direct address missing');
    const tunnel = await addon.startMachineTunnel({
      endpointHandle: clientEndpoint.endpointHandle,
      endpointId: serverEndpoint.endpointId,
      directAddresses: [directAddress],
      handshakeJson: JSON.stringify({ v: 1, operationId: 'node-machine-missing-port' }),
    });
    const connectionsBefore = echo.connections.count;
    await new Promise<void>((resolve, reject) => {
      const socket = connect(tunnel.localPort, '127.0.0.1');
      socket.setTimeout(20_000);
      socket.on('connect', () => socket.write('must-not-reach-app'));
      socket.on('data', () => reject(new Error('stream admitted without an application-port selection')));
      socket.on('close', resolve);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('missing-port rejection timed out'));
      });
      // A rejected native stream may surface as either an orderly close or a
      // TCP reset depending on the host network stack. Both are the expected
      // fail-closed outcome; receiving application data is the actual defect.
      socket.on('error', () => resolve());
    });
    expect(echo.connections.count).toBe(connectionsBefore);
    const acceptorStatus = await addon.getMachineAcceptorStatus(serverEndpoint.endpointHandle);
    expect(acceptorStatus?.streamsAccepted).toBe(0);
    expect(acceptorStatus?.streamsRejected).toBe(1);
    await addon.stopMachineTunnel(tunnel.machineTunnelId);
    await addon.stopMachineAcceptor({ endpointHandle: serverEndpoint.endpointHandle });
    await addon.shutdownEndpoint({ endpointHandle: clientEndpoint.endpointHandle });
    await addon.shutdownEndpoint({ endpointHandle: serverEndpoint.endpointHandle });
  });
});
