import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveEphemeralRunnerDirectoryChoicePresentation,
  resolveEphemeralRunnerEndpointPresentation,
} from './endpointTerminalUi';
import { createEphemeralRunnerNativeShellStdioTransport } from './nativeShellStdioTransport';

describe('Runner native-shell stdio transport', () => {
  it('correlates strict responses and ignores malformed shell messages', async () => {
    const readable = new PassThrough();
    const writes: string[] = [];
    const transport = createEphemeralRunnerNativeShellStdioTransport({ readable, write: (line) => writes.push(line) });
    const pending = transport.request({
      v: 1,
      type: 'choose_directory',
      chooser: resolveEphemeralRunnerDirectoryChoicePresentation(),
    }, new AbortController().signal);
    const requestId = JSON.parse(writes[0]!).requestId;
    readable.write(`${JSON.stringify({ v: 1, requestId, response: { v: 1, type: 'directory_selected', directory: 42 } })}\n`);
    readable.write(`${JSON.stringify({ v: 1, requestId, response: { v: 1, type: 'directory_selected', directory: '/work' } })}\n`);
    await expect(pending).resolves.toEqual({ v: 1, type: 'directory_selected', directory: '/work' });
  });

  it('publishes only admitted Stop/close events', async () => {
    const readable = new PassThrough();
    const transport = createEphemeralRunnerNativeShellStdioTransport({ readable, write: vi.fn() });
    const listener = vi.fn();
    transport.subscribe(listener);
    readable.write(`${JSON.stringify({ v: 1, event: { v: 1, type: 'grant_account_access' } })}\n`);
    readable.write(`${JSON.stringify({ v: 1, event: { v: 1, type: 'close_requested' } })}\n`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenCalledWith({ v: 1, type: 'close_requested' });
  });

  it('fails every pending decision closed and reports the carrier once when the shell dies', async () => {
    const readable = new PassThrough();
    const writes: string[] = [];
    const transport = createEphemeralRunnerNativeShellStdioTransport({ readable, write: (line) => writes.push(line) });
    const listener = vi.fn();
    transport.subscribe(listener);
    const pending = transport.request({
      v: 1,
      type: 'choose_directory',
      chooser: resolveEphemeralRunnerDirectoryChoicePresentation(),
    }, new AbortController().signal);

    readable.end();

    await expect(pending).rejects.toThrow('runner_native_shell_disconnected');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(listener).toHaveBeenCalledWith({ v: 1, type: 'shell_disconnected' });
    // A dead shell means a broken pipe. Further writes must not raise EPIPE
    // while the endpoint controller is still unwinding the Session.
    const writesAtDisconnect = writes.length;
    transport.publish?.({
      v: 1,
      type: 'presentation',
      presentation: resolveEphemeralRunnerEndpointPresentation({ phase: 'running', connection: 'connected' }),
    });
    await expect(transport.request({
      v: 1,
      type: 'choose_directory',
      chooser: resolveEphemeralRunnerDirectoryChoicePresentation(),
    }, new AbortController().signal))
      .rejects.toThrow('runner_native_shell_disconnected');
    expect(writes.length).toBe(writesAtDisconnect);
  });
});
