import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { withTempDir } from '@/testkit/fs/tempDir';

type ApiFault = 'error' | 'disconnect' | 'timeout';

/** The real client talks to this external Herdr socket boundary. No Happier logic is replaced. */
export async function withHerdrApi<T>(run: (api: Readonly<{
  socketPath: string;
  faults: Map<string, ApiFault>;
  panes: Set<string>;
  tabs: Set<string>;
  requests: Array<{ method: string; params: Record<string, unknown> }>;
  beforeResponse: Map<string, () => void>;
  setEmpty(): void;
  setServerVersion(version: string): void;
}>) => Promise<T>): Promise<T> {
  return await withTempDir('herdr-api-', async (directory) => {
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\happier-herdr-test-${randomUUID()}`
      : join(directory, 'api.sock');
    const faults = new Map<string, ApiFault>();
    const panes = new Set<string>();
    const tabs = new Set<string>();
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const beforeResponse = new Map<string, () => void>();
    const sockets = new Set<Socket>();
    let empty = false;
    let serverVersion = '0.9.2';
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      let buffer = '';
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const request = JSON.parse(buffer.slice(0, newline)) as {
          id: string; method: string; params: Record<string, unknown>;
        };
        requests.push({ method: request.method, params: request.params });
        beforeResponse.get(request.method)?.();
        const fault = faults.get(request.method);
        let result: Record<string, unknown> = {};
        if (fault !== 'error') {
          switch (request.method) {
            case 'session.snapshot':
              result = { snapshot: { version: serverVersion, workspaces: empty ? [] : [{ workspace_id: 'w1', focused: true }] } };
              break;
            case 'workspace.create':
              tabs.add('bootstrap');
              result = { workspace: { workspace_id: 'w1', active_tab_id: 'bootstrap' }, tab: { tab_id: 'bootstrap' } };
              break;
            case 'layout.apply':
              panes.add('managed');
              tabs.add('managed-tab');
              result = { layout: { focused_pane_id: 'managed' } };
              break;
            case 'pane.get':
              result = { pane: { pane_id: 'managed', terminal_id: 'terminal_1', workspace_id: 'w1', tab_id: 'managed-tab' } };
              break;
            case 'pane.list':
              result = { panes: [...panes].map((paneId) => ({
                pane_id: paneId, terminal_id: paneId === 'managed' ? 'terminal_1' : paneId,
                workspace_id: 'w1', tab_id: 'managed-tab',
              })) };
              break;
            case 'pane.close':
              panes.delete(String(request.params.pane_id));
              tabs.delete('managed-tab');
              break;
            case 'tab.close':
              tabs.delete(String(request.params.tab_id));
              break;
          }
        }
        if (fault === 'timeout') return;
        if (fault === 'disconnect') {
          socket.end();
          return;
        }
        socket.end(`${JSON.stringify(fault === 'error'
          ? { id: request.id, error: { code: `${request.method}_failed` } }
          : { id: request.id, result })}\n`);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      return await run({ socketPath, faults, panes, tabs, requests, beforeResponse, setEmpty: () => { empty = true; }, setServerVersion: (version) => { serverVersion = version; } });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}
