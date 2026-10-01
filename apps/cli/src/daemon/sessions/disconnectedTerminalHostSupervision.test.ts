import { describe, expect, it, vi } from 'vitest';
import type { TerminalHostAdapter, TerminalHostHandle } from '@happier-dev/agents';
import axios, { AxiosHeaders } from 'axios';

import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { readTerminalHostAttachmentInfo, writeTerminalHostAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { retireExactTerminalControlServiceability } from './retireTerminalControlServiceability';

import {
  resolveDisconnectedTerminalMode,
  resolveDisconnectedTerminalHostResumeGate,
  superviseDisconnectedTerminalHostCandidate,
} from './disconnectedTerminalHostSupervision';

const handle: TerminalHostHandle & { attachmentId: NonNullable<TerminalHostHandle['attachmentId']> } = {
  attachmentId: 'attachment-live-1' as NonNullable<TerminalHostHandle['attachmentId']>,
  kind: 'tmux',
  sessionName: 'happier-live-1',
  paneId: 'claude.1',
  attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared', locality: 'same_machine', liveProbe: 'required' },
};

function adapter(liveness: Awaited<ReturnType<TerminalHostAdapter['evaluateLiveness']>>): TerminalHostAdapter {
  return {
    kind: 'tmux', createOrAttachHost: vi.fn(), injectUserPrompt: vi.fn(), interruptTurn: vi.fn(),
    evaluateLiveness: vi.fn(async () => liveness), dispose: vi.fn(async () => undefined),
  };
}

function attachment() {
  return { version: 2 as const, attachmentId: handle.attachmentId, sessionId: 'session-live-1', handle, updatedAt: 1 };
}

describe('disconnected terminal-host supervision', () => {
  it('derives the terminal mode from exact host identity without duplicating platform rules', () => {
    expect(resolveDisconnectedTerminalMode({
      terminal: undefined,
      hostKind: 'tmux',
      attachmentId: 'attachment-tmux',
    })).toBe('tmux');
    expect(resolveDisconnectedTerminalMode({
      terminal: undefined,
      hostKind: 'herdr',
      attachmentId: 'attachment-herdr',
    })).toBe('herdr');
    expect(resolveDisconnectedTerminalMode({
      terminal: {
        mode: 'windows_terminal',
        controlServiceabilityV1: {
          v: 1,
          attachmentId: 'attachment-windows',
          state: 'servable',
          observedAt: 1,
        },
      },
      hostKind: 'windows_console',
      attachmentId: 'attachment-windows',
    })).toBe('windows_terminal');
    expect(resolveDisconnectedTerminalMode({
      terminal: {
        mode: 'windows_console',
        controlServiceabilityV1: {
          v: 1,
          attachmentId: 'replacement-attachment',
          state: 'servable',
          observedAt: 1,
        },
      },
      hostKind: 'windows_console',
      attachmentId: 'attachment-windows',
    })).toBeNull();
  });

  it('fences an exact preserved host that lacks its attachment-bound control descriptor', async () => {
    const hostAdapter = adapter({ paneAlive: true, observedAt: 1 });
    const result = await superviseDisconnectedTerminalHostCandidate({
      candidate: { sessionId: 'session-live-1', pid: 42, happyHomeDir: '/tmp/happy', attachmentId: handle.attachmentId, handle, controlDescriptorAvailable: false },
      terminalHostAdapters: { tmux: hostAdapter },
      readTerminalAttachmentInfo: async () => attachment(),
      probeSessionServiceability: vi.fn(),
    });
    expect(result).toEqual({ state: 'recoverable_unservable', reason: 'control_descriptor_missing' });
    expect(resolveDisconnectedTerminalHostResumeGate(result)).toEqual({ action: 'fence', reason: 'control_descriptor_missing' });
    expect(hostAdapter.dispose).not.toHaveBeenCalled();
  });

  it('retires only a positively dead exact attachment', async () => {
    const hostAdapter = adapter({ paneAlive: false, paneDead: true, observedAt: 1 });
    const removeAttachment = vi.fn(async (_input: unknown) => true);
    const removeMarker = vi.fn(async (_pid: number) => undefined);
    const events: string[] = [];
    await expect(superviseDisconnectedTerminalHostCandidate({
      candidate: { sessionId: 'session-live-1', pid: 42, happyHomeDir: '/tmp/happy', attachmentId: handle.attachmentId, handle },
      terminalHostAdapters: { tmux: hostAdapter },
      readTerminalAttachmentInfo: async () => attachment(),
      removeTerminalAttachmentInfo: async (input) => {
        events.push('local');
        return await removeAttachment(input);
      },
      removeSessionMarker: async (pid) => {
        events.push('marker');
        await removeMarker(pid);
      },
      retireExactTerminalControlServiceability: async () => {
        events.push('remote');
      },
    })).resolves.toEqual({ state: 'stopped' });
    expect(removeAttachment).toHaveBeenCalled();
    expect(removeMarker).toHaveBeenCalledWith(42);
    expect(events).toEqual(['remote', 'local', 'marker']);
  });

  it('keeps local retry identity when confirmed-dead remote retirement fails', async () => {
    const removeAttachment = vi.fn(async (_input: unknown) => true);
    const removeMarker = vi.fn(async (_pid: number) => undefined);
    await expect(superviseDisconnectedTerminalHostCandidate({
      candidate: { sessionId: 'session-live-1', pid: 42, happyHomeDir: '/tmp/happy', attachmentId: handle.attachmentId, handle },
      terminalHostAdapters: { tmux: adapter({ paneAlive: false, paneDead: true, observedAt: 1 }) },
      readTerminalAttachmentInfo: async () => attachment(),
      removeTerminalAttachmentInfo: removeAttachment,
      removeSessionMarker: removeMarker,
      retireExactTerminalControlServiceability: async () => {
        throw new Error('metadata unavailable');
      },
    })).resolves.toEqual({ state: 'unknown', reason: 'retirement_failed' });
    expect(removeAttachment).not.toHaveBeenCalled();
    expect(removeMarker).not.toHaveBeenCalled();
  });

  it('retires the positively dead old host without changing a newer remote projection', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'dead-host-superseded-' }, async ({ homeDir }) => {
      const sessionId = 'session-live-1';
      await writeTerminalHostAttachmentInfo({
        happyHomeDir: homeDir, sessionId, attachmentId: handle.attachmentId, handle,
        terminal: { mode: 'tmux', tmux: { target: 'happier-live-1:claude.1' } },
      });
      const metadata = JSON.stringify({ path: '/repo', terminal: {
        mode: 'tmux', controlServiceabilityV1: {
          v: 1, attachmentId: 'replacement-attachment', state: 'servable', observedAt: 20,
        },
      } });
      const raw = createSessionRecordFixture({
        id: sessionId, encryptionMode: 'plain', metadataLayoutVersion: 0, metadata,
      });
      const response = { status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
      // Genuine HTTP boundaries; metadata decoding, projection and retirement remain real.
      const get = vi.spyOn(axios, 'get').mockImplementation(async (url) => ({
        ...response,
        data: String(url).includes('/v2/sessions/') ? { session: raw } : {
          mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
        },
      }));
      const patch = vi.spyOn(axios, 'patch').mockRejectedValue(new Error('unexpected_projection_write'));
      try {
        const retire = () => retireExactTerminalControlServiceability({
          credentials: { token: 'test-token', encryption: null },
          sessionId, attachmentId: handle.attachmentId, terminalMode: 'tmux',
        });
        await expect(retire()).resolves.toBe('superseded');
        const hostAdapter = adapter({ paneAlive: false, paneDead: true, observedAt: 1 });
        await expect(superviseDisconnectedTerminalHostCandidate({
          candidate: { sessionId, pid: 42, happyHomeDir: homeDir, attachmentId: handle.attachmentId, handle },
          terminalHostAdapters: { tmux: hostAdapter },
          retireExactTerminalControlServiceability: retire,
        })).resolves.toEqual({ state: 'stopped' });
        expect(await readTerminalHostAttachmentInfo({ happyHomeDir: homeDir, sessionId })).toBeNull();
        expect(hostAdapter.dispose).not.toHaveBeenCalled();
        expect(raw.metadata).toBe(metadata);
        expect(patch).not.toHaveBeenCalled();
      } finally {
        get.mockRestore();
        patch.mockRestore();
      }
    });
  });

  it('fails closed for attachment mismatch and inconclusive liveness', async () => {
    const hostAdapter = adapter({ paneAlive: false, probeInconclusive: true, observedAt: 1 });
    const changed = { ...attachment(), attachmentId: 'changed' as typeof handle.attachmentId };
    await expect(superviseDisconnectedTerminalHostCandidate({
      candidate: { sessionId: 'session-live-1', pid: 42, happyHomeDir: '/tmp/happy', attachmentId: handle.attachmentId, handle },
      terminalHostAdapters: { tmux: hostAdapter },
      readTerminalAttachmentInfo: async () => changed,
    })).resolves.toEqual({ state: 'unknown', reason: 'attachment_changed' });
    await expect(superviseDisconnectedTerminalHostCandidate({
      candidate: { sessionId: 'session-live-1', pid: 42, happyHomeDir: '/tmp/happy', attachmentId: handle.attachmentId, handle },
      terminalHostAdapters: { tmux: hostAdapter },
      readTerminalAttachmentInfo: async () => attachment(),
    })).resolves.toEqual({ state: 'unknown', reason: 'probe_inconclusive' });
  });
});
