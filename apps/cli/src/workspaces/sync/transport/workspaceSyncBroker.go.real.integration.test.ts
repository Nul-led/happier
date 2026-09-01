import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createDaemonWorkspaceSyncBroker } from '@/daemon/startup/createDaemonWorkspaceSyncBroker';
import { deriveWorkspaceSyncEndpointId } from './workspaceSyncBrokerProtocol';

const probePath = process.env.HAPPIER_MUTAGEN_BROKER_CLIENT_TEST_BIN;

describe('real Go client to TypeScript workspace-sync broker correlation', { timeout: 30_000 }, () => {
  it('keeps control usable when DATA_READY is followed by a rejected data attachment', async () => {
    if (!probePath) {
      throw new Error(
        'real broker correlation requires HAPPIER_MUTAGEN_BROKER_CLIENT_TEST_BIN '
        + 'built from happier-mutagen/pkg/externalbroker/integrationclient',
      );
    }
    const root = await mkdtemp(join(tmpdir(), 'hws-go-broker-'));
    let resolveRejectedDataPeer!: () => void;
    const rejectedDataPeer = new Promise<void>((resolveRejected) => { resolveRejectedDataPeer = resolveRejected; });
    const broker = await createDaemonWorkspaceSyncBroker({
      brokerDir: root,
      brokerInstanceId: randomUUID(),
      launchNonce: randomUUID(),
      launchSecret: randomBytes(32),
      openExternalStream: async () => new PassThrough(),
      peerIdentityValidator: {
        setExpectedSidecarPid: () => undefined,
        validate: async ({ kind }) => {
          if (kind === 'data') {
            resolveRejectedDataPeer();
            return false;
          }
          return true;
        },
      },
    });
    const child = spawn(resolve(probePath), [deriveWorkspaceSyncEndpointId('real-go-correlation', 'alpha')], {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    });
    const exit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    const stderr: Buffer[] = [];
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    const descriptor = child.stdio[3];
    if (!(descriptor instanceof Writable) || child.pid === undefined) {
      child.kill();
      await broker.close();
      await rm(root, { recursive: true, force: true });
      throw new Error('real Go broker probe did not expose pid and inherited descriptor fd 3');
    }

    try {
      descriptor.end(broker.bootstrapDescriptor);
      await broker.waitForReady(child.pid);
      await rejectedDataPeer;
      await expect(broker.command({ t: 'list', requestId: 'after-attach-failure' })).resolves.toEqual({
        controlSurvived: true,
      });
      await expect(exit, Buffer.concat(stderr).toString('utf8')).resolves.toEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await broker.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
