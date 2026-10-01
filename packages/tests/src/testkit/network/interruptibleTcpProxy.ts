import { createConnection, createServer, type Socket } from 'node:net';

/** A real network boundary: only clients using this endpoint lose connectivity. */
export async function startInterruptibleTcpProxy(upstreamUrl: string) {
  const upstream = new URL(upstreamUrl);
  const connections = new Set<Socket>();
  let interrupted = false;
  const server = createServer((downstream) => {
    if (interrupted) {
      downstream.destroy();
      return;
    }
    const outgoing = createConnection({ host: upstream.hostname, port: Number(upstream.port) });
    connections.add(downstream);
    connections.add(outgoing);
    const close = () => {
      connections.delete(downstream);
      connections.delete(outgoing);
      downstream.destroy();
      outgoing.destroy();
    };
    downstream.once('error', close);
    outgoing.once('error', close);
    downstream.once('close', close);
    outgoing.once('close', close);
    downstream.pipe(outgoing);
    outgoing.pipe(downstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TCP proxy did not bind a port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    interrupt() {
      interrupted = true;
      for (const connection of connections) connection.destroy();
    },
    resume() { interrupted = false; },
    async close() {
      interrupted = true;
      for (const connection of connections) connection.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
