import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { requestBytes } from '../dist/http.js';
import { fetchGitHubLatestRelease } from '../dist/github.js';

test('requestBytes aborts the real response transport when the signal fires', async () => {
  await withAbortingServer(async (url, controller) => {
    await assert.rejects(
      requestBytes({ url, signal: controller.signal }),
      { name: 'AbortError' },
    );
  });
});

test('fetchGitHubLatestRelease aborts the real response transport when the signal fires', async () => {
  await withAbortingServer(async (url, controller) => {
    // Only the external service is substituted; fetch and the release owner are real.
    const fetchImpl = (_url, init) => fetch(url, init);
    await assert.rejects(
      fetchGitHubLatestRelease({ githubRepo: 'owner/repo', signal: controller.signal, fetchImpl }),
      { name: 'AbortError' },
    );
  });
});

/**
 * The server writes a partial JSON body, the caller aborts, and only then — after the
 * client has torn the transport down (`res` `close`) — would the delayed end fire.
 * Awaiting `closed` proves the abort reached the real connection instead of a stub.
 */
async function withAbortingServer(run) {
  const controller = new AbortController();
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('[');
    controller.abort();
    const timer = setTimeout(() => res.end(']'), 100);
    res.on('close', () => {
      clearTimeout(timer);
      serverClosedResolve();
    });
  });
  let serverClosedResolve;
  const serverClosed = new Promise((resolve) => { serverClosedResolve = resolve; });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp server address');
    await run(`http://127.0.0.1:${address.port}`, controller);
    await serverClosed;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
