import { createServer } from 'node:http';
import { expect, it } from 'vitest';

import { startInterruptibleTcpProxy } from './interruptibleTcpProxy';

it('interrupts the viewer endpoint while the publisher remains reachable, then resumes forwarding', async () => {
  const upstream = createServer((_request, response) => response.end('real upstream'));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Upstream did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const proxy = await startInterruptibleTcpProxy(baseUrl);
  try {
    expect(await (await fetch(proxy.baseUrl)).text()).toBe('real upstream');
    proxy.interrupt();
    await expect(fetch(proxy.baseUrl)).rejects.toThrow();
    expect(await (await fetch(baseUrl)).text()).toBe('real upstream');
    proxy.resume();
    expect(await (await fetch(proxy.baseUrl)).text()).toBe('real upstream');
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
});
