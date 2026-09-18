import test from 'node:test';
import assert from 'node:assert/strict';

import { runForegroundChild } from './foreground_child.mjs';

test('foreground child forwarding keeps the wrapper alive until delegated cleanup closes', async () => {
  let signalHandler;
  let closeChild;
  const kills = [];
  const child = {
    once(event, listener) {
      if (event === 'close') closeChild = listener;
      return this;
    },
    kill(signal) {
      kills.push(signal);
    },
  };

  const running = runForegroundChild({
    command: '/usr/bin/node',
    args: ['child.mjs'],
    options: { stdio: 'inherit' },
    boundary: {
      spawn() { return child; },
      onSignal(handler) {
        signalHandler = handler;
        return () => {};
      },
    },
  });

  signalHandler('SIGINT');
  assert.deepEqual(kills, ['SIGINT']);

  let settled = false;
  void running.then(() => { settled = true; });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(settled, false, 'the wrapper must wait for descendant cleanup instead of exiting on the signal');

  closeChild(null, 'SIGINT');
  assert.deepEqual(await running, { exitCode: null, signal: 'SIGINT' });
});
