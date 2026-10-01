import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';

import { MessageQueue2 } from '@/agent/runtime/modeMessageQueue';
import { createApiSessionSocketStub, bindApiSessionSocketPairMock } from '@/testkit/backends/apiSessionSocketHarness';
import { createPlainSessionFixture } from '@/testkit/backends/sessionFixtures';
import { createTestApiSessionClient } from '@/testkit/backends/createTestApiSessionClient';
import { createSessionProviderInputConsumer } from './sessionProviderInputConsumer';
import { waitForNextPermissionModeMessage } from '../../waitForNextPermissionModeMessage';
import { createSessionModeOverrideSynchronizer } from '../../sessionModeOverrideSync';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
// Only network transports are replaced; the client, wake and drain owners stay real.
vi.mock('socket.io-client', () => ({ io: mockIo }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const unavailable = async () => { throw new Error('test transport disconnected'); };
  return { ...actual, default: { ...actual.default, get: unavailable, post: unavailable, request: unavailable } };
});

describe('active-turn pending wake recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('delivers idle control metadata through the shared waiter without granting materialization of blocked Pending rows', async () => {
    const testHome = await mkdtemp(join(tmpdir(), 'happier-idle-control-wake-'));
    vi.stubEnv('HAPPIER_HOME_DIR', testHome);
    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();
    const { ApiSessionClient } = await import('@/api/session/sessionClient');
    const sessionSocket = createApiSessionSocketStub();
    const userSocket = createApiSessionSocketStub();
    userSocket.connect.mockImplementation(() => userSocket);
    sessionSocket.connect.mockImplementation(() => sessionSocket);
    bindApiSessionSocketPairMock(mockIo, { sessionSocket, userSocket, fallbackSocket: sessionSocket });
    const session = { ...createPlainSessionFixture({ id: 'idle-control' }), pendingCount: 1, pendingBlockedCount: 1, pendingVersion: 1 };
    const client = createTestApiSessionClient(ApiSessionClient, 'test-token', session);
    const posts = vi.spyOn(axios, 'post');
    const nativeModes: string[] = [];
    const sync = createSessionModeOverrideSynchronizer({
      session: client, isStarted: () => true,
      // The provider/native operation is outside this host input corridor. All metadata and override logic stays real.
      runtime: { async setSessionMode(modeId) { nativeModes.push(modeId); return { status: 'applied', timing: 'current_window' }; } },
    });
    const controller = new AbortController();
    const wait = waitForNextPermissionModeMessage({
      session: client, messageQueue: new MessageQueue2<{ id: string }>(() => 'mode'), abortSignal: controller.signal,
      onMetadataUpdate: async () => { sync.syncFromMetadata(); await sync.flushPendingAfterStart(); },
    });
    const update = (sid: string, version: number) => userSocket.trigger('update', {
      id: `control-${sid}-${version}`, seq: version, createdAt: version,
      body: { t: 'update-session', sid, metadata: { version, value: JSON.stringify({
        ...session.metadata, sessionModeOverrideV1: { v: 1, modeId: 'plan', updatedAt: 2 },
      }) } },
    });
    try {
      await vi.waitFor(() => expect(client.listenerCount('metadata-updated')).toBeGreaterThan(0));
      expect(client.shouldAttemptPendingMaterialization()).toBe(false);
      update('other-session', 2);
      update(session.id, 0);
      await Promise.resolve();
      expect(nativeModes).toEqual([]);
      update(session.id, 2);
      await vi.waitFor(() => expect(nativeModes).toEqual(['plan']));
      expect(client.getPendingQueueState()).toMatchObject({ pendingCount: 1, pendingBlockedCount: 1, pendingVersion: 1 });
      expect(posts.mock.calls.filter(([url]) => String(url).includes('/pending/materialize-next'))).toEqual([]);
      controller.abort();
      await expect(wait).resolves.toBeNull();
    } finally {
      controller.abort(); await wait; await client.close();
      await rm(testHome, { recursive: true, force: true });
      vi.unstubAllEnvs(); reloadConfiguration();
    }
  });

  it.each([
    { phase: 'active', updateTiming: 'after_rearm' },
    { phase: 'active', updateTiming: 'during_backoff' },
    { phase: 'active', updateTiming: 'repeated_disconnect_during_backoff' },
    { phase: 'idle', updateTiming: 'during_backoff' },
  ] as const)('$phase input survives repeated disconnects and resumes on a pending update $updateTiming without polling', async ({ phase, updateTiming }) => {
    const testHome = await mkdtemp(join(tmpdir(), 'happier-pending-wake-'));
    vi.stubEnv('HAPPIER_HOME_DIR', testHome);
    const { reloadConfiguration } = await import('@/configuration');
    reloadConfiguration();
    const { ApiSessionClient } = await import('@/api/session/sessionClient');
    const sessionSocket = createApiSessionSocketStub();
    const userSocket = createApiSessionSocketStub();
    // A disconnected transport remains disconnected until the test supplies a server event.
    userSocket.connect.mockImplementation(() => userSocket);
    sessionSocket.connect.mockImplementation(() => sessionSocket);
    bindApiSessionSocketPairMock(mockIo, { sessionSocket, userSocket, fallbackSocket: sessionSocket });
    const session = {
      ...createPlainSessionFixture({ id: 'pending-wake-session' }),
      pendingCount: 0,
      pendingBlockedCount: 0,
      pendingVersion: 0,
    };
    const client = createTestApiSessionClient(ApiSessionClient, 'test-token', session);
    const materialize = vi.spyOn(client, 'materializeNextPendingMessageSafely');
    const consumer = createSessionProviderInputConsumer({
      messageQueue: new MessageQueue2<{ id: string }>(() => 'mode'),
      session: {
        waitForMetadataUpdate: (signal) => client.waitForMetadataUpdate(signal),
        materializeNextPendingMessageSafely: (options) => client.materializeNextPendingMessageSafely(options),
      },
      reconcileWhenEmpty: 'skip',
    });
    const controller = new AbortController();
    const disconnectListenersBeforePump = userSocket.getHandlers('disconnect').length;
    let finished = false;
    vi.useFakeTimers();
    const pump = (phase === 'active'
      ? consumer.pumpPendingWhileActive({
          abortSignal: controller.signal,
          reason: 'socket-disconnect-recovery',
        })
      : consumer.waitForNextInput({ abortSignal: controller.signal })
    ).then(() => { finished = true; });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(materialize).toHaveBeenCalledTimes(1);
      for (let disconnect = 0; disconnect < 2; disconnect += 1) {
        userSocket.trigger('disconnect', 'transport close');
        await vi.advanceTimersByTimeAsync(250);
      }
      expect(finished).toBe(false);
      expect(materialize).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(materialize).toHaveBeenCalledTimes(1);

      if (updateTiming !== 'after_rearm') {
        userSocket.trigger('disconnect', 'transport close');
        await vi.advanceTimersByTimeAsync(0);
      }
      if (updateTiming === 'repeated_disconnect_during_backoff') {
        userSocket.trigger('disconnect', 'transport close');
        await vi.advanceTimersByTimeAsync(0);
      }
      userSocket.trigger('update', {
        id: 'pending-wake-update', seq: 1, createdAt: 1,
        body: { t: 'pending-changed', sid: session.id, pendingCount: 0, pendingBlockedCount: 0, pendingVersion: 1 },
      });
      await vi.advanceTimersByTimeAsync(updateTiming === 'after_rearm' ? 0 : 250);
      expect(materialize).toHaveBeenCalledTimes(2);
      expect(finished).toBe(false);
      userSocket.trigger('disconnect', 'transport close');
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await pump;
      expect(userSocket.getHandlers('disconnect')).toHaveLength(disconnectListenersBeforePump);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(materialize).toHaveBeenCalledTimes(2);
    } finally {
      controller.abort();
      await pump;
      vi.useRealTimers();
      const metadataListenersBeforeClose = client.listenerCount('metadata-updated');
      const closingMetadataWait = client.waitForMetadataUpdate();
      await client.close();
      await expect(closingMetadataWait).resolves.toBe(false);
      await expect(client.waitForMetadataUpdate()).resolves.toBe(false);
      expect(client.listenerCount('metadata-updated')).toBe(metadataListenersBeforeClose);
      await rm(testHome, { recursive: true, force: true });
      vi.unstubAllEnvs();
      reloadConfiguration();
    }
    expect(finished).toBe(true);
  }, 90_000);
});
