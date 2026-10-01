import { describe, expect, it, vi } from 'vitest';
import { handleSessionStateUpdate } from './sessionStateUpdateHandling';

describe('handleSessionStateUpdate', () => {
  it('hydrates additive flat Herdr metadata from the socket without retaining wire selectors or dropping opaque fields', () => {
    const result = handleSessionStateUpdate({
      update: { id: 'u-herdr', seq: 1, createdAt: 1, body: { t: 'update-session', id: 's1', metadata: { version: 1, value: JSON.stringify({
        path: '/repo', host: 'machine', providerExtension: { retained: true },
        terminal: { mode: 'plain', hostKind: 'herdr', requested: 'plain', requestedHostKind: 'herdr', herdr: { sessionName: 'work', socketPath: '/tmp/herdr.sock', terminalId: 'term_1' } },
      }) } } },
      updateSource: 'session-scoped', sessionId: 's1', mode: 'plain', ctx: null,
      metadata: null, metadataVersion: 0, agentState: null, agentStateVersion: 0, pendingWakeSeq: 0,
      onMetadataUpdated: () => {}, onWarning: () => {},
    });
    expect(result.metadata).toMatchObject({ terminal: { mode: 'herdr', requested: 'herdr' }, providerExtension: { retained: true } });
    expect(result.metadata?.terminal).not.toHaveProperty('hostKind');
  });

  it('invalidates instead of applying a shared-only layout-1 socket update to the owner view', () => {
    const onMetadataEnvelopeTupleInvalidated = vi.fn();
    const previousMetadata = {
      path: '/private-owner-path',
      host: 'h1',
      flavor: 'claude',
    } as any;

    const result = handleSessionStateUpdate({
      update: {
        id: 'u-layout-one',
        seq: 2,
        createdAt: Date.now(),
        body: {
          t: 'update-session',
          sid: 's1',
          metadata: {
            version: 2,
            value: JSON.stringify({ path: '', host: '', flavor: 'claude' }),
          },
        },
      } as any,
      updateSource: 'session-scoped',
      sessionId: 's1',
      metadataLayoutVersion: 1,
      mode: 'plain',
      metadata: previousMetadata,
      metadataVersion: 1,
      agentState: { controlledByUser: true },
      agentStateVersion: 1,
      pendingWakeSeq: 0,
      ctx: null,
      onMetadataUpdated: vi.fn(),
      onMetadataEnvelopeTupleInvalidated,
      onWarning: vi.fn(),
    });

    expect(result.handled).toBe(true);
    expect(result.metadata).toBe(previousMetadata);
    expect(result.metadataVersion).toBe(1);
    expect(result.agentState).toEqual({ controlledByUser: true });
    expect(result.agentStateVersion).toBe(1);
    expect(onMetadataEnvelopeTupleInvalidated).toHaveBeenCalledTimes(1);
  });

  it('does not refetch the owner tuple for an equal-version layout-1 self echo', () => {
    const onMetadataEnvelopeTupleInvalidated = vi.fn();
    const result = handleSessionStateUpdate({
      update: {
        id: 'u-equal', seq: 3, createdAt: 1,
        body: {
          t: 'update-session', sid: 's1',
          metadata: { version: 3, value: '{}'},
          agentState: { version: 4, value: '{}'},
          ownerMetadata: { ownerMetadata: { value: 'opaque-owner-envelope' } },
        },
      } as any,
      updateSource: 'session-scoped',
      sessionId: 's1',
      metadataLayoutVersion: 1,
      mode: 'plain',
      metadata: {
        path: '/owner',
        host: 'h1',
        flavor: 'claude',
        homeDir: '/home/owner',
        happyHomeDir: '/home/owner/.happier',
        happyLibDir: '/home/owner/.happier/lib',
        happyToolsDir: '/home/owner/.happier/tools',
      },
      metadataVersion: 3,
      agentState: { controlledByUser: true },
      agentStateVersion: 4,
      pendingWakeSeq: 0,
      ctx: null,
      onMetadataUpdated: vi.fn(),
      onMetadataEnvelopeTupleInvalidated,
      onWarning: vi.fn(),
    });

    expect(result.handled).toBe(true);
    expect(onMetadataEnvelopeTupleInvalidated).not.toHaveBeenCalled();
  });

  it('parses plaintext metadata updates when sessionEncryptionMode=plain', () => {
    const onWarning = vi.fn();
    const onMetadataUpdated = vi.fn();

    const result = handleSessionStateUpdate({
      update: {
        id: 'u1',
        seq: 1,
        createdAt: Date.now(),
        body: {
          t: 'update-session',
          sid: 's1',
          metadata: {
            version: 1,
            value: JSON.stringify({ path: '/tmp', host: 'h1', flavor: 'claude' }),
          },
        },
      } as any,
      updateSource: 'session-scoped',
      sessionId: 's1',
      mode: 'plain',
      metadata: null,
      metadataVersion: 0,
      agentState: null,
      agentStateVersion: 0,
      pendingWakeSeq: 0,
      ctx: null,
      onMetadataUpdated,
      onWarning,
    });

    expect(result.handled).toBe(true);
    expect(result.metadata?.path).toBe('/tmp');
    expect(onMetadataUpdated).toHaveBeenCalledTimes(1);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('ignores user-scoped update-machine broadcasts without warning', () => {
    const onWarning = vi.fn();

    const result = handleSessionStateUpdate({
      update: { id: 'u1', seq: 1, createdAt: Date.now(), body: { t: 'update-machine', machineId: 'm1' } } as any,
      updateSource: 'user-scoped',
      sessionId: 's1',
      mode: 'e2ee',
      metadata: null,
      metadataVersion: 0,
      agentState: null,
      agentStateVersion: 0,
      pendingWakeSeq: 0,
      ctx: { encryptionKey: new Uint8Array(), encryptionVariant: 'dataKey' },
      onMetadataUpdated: () => {},
      onWarning,
    });

    expect(result.handled).toBe(true);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('warns when session-scoped socket receives update-machine', () => {
    const onWarning = vi.fn();

    const result = handleSessionStateUpdate({
      update: { id: 'u1', seq: 1, createdAt: Date.now(), body: { t: 'update-machine', machineId: 'm1' } } as any,
      updateSource: 'session-scoped',
      sessionId: 's1',
      mode: 'e2ee',
      metadata: null,
      metadataVersion: 0,
      agentState: null,
      agentStateVersion: 0,
      pendingWakeSeq: 0,
      ctx: { encryptionKey: new Uint8Array(), encryptionVariant: 'dataKey' },
      onMetadataUpdated: () => {},
      onWarning,
    });

    expect(result.handled).toBe(true);
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it('returns pending queue state from pending-changed updates', () => {
    const onMetadataUpdated = vi.fn();
    const onPendingChangedDrainTrigger = vi.fn();

    const result = handleSessionStateUpdate({
      update: {
        id: 'u-pending',
        seq: 7,
        createdAt: Date.now(),
        body: { t: 'pending-changed', sid: 's1', pendingCount: 0, pendingVersion: 12 },
      } as any,
      updateSource: 'user-scoped',
      sessionId: 's1',
      mode: 'e2ee',
      metadata: null,
      metadataVersion: 0,
      agentState: null,
      agentStateVersion: 0,
      pendingWakeSeq: 3,
      ctx: { encryptionKey: new Uint8Array(), encryptionVariant: 'dataKey' },
      onMetadataUpdated,
      onPendingChangedDrainTrigger,
      onWarning: () => {},
    });

    expect(result.handled).toBe(true);
    expect(result.pendingWakeSeq).toBe(4);
    expect(result.pendingQueueState).toEqual({
      known: true,
      pendingCount: 0,
      pendingBlockedCount: 0,
      pendingVersion: 12,
    });
    expect(onMetadataUpdated).toHaveBeenCalledTimes(1);
    expect(onPendingChangedDrainTrigger).toHaveBeenCalledWith({
      known: true,
      pendingCount: 0,
      pendingBlockedCount: 0,
      pendingVersion: 12,
    });
  });

  it('does not advance metadataVersion when an encrypted metadata update cannot be decrypted', () => {
    const onWarning = vi.fn();
    const onMetadataUpdated = vi.fn();
    const previousMetadata = { path: '/tmp/original', host: 'h1', flavor: 'claude' } as any;

    const result = handleSessionStateUpdate({
      update: {
        id: 'u1',
        seq: 1,
        createdAt: Date.now(),
        body: {
          t: 'update-session',
          sid: 's1',
          metadata: {
            version: 5,
            value: 'not-valid-base64-ciphertext',
          },
        },
      } as any,
      updateSource: 'session-scoped',
      sessionId: 's1',
      mode: 'e2ee',
      metadata: previousMetadata,
      metadataVersion: 4,
      agentState: null,
      agentStateVersion: 0,
      pendingWakeSeq: 0,
      ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy' },
      onMetadataUpdated,
      onWarning,
    });

    expect(result.handled).toBe(true);
    expect(result.metadata).toBe(previousMetadata);
    expect(result.metadataVersion).toBe(4);
    expect(onMetadataUpdated).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
  });
});
