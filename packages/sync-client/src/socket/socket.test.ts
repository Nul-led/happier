import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { afterEach, describe, expect, it } from 'vitest';
import { createHappierSocket } from './createHappierSocket.js';

let http: HttpServer;
let server: Server;
const disposers: Array<() => Promise<void>> = [];
async function start() {
  http = createServer();
  server = new Server(http, { path: '/v1/updates/' });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No bound address');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('shared Socket.IO transport', () => {
  it.each([
    { clientType: 'user-scoped' as const },
    { clientType: 'session-scoped' as const, sessionId: 's' },
    { clientType: 'session-scoped' as const, sessionId: 's', machineId: 'm' },
    { clientType: 'machine-scoped' as const, machineId: 'm' },
  ])('connects with exact role auth $clientType', async (role) => {
    const endpoint = await start();
    const auth = new Promise<Record<string, unknown>>((resolve) => server.once('connection', (s) => resolve(s.handshake.auth)));
    const { socket, transport } = createHappierSocket({ endpoint, token: 'test', ...role, clientPurpose: 'test', connectTimeoutMs: 1000 });
    disposers.push(() => transport.destroy());
    await transport.connect();
    expect(await auth).toEqual({ token: 'test', ...role, clientPurpose: 'test' });
    expect(socket.connected).toBe(true);
    const disconnected = new Promise<unknown>((resolve) => transport.onDisconnected(resolve));
    await transport.disconnect({ intentional: true });
    expect(await disconnected).toMatchObject({ intentional: true });
  });
  it('routes pre-connect errors to the connection attempt only', async () => {
    const endpoint = await start();
    server.use((_socket, next) => next(new Error('refused')));
    const { transport } = createHappierSocket({ endpoint, token: 'test', clientType: 'user-scoped', connectTimeoutMs: 1000 });
    disposers.push(() => transport.destroy());
    const errors: unknown[] = [];
    transport.onError((error) => errors.push(error));
    await expect(transport.connect()).rejects.toThrow('refused');
    expect(errors).toEqual([]);
  });
  it('uses the caller connection deadline', async () => {
    const endpoint = await start();
    server.use(() => {});
    const { transport } = createHappierSocket({ endpoint, token: 'test', clientType: 'user-scoped', connectTimeoutMs: 20 });
    disposers.push(() => transport.destroy());
    await expect(transport.connect()).rejects.toMatchObject({ code: 'socket_connect_timeout' });
  });
  it('forwards connected errors, resets intentional disconnect, and destroys all listeners', async () => {
    const endpoint = await start();
    const { socket, transport } = createHappierSocket({ endpoint, token: 'test', clientType: 'user-scoped' });
    disposers.push(() => transport.destroy());
    expect(socket.io.timeout()).toBe(false);
    await transport.connect();
    const error = new Promise<unknown>((resolve) => transport.onError(resolve));
    server.sockets.sockets.forEach((remote) => remote.emit('error', { code: 'remote_error' }));
    expect(await error).toEqual({ code: 'remote_error' });
    await transport.disconnect({ intentional: true });
    await transport.disconnect({ intentional: true });
    await transport.connect();
    const disconnected = new Promise<unknown>((resolve) => transport.onDisconnected(resolve));
    server.sockets.sockets.forEach((remote) => remote.disconnect(true));
    expect(await disconnected).toMatchObject({ intentional: false });
    await transport.connect();
    let destroyedNotifications = 0;
    transport.onDisconnected(() => { destroyedNotifications++; });
    socket.onAny(() => {});
    await transport.destroy();
    expect(socket.connected).toBe(false);
    expect(socket.listenersAny()).toEqual([]);
    expect(socket.listeners('connect')).toEqual([]);
    expect(destroyedNotifications).toBe(0);
    await expect(transport.connect()).rejects.toMatchObject({ code: 'socket_destroyed' });
  });
});
