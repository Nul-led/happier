import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  TerminalStreamReadResponseSchema,
  decodeTerminalStreamBytesFrame,
  type TerminalStreamBytesFrame,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it } from 'vitest';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { createLocalServicesDaemonRuntime } from '@/daemon/local/services/runtime';

import { registerRestrictedRunnerMachineServices } from './registerRestrictedRunnerMachineServices';

const runRealTerminalRpcQa =
  process.env.HAPPIER_TERMINAL_REAL_PTY_RPC_QA === '1' && process.platform !== 'win32';

async function waitForMarker(input: Readonly<{
  read: (params: unknown) => Promise<unknown>;
  terminalId: string;
  marker: string;
}>): Promise<string> {
  const deadline = Date.now() + 10_000;
  let byteOffset = 0;
  let decoded = '';
  while (Date.now() < deadline) {
    const result = TerminalStreamReadResponseSchema.parse(await input.read({
      terminalId: input.terminalId,
      byteOffset,
      maxBytes: 16 * 1024,
      maxFrames: 64,
    }));
    if (!result.ok) throw new Error(`terminal byte stream read failed: ${result.code}`);
    decoded += Buffer.concat(result.frames
      .filter((frame): frame is TerminalStreamBytesFrame => frame.t === 'bytes')
      .map((frame) => Buffer.from(decodeTerminalStreamBytesFrame(frame))))
      .toString('utf8');
    byteOffset = result.nextByteOffset;
    if (decoded.includes(input.marker)) return decoded;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${input.marker}`);
}

describe('restricted Runner terminal real PTY QA', () => {
  it.runIf(runRealTerminalRpcQa)('opens, writes, resizes, reads and closes through the canonical Machine terminal owner', async () => {
    const suiteDirectory = await mkdtemp(join(tmpdir(), 'happier-runner-terminal-real-'));
    const workingDirectory = join(suiteDirectory, 'workspace');
    await mkdir(workingDirectory, { recursive: true });
    const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
    const registrar: RpcHandlerRegistrar = {
      registerHandler: (method, handler) => {
        handlers.set(method, async (params) => await handler(params as never));
      },
    };
    const registration = registerRestrictedRunnerMachineServices({
      rpcHandlerManager: registrar,
      workingDirectory,
      machineId: 'runner-machine-real-pty',
      sessionId: 'runner-session-real-pty',
      runtimeOrigin: 'https://home.example.test',
      runtimeToken: 'runner-token',
      stopSession: async () => ({ status: 'requested' }),
      terminalDeps: {
        env: {
          ...process.env,
          HAPPIER_DAEMON_TERMINAL_ENABLED: '1',
          HAPPIER_DAEMON_TERMINAL_SHELL: '/bin/sh',
        },
        platform: process.platform,
      },
      localServicesRuntime: createLocalServicesDaemonRuntime({
        machineId: 'runner-machine-real-pty',
        inventoryEnabled: () => false,
        startLoop: false,
        inventoryAnnotations: { read: () => null, write: () => undefined },
        scan: async () => ({ listeners: [], processes: new Map(), workspaces: [], diagnostics: [] }),
      }),
      publicPreviewRoutes: {
        getStatus: async () => { throw new Error('not exercised'); },
        createExposure: async () => { throw new Error('not exercised'); },
        revokeExposure: async () => { throw new Error('not exercised'); },
        copyUrl: async () => { throw new Error('not exercised'); },
      },
    });

    let terminalId: string | null = null;
    try {
      const ensured = await handlers.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE)?.({
        terminalKey: `runner-real-${Date.now()}`,
        sessionId: 'runner-session-real-pty',
        cwd: workingDirectory,
        cols: 80,
        rows: 24,
      });
      expect(ensured).toEqual(expect.objectContaining({ ok: true, reused: false }));
      if (!ensured || typeof ensured !== 'object' || !('terminalId' in ensured)) {
        throw new Error('expected terminal id');
      }
      terminalId = String(ensured.terminalId);
      await expect(handlers.get(RPC_METHODS.DAEMON_TERMINAL_RESIZE)?.({
        terminalId,
        cols: 100,
        rows: 32,
      })).resolves.toEqual({ ok: true });
      const marker = `happier-runner-terminal-${Date.now()}`;
      await handlers.get(RPC_METHODS.DAEMON_TERMINAL_STREAM_INPUT)?.({
        terminalId,
        event: { t: 'text', text: `printf '${marker}\\n'` },
      });
      await handlers.get(RPC_METHODS.DAEMON_TERMINAL_STREAM_INPUT)?.({
        terminalId,
        event: { t: 'key', key: 'Enter', modifiers: [] },
      });
      await expect(waitForMarker({
        read: handlers.get(RPC_METHODS.DAEMON_TERMINAL_STREAM_READ_BYTES)!,
        terminalId,
        marker,
      })).resolves.toContain(marker);
    } finally {
      if (terminalId) await handlers.get(RPC_METHODS.DAEMON_TERMINAL_CLOSE)?.({ terminalId });
      await registration.dispose();
      await rm(suiteDirectory, { recursive: true, force: true });
    }
  }, 15_000);
});
