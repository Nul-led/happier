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

  it('carries the endpoint optional access answers with Allow and rejects a malformed set', async () => {
    const readable = new PassThrough();
    const writes: string[] = [];
    const transport = createEphemeralRunnerNativeShellStdioTransport({ readable, write: (line) => writes.push(line) });
    const pending = transport.request({ v: 1, type: 'review', review: {} as never }, new AbortController().signal);
    const requestId = JSON.parse(writes[0]!).requestId;
    readable.write(`${JSON.stringify({ v: 1, requestId, response: { v: 1, type: 'consent_decision', decision: 'allow',
      optionalSelections: [{ accessId: 'clipboard.write', selected: 'yes' }] } })}\n`);
    readable.write(`${JSON.stringify({ v: 1, requestId, response: { v: 1, type: 'consent_decision', decision: 'allow',
      optionalSelections: [{ accessId: 'clipboard.write', selected: true }] } })}\n`);
    await expect(pending).resolves.toEqual({ v: 1, type: 'consent_decision', decision: 'allow',
      optionalSelections: [{ accessId: 'clipboard.write', selected: true }] });
  });

  it('carries a registry token only with Sign in and rejects an empty one', async () => {
    const readable = new PassThrough();
    const writes: string[] = [];
    const transport = createEphemeralRunnerNativeShellStdioTransport({ readable, write: (line) => writes.push(line) });
    const pending = transport.request({ v: 1, type: 'registry_profile', registry: {} as never }, new AbortController().signal);
    const requestId = JSON.parse(writes[0]!).requestId;
    readable.write(`${JSON.stringify({ v: 1, requestId, response: { v: 1, type: 'registry_profile_decision', decision: 'sign_in', token: '  ' } })}\n`);
    readable.write(`${JSON.stringify({ v: 1, requestId, response: { v: 1, type: 'registry_profile_decision', decision: 'sign_in', token: 'endpoint-token' } })}\n`);
    await expect(pending).resolves.toEqual({ v: 1, type: 'registry_profile_decision', decision: 'sign_in', token: 'endpoint-token' });
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

  it('releases the stdin reader on disposal so a terminal outcome can end the process', async () => {
    const readable = new PassThrough();
    const transport = createEphemeralRunnerNativeShellStdioTransport({ readable, write: vi.fn() });
    // A live readline interface keeps the runtime alive on a held stdin, so the
    // carrier must be releasable by the lifecycle that owns it.
    expect(readable.listenerCount('data') + readable.listenerCount('readable')).toBeGreaterThan(0);

    const dispose = transport.dispose;
    if (!dispose) throw new Error('Expected a disposable stdio transport');
    dispose();

    await vi.waitFor(() => {
      expect(readable.listenerCount('data') + readable.listenerCount('readable')).toBe(0);
    });
    // Disposal is the same terminal state a dead shell produces, and repeating it
    // must stay harmless.
    await expect(transport.request({
      v: 1,
      type: 'choose_directory',
      chooser: resolveEphemeralRunnerDirectoryChoicePresentation(),
    }, new AbortController().signal)).rejects.toThrow('runner_native_shell_disconnected');
    expect(() => dispose()).not.toThrow();
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
