import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createDaemonWorkspaceSyncBroker } from './createDaemonWorkspaceSyncBroker';

function fixture(sidecarPid = 42) {
  const command = vi.fn(async () => ({ ok: true }));
  const close = vi.fn(async () => undefined);
  const broker = {
    socketPath: '/private/broker/control.sock',
    brokerInstanceId: 'broker-instance',
    launchNonce: 'launch-nonce',
    authenticatedSidecarPid: sidecarPid,
    whenReady: Promise.resolve(),
    command,
    close,
  };
  const listenBroker = vi.fn(async () => broker);
  return { broker, command, close, listenBroker };
}

describe('createDaemonWorkspaceSyncBroker', () => {
  it('creates the private broker and encodes the complete bootstrap descriptor only in inherited bytes', async () => {
    const harness = fixture();
    const launchSecret = new Uint8Array(32).fill(0xfb);
    const openExternalStream = vi.fn(async () => new PassThrough());
    const peerIdentityValidator = {
      setExpectedSidecarPid: vi.fn(),
      validate: vi.fn(async () => true),
    };

    const result = await createDaemonWorkspaceSyncBroker({
      brokerDir: '/private/broker',
      brokerInstanceId: 'broker-instance',
      launchNonce: 'launch-nonce',
      launchSecret,
      openExternalStream,
      peerIdentityValidator,
      listenBroker: harness.listenBroker,
    });

    expect(harness.listenBroker).toHaveBeenCalledWith({
      socketPath: join('/private/broker', 'control.sock'),
      brokerInstanceId: 'broker-instance',
      launchNonce: 'launch-nonce',
      launchSecret,
      openExternalStream,
      validatePeerIdentity: peerIdentityValidator.validate,
    });
    expect(JSON.parse(Buffer.from(result.bootstrapDescriptor).toString('utf8'))).toEqual({
      protocol: 1,
      brokerEndpoint: '/private/broker/control.sock',
      brokerInstanceId: 'broker-instance',
      launchNonce: 'launch-nonce',
      secret: Buffer.from(launchSecret).toString('base64url'),
    });
  });

  it('binds readiness to the spawned sidecar pid and forwards commands with cancellation', async () => {
    const harness = fixture(42);
    const result = await createDaemonWorkspaceSyncBroker({
      brokerDir: '/private/broker',
      brokerInstanceId: 'broker-instance',
      launchNonce: 'launch-nonce',
      launchSecret: new Uint8Array(32).fill(7),
      openExternalStream: async () => new PassThrough(),
      peerIdentityValidator: { setExpectedSidecarPid: vi.fn(), validate: async () => true },
      listenBroker: harness.listenBroker,
    });
    const abort = new AbortController();

    result.setExpectedSidecarPid?.(42);
    await expect(result.waitForReady(42)).resolves.toBeUndefined();
    await expect(result.command({ t: 'list', requestId: 'request-1' }, abort.signal)).resolves.toEqual({ ok: true });
    expect(harness.command).toHaveBeenCalledWith(
      { t: 'list', requestId: 'request-1' },
      { signal: abort.signal },
    );
  });

  it('fails closed and closes the broker when the authenticated pid differs from the spawned sidecar', async () => {
    const harness = fixture(99);
    const result = await createDaemonWorkspaceSyncBroker({
      brokerDir: '/private/broker',
      brokerInstanceId: 'broker-instance',
      launchNonce: 'launch-nonce',
      launchSecret: new Uint8Array(32).fill(7),
      openExternalStream: async () => new PassThrough(),
      peerIdentityValidator: { setExpectedSidecarPid: vi.fn(), validate: async () => true },
      listenBroker: harness.listenBroker,
    });

    await expect(result.waitForReady(42)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(harness.close).toHaveBeenCalledTimes(1);
  });
});
