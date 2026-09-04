#!/usr/bin/env node
// Lane 06 A7.1/I10 plus the dormant A7.3 incremental foundation — LIVE gate.
//
// Real Chromium → the one local test relay (plain HTTP, consumed as `ws://`)
// → the existing real Home acceptors → loopback HTTP application servers.
//
// The relay and the Home endpoints/acceptors are the production owners: the
// relay is `happier_iroh_core::LocalTestRelay` driven through the existing
// native test-controller SPI (`forceRelayOnly`), and the acceptors are the
// ordinary `startHomeAcceptor` lifecycle operation on the ordinary addon. The
// only fixture parts are the loopback HTTP responders standing in for Homes'
// HTTP servers, the static page that hosts the wasm probe, and one loopback
// HTTP server that is deliberately not a relay (the "decoy") used to prove that
// a cold dial uses only its own target's relay facts.
//
// Cancellation is proven against two genuinely pending shapes: a dial that can
// never complete, and a request a real Home acceptor has really delivered while
// its application withholds the response. Release is proven for both the
// explicit `close` and the implicit one — wasm-bindgen's generated `free` while
// an operation's Promise still holds the Rust probe.
//
// The test addon is rebuilt from current source by the one addon build owner
// before it is loaded, so a stale artifact cannot false-pass a native or shared
// core change.
//
// This activates NO production web routing: nothing here touches `serverFetch`,
// Socket.IO, QR, Account Service, transfer, or transport selection.
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { readFileSync } from 'node:fs';

import {
  attemptAddon,
  bail,
  buildAndLoadBrowserIrohTestAddon,
  callAddon,
  createBrowserIrohNativeHomeFixture,
  listen,
  waitFor,
} from './browserIrohNativeHomeFixture.mjs';
import { buildBrowserIrohWasm } from './verify-browser-iroh-wasm.mjs';

const HOME_A_MARKER = 'happier-browser-iroh-home-a-ok';
const HOME_B_MARKER = 'happier-browser-iroh-home-b-ok';
const MACHINE_MARKER = 'happier-browser-iroh-machine-ok';
const PROBE_PATH = '/__browser-iroh-probe';
const MACHINE_PROBE_PATH = '/__browser-iroh-machine-probe';
/** Requests on this path are received by a real Home and left unanswered. */
const HOLD_PATH = '/hold';
/** Bound for one browser open that must NOT complete (wrong relay, held response). */
const MUST_NOT_COMPLETE_MS = 8_000;
/** Deterministic browser identity: A7.2 forbids minting one per load. */
const BROWSER_SEED = Array.from({ length: 32 }, (_, index) => (index * 7 + 11) % 251);
/**
 * A second deterministic identity for the implicit-release check, which runs
 * only after the first probe has been terminally closed. It is a sequential
 * second endpoint lifetime, never a second concurrent endpoint, and a distinct
 * seed keeps the relay from confusing it with the closed endpoint's own
 * registration.
 */
const FREED_BROWSER_SEED = Array.from({ length: 32 }, (_, index) => (index * 13 + 29) % 251);
/** Bound for one native inbound handshake attempt against the browser endpoint. */
const NATIVE_DIAL_TIMEOUT_MS = 20_000;

/**
 * A loopback application server standing in for one Home's HTTP server.
 *
 * It speaks the two lines of HTTP this gate needs over a raw socket rather than
 * through `node:http`, because Node's HTTP server ends the connection as soon as
 * the client half-closes. The browser probe is a bounded request/response
 * surface: it always half-closes its send side, so a `node:http` responder can
 * never genuinely hold a response open, and the acceptor would report an empty
 * answer instead of a pending one.
 *
 * A request to `HOLD_PATH` is received in full and then deliberately left
 * unanswered, so a browser open can be cancelled while a real Home acceptor has
 * really delivered the request and the Home is really holding the response.
 * Releasing it afterwards proves the cancelled operation does not complete late.
 */
function startHomeApplication(marker) {
  const state = { requests: 0, writeSideEnds: 0, held: [] };
  const answer = (socket, body) => {
    socket.write(
      `HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
    );
    socket.end();
  };
  // `allowHalfOpen` keeps the response side writable after the acceptor
  // forwards the browser's half-close.
  state.server = createTcpServer({ allowHalfOpen: true }, (socket) => {
    let buffered = '';
    let answered = false;
    socket.on('error', () => socket.destroy());
    socket.on('end', () => {
      state.writeSideEnds += 1;
    });
    socket.on('data', (chunk) => {
      if (answered) return;
      buffered += chunk.toString('latin1');
      if (!buffered.includes('\r\n\r\n')) return;
      answered = true;
      state.requests += 1;
      const [method, url] = buffered.slice(0, buffered.indexOf('\r\n')).split(' ');
      const body = `${marker} ${method} ${url}`;
      if (String(url).includes(HOLD_PATH)) {
        state.held.push({ socket, body });
        return;
      }
      answer(socket, body);
    });
  });
  state.releaseHeld = () => {
    const held = state.held.splice(0);
    for (const { socket, body } of held) {
      // The browser cancelled: the acceptor's loopback socket may already be
      // gone, which is not a failure of this write.
      try {
        answer(socket, body);
      } catch {
        socket.destroy();
      }
    }
    return held.length;
  };
  return state;
}

/**
 * A loopback admission responder standing in for the daemon's machine-admission
 * owner (`MACHINE_ADMISSION_PATH` in `happier-iroh-core/src/machine.rs`).
 *
 * The real owner verifies the signed V2 grant carried by the handshake; that
 * decision belongs to the daemon and is product state this transport gate does
 * not have. What this fixture stands in for is only the local HTTP contract the
 * acceptor speaks: echo the authenticated remote EndpointId, and name the
 * application loopback port. Everything the gate actually proves — the ALPN
 * reaching a real `MachineAcceptor`, the canonical frame being parsed, the
 * accept byte, and the post-admission duplex — is the production acceptor's.
 *
 * No application-capability header is returned, so the acceptor writes no
 * capability prefix and the application server sees the browser's bytes alone.
 */
function startMachineAdmission({ applicationPort }) {
  // Header names owned by `happier-iroh-core::machine`; this fixture speaks its
  // contract from the outside, exactly as a daemon would.
  const REMOTE_ENDPOINT_HEADER = 'X-Happier-Iroh-Remote-Endpoint-Id';
  const APPLICATION_PORT_HEADER = 'X-Happier-Iroh-Application-Port';
  const state = { requests: [] };
  state.server = createTcpServer((socket) => {
    let buffered = Buffer.alloc(0);
    let answered = false;
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      if (answered) return;
      buffered = Buffer.concat([buffered, chunk]);
      const text = buffered.toString('latin1');
      const headEnd = text.indexOf('\r\n\r\n');
      if (headEnd === -1) return;
      const head = text.slice(0, headEnd);
      const length = Number(/content-length:\s*(\d+)/iu.exec(head)?.[1] ?? 0);
      if (buffered.length < headEnd + 4 + length) return;
      answered = true;
      const remoteEndpointId = /x-happier-iroh-remote-endpoint-id:\s*(\S+)/iu.exec(head)?.[1] ?? '';
      state.requests.push({
        requestLine: head.slice(0, head.indexOf('\r\n')),
        remoteEndpointId,
        handshake: buffered.subarray(headEnd + 4, headEnd + 4 + length).toString('utf8'),
      });
      socket.write(
        `HTTP/1.1 200 OK\r\n${REMOTE_ENDPOINT_HEADER}: ${remoteEndpointId}\r\n`
          + `${APPLICATION_PORT_HEADER}: ${applicationPort}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`,
      );
      socket.end();
    });
  });
  return state;
}

function pageHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<title>Happier browser Iroh probe</title>
<script type="module">
import init, { HappierBrowserIrohOpenCancellation, HappierBrowserIrohProbe } from './happier_iroh_wasm.js';
window.__probe = (async () => {
  const startedAt = performance.now();
  await init();
  return {
    HappierBrowserIrohProbe,
    wasm: { HappierBrowserIrohOpenCancellation },
    initMs: performance.now() - startedAt,
  };
})();
</script>
`;
}

async function main() {
  const built = buildBrowserIrohWasm();

  // The one addon build owner, run against current source. Without this the
  // gate could load an addon built before a native or shared-core change and
  // report a pass for code that is no longer in the tree.
  const { addon } = buildAndLoadBrowserIrohTestAddon({
    extraOperations: ['ensureHomeTunnel', 'startMachineTunnel'],
  });

  const cleanups = [];
  const cleanup = async () => {
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
      } catch (error) {
        process.stderr.write(`cleanup warning: ${error}\n`);
      }
    }
  };

  // The shared native relay/Home fixture, created at step 1 below. Both browser
  // gates take their relay, endpoints and acceptors from that one owner.
  let fixture = null;

  /** The ordinary endpoint + acceptor lifecycle in front of one loopback Home. */
  async function startHome(label, marker) {
    const application = startHomeApplication(marker);
    const port = await listen(application.server);
    cleanups.push(
      () =>
        new Promise((resolve) => {
          // A withheld response would keep its socket — and therefore `close` —
          // open forever.
          application.releaseHeld();
          application.server.closeAllConnections?.();
          application.server.close(resolve);
        }),
    );

    const home = await fixture.startHome({ label, targetPort: port });
    return { ...home, application };
  }

  /**
   * How many browser connections this real Home is currently holding, read from
   * the acceptor's own counters. Re-issuing `startHomeAcceptor` for the running
   * acceptor's own target is the existing way to read them: it reuses the live
   * acceptor and returns its current status.
   */
  async function homeConnectionsActive(home) {
    return await fixture.homeConnectionsActive(home);
  }

  try {
    // 1. The one local relay owner, plain HTTP so a browser can consume it,
    //    owned by the shared native fixture.
    fixture = await createBrowserIrohNativeHomeFixture({ addon });
    cleanups.push(() => fixture.dispose());
    const relayUrl = fixture.relayUrl;

    // 2. Two independent Homes behind two real acceptors on the one relay.
    const homeA = await startHome('home-a', HOME_A_MARKER);
    const homeB = await startHome('home-b', HOME_B_MARKER);

    // 3. A well-formed EndpointId that is genuinely absent from the relay: a
    //    real endpoint, taken down again. Dialing it stays pending, which is
    //    what a cancellation contract has to be proven against.
    const absentEndpointId = await fixture.mintAbsentEndpointId();
    if (!absentEndpointId) bail('could not obtain an absent-but-valid EndpointId');

    // 4. Serve the page and the wasm-bindgen output over plain HTTP so the
    //    browser origin and the ws:// relay are both loopback.
    const assets = new Map([
      ['/', { type: 'text/html; charset=utf-8', body: Buffer.from(pageHtml()) }],
      ['/happier_iroh_wasm.js', { type: 'text/javascript', body: readFileSync(built.bindgenJs) }],
      [
        '/happier_iroh_wasm_bg.wasm',
        { type: 'application/wasm', body: readFileSync(built.bindgenWasm) },
      ],
    ]);
    const pageServer = createServer((request, response) => {
      const asset = assets.get(request.url.split('?')[0]);
      if (!asset) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': asset.type, 'content-length': asset.body.length });
      response.end(asset.body);
    });
    const pagePort = await listen(pageServer);
    cleanups.push(() => new Promise((resolve) => pageServer.close(resolve)));

    // 4b. A well-formed relay URL that is a real listening HTTP server and not a
    //     relay. It stands in for "another Home's relay set": adding it to the
    //     endpoint must never make it a path to a target that did not supply it.
    const decoyServer = createServer((request, response) => {
      response.writeHead(404).end();
    });
    const decoyPort = await listen(decoyServer);
    cleanups.push(() => new Promise((resolve) => {
      decoyServer.closeAllConnections?.();
      decoyServer.close(resolve);
    }));
    const decoyRelayUrl = `http://127.0.0.1:${decoyPort}`;
    const decoyAuthority = `127.0.0.1:${decoyPort}`;

    // 5. Real Chromium.
    const { chromium } = await import('playwright');
    // `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium` selects the full desktop build
    // where the host has its system libraries; the default headless build is
    // used otherwise. The exact build identity is reported with the results, so
    // a run always says which Chromium produced its evidence.
    const channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
    const browser = await chromium.launch(channel ? { channel } : {});
    const chromiumBuild = { version: browser.version(), channel: channel ?? 'default' };
    cleanups.push(() => browser.close());
    const page = await browser.newPage();
    // Chromium reports every failed WebSocket handshake as a console error, and
    // the wrong-relay check deliberately produces those against the decoy
    // server. The message text does not always name the URL, so the reporting
    // location is recorded with it.
    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      consoleErrors.push(`${message.text()} @ ${message.location()?.url ?? ''}`);
    });
    await page.goto(`http://127.0.0.1:${pagePort}/`, { waitUntil: 'load' });

    // 5a. Bind the one persistent browser endpoint and report its measured
    //     init/creation facts. The probe stays live on `window` so the native
    //     inbound-rejection checks below run against a real browser endpoint.
    const bound = await page.evaluate(
      async ({ relayUrl: relay, seed }) => {
        const { HappierBrowserIrohProbe, wasm, initMs } = await window.__probe;
        const createdAt = performance.now();
        const linearMemoryBeforeEndpointBytes = wasm.memory?.buffer?.byteLength ?? null;
        const probe = await HappierBrowserIrohProbe.create(new Uint8Array(seed), [relay]);
        const createMs = performance.now() - createdAt;
        window.__live = { probe, wasm };
        return {
          initMs,
          createMs,
          linearMemoryBeforeEndpointBytes,
          linearMemoryAfterEndpointBytes: wasm.memory?.buffer?.byteLength ?? null,
          endpointId: probe.endpointId(),
          appliedRelayUrls: probe.appliedRelayUrls(),
          advertisedInboundAlpns: HappierBrowserIrohProbe.advertisedInboundAlpns(),
        };
      },
      { relayUrl, seed: BROWSER_SEED },
    );

    // 5b. Real negative: a native peer cannot establish an inbound Home or
    //     machine connection to the browser endpoint. The browser advertises no
    //     inbound ALPN, so both handshakes must be rejected — not parked.
    const inboundHome = await attemptAddon(
      addon.ensureHomeTunnel(
        JSON.stringify({
          endpointHandle: homeA.endpointHandle,
          homeServerIdentityId: 'a7-inbound-negative',
          endpointId: bound.endpointId,
          relayUrls: [relayUrl],
        }),
      ),
      NATIVE_DIAL_TIMEOUT_MS,
    );
    if (inboundHome.envelope?.ok === true) {
      const tunnelId = inboundHome.envelope?.result?.tunnelId;
      if (tunnelId) {
        await callAddon(addon.releaseHomeTunnel(JSON.stringify({ tunnelId })), 'releaseHomeTunnel');
      }
    }
    const inboundMachine = await attemptAddon(
      addon.startMachineTunnel(
        JSON.stringify({
          endpointHandle: homeA.endpointHandle,
          endpointId: bound.endpointId,
          relayUrls: [relayUrl],
          handshakeJson: JSON.stringify({ probe: 'a7-inbound-negative' }),
        }),
      ),
      NATIVE_DIAL_TIMEOUT_MS,
    );
    if (inboundMachine.envelope?.ok === true) {
      const machineTunnelId = inboundMachine.envelope?.result?.machineTunnelId;
      if (machineTunnelId) {
        await callAddon(
          addon.stopMachineTunnel(JSON.stringify({ machineTunnelId })),
          'stopMachineTunnel',
        );
      }
    }

    // 5c. Concurrency, per-target relay facts, cancellation, reuse, and terminal
    //     close in the browser. This runs as several page evaluations so the
    //     Node side can observe what the real Homes saw between the steps.
    const targetIds = {
      homeAId: homeA.endpointId,
      homeBId: homeB.endpointId,
      absentId: absentEndpointId,
      probePath: PROBE_PATH,
      holdPath: HOLD_PATH,
      machinePath: MACHINE_PROBE_PATH,
      relayUrl,
      decoyRelayUrl,
      mustNotCompleteMs: MUST_NOT_COMPLETE_MS,
    };

    // 5c-i. Interleaved Homes under one endpoint, each opened with its OWN
    //       relay facts, and the hint validation that guards every open.
    const outcome = await page.evaluate(async (input) => {
      const { probe, wasm } = window.__live;
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const requestFor = (path) =>
        encoder.encode(`GET ${path} HTTP/1.1\r\nHost: happier.invalid\r\nConnection: close\r\n\r\n`);
      const requestA = requestFor(`${input.probePath}/a`);
      const requestB = requestFor(`${input.probePath}/b`);
      const requestHold = requestFor(`${input.probePath}${input.holdPath}`);
      // Every open carries exactly the relays its own target published. A
      // browser is relay-only: it has no other path, and another Home's relay
      // is not a path to this one.
      const open = (target, request, relays, max = 65_536) =>
        probe.openHomeTunnelStream(target, request, max, relays);
      const openA = () => open(input.homeAId, requestA, [input.relayUrl]);
      const openB = () => open(input.homeBId, requestB, [input.relayUrl]);
      const outcomeOf = (promise) =>
        promise.then(
          (bytes) => `resolved: ${decoder.decode(bytes)}`,
          (error) => `rejected: ${error}`,
        );
      window.__probeKit = { decoder, requestA, requestB, requestHold, open, openA, openB, outcomeOf };

      // Cold per-target discrimination, before either Home has ever been
      // reached. The one endpoint's relay set already contains the WORKING
      // relay (it was configured at bind), and Home B is reachable through it —
      // yet an open carrying only a relay Home B never published must not reach
      // it. Running this first is deliberate: once a target has been reached,
      // iroh keeps the addressing it learned for that authenticated endpoint,
      // so a later hint set cannot prove exclusivity.
      const decoyOpen = outcomeOf(open(input.homeBId, requestB, [input.decoyRelayUrl]));
      const decoyFacts = {
        decoyHintOutcome: await Promise.race([
          decoyOpen,
          new Promise((resolve) =>
            setTimeout(() => resolve('did not complete'), input.mustNotCompleteMs),
          ),
        ]),
        // Membership grew by union — the configured relay was never evicted —
        // even though the union is not a dial path.
        appliedRelayUrlsAfterDecoy: probe.appliedRelayUrls(),
      };
      probe.cancel();
      decoyFacts.decoyCancelOutcome = await Promise.race([
        decoyOpen,
        new Promise((resolve) => setTimeout(() => resolve('still pending after cancel'), 4000)),
      ]);
      const dialsBeforeConcurrentHomes = probe.dialsStarted();

      const streamAt = performance.now();
      const firstA = decoder.decode(await openA());
      const firstStreamMs = performance.now() - streamAt;

      // Interleaved Homes on one endpoint: neither target may evict the
      // other's connection, and the second visit to each must reuse it.
      const firstB = decoder.decode(await openB());
      const secondA = decoder.decode(await openA());
      const secondB = decoder.decode(await openB());

      const facts = {
        ...decoyFacts,
        firstStreamMs,
        linearMemoryAfterStreamsBytes: wasm.memory?.buffer?.byteLength ?? null,
        firstA,
        firstB,
        secondA,
        secondB,
        concurrentTargets: probe.liveConnectionTargets(),
        dialsForConcurrentHomes: probe.dialsStarted() - dialsBeforeConcurrentHomes,
        streamsAfterConcurrentHomes: probe.streamsOpened(),
        // Both Homes supplied the relay that is already in the set, so it is
        // unchanged: a per-target hint joins the set, it never duplicates or
        // replaces what is there.
        appliedRelayUrlsAfterTargetHints: probe.appliedRelayUrls(),
      };

      // Supplied relay facts are validated before any cached connection is
      // reused: a credential-bearing or empty hint set is a bad descriptor
      // whether or not this target is already connected.
      facts.dialsAfterInterleavedHomes = probe.dialsStarted();
      facts.cachedCredentialHintOutcome = await outcomeOf(
        open(input.homeBId, requestB, ['https://user:secret@relay.happier.invalid']),
      );
      facts.cachedEmptyHintOutcome = await outcomeOf(open(input.homeBId, requestB, []));
      facts.reuseAfterRejectedHints = decoder.decode(await openB());
      facts.dialsAfterRejectedHints = probe.dialsStarted();
      facts.targetsAfterRejectedHints = probe.liveConnectionTargets();
      return facts;
    }, targetIds);

    // 5c-ii. A genuinely pending dial, cancelled; then cold opens sharing one
    //        dial per target.
    Object.assign(
      outcome,
      await page.evaluate(async (input) => {
        const { probe, wasm } = window.__live;
        const { decoder, requestA, open, openA, openB, outcomeOf } = window.__probeKit;
        const facts = {};

        // An absent-but-valid EndpointId cannot complete a dial. Cancel must
        // reject it promptly, leave no live connection, and leave the endpoint
        // reusable.
        let settled = null;
        const cancellation = new wasm.HappierBrowserIrohOpenCancellation();
        const pending = outcomeOf(probe.openIncrementalHomeTunnelStream(
          input.absentId,
          [input.relayUrl],
          cancellation,
        )).then(
          (result) => {
            settled = result;
            return result;
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 750));
        facts.pendingStillInFlightBeforeCancel = settled === null;

        const cancelledAt = performance.now();
        cancellation.cancel();
        facts.pendingCancelOutcome = await Promise.race([
          pending,
          new Promise((resolve) => setTimeout(() => resolve('still pending after cancel'), 4000)),
        ]);
        facts.pendingCancelMs = performance.now() - cancelledAt;
        facts.targetsAfterCancel = probe.liveConnectionTargets();

        // The same endpoint is still usable after a cancellation.
        facts.afterCancel = decoder.decode(await openA());
        facts.dialsAfterReuse = probe.dialsStarted();

        // Make Home B genuinely cold while leaving Home A live. Two opens for
        // that same cold target must then share one dial instead of racing to
        // replace each other's connection.
        probe.closeHomeTunnelConnection(input.homeBId);
        facts.targetsBeforeRacedSameTarget = probe.liveConnectionTargets();
        const dialsBeforeRacedSameTarget = probe.dialsStarted();
        const raced = await Promise.all([openB(), openB()]);
        facts.racedSameTarget = raced.map((bytes) => decoder.decode(bytes));
        facts.dialsAfterRacedSameTarget = probe.dialsStarted();
        facts.dialsForRacedSameTarget = facts.dialsAfterRacedSameTarget - dialsBeforeRacedSameTarget;
        facts.targetsAfterRacedSameTarget = probe.liveConnectionTargets();
        return facts;
      }, targetIds),
    );

    // A finish racing an admitted write must wait for that write and then
    // produce a real peer-visible FIN. Returning success merely because the
    // send handle is temporarily owned by writeStream loses the half-close.
    const writeSideEndsBeforeConcurrentFinish = homeA.application.writeSideEnds;
    Object.assign(
      outcome,
      await page.evaluate(async (input) => {
        const { probe, wasm } = window.__live;
        const handle = await probe.openIncrementalHomeTunnelStream(
          input.homeAId,
          [input.relayUrl],
          new wasm.HappierBrowserIrohOpenCancellation(),
        );
        const requestPrefix = new TextEncoder().encode(
          `POST /concurrent-finish HTTP/1.1\r\nHost: browser.test\r\nContent-Length: 1048480\r\nConnection: close\r\n\r\n`,
        );
        const request = new Uint8Array(1024 * 1024);
        request.set(requestPrefix);
        request.fill(120, requestPrefix.byteLength);
        let writeSettled = false;
        const write = probe.writeStream(handle, request).then(() => {
          writeSettled = true;
        });
        const finish = probe.finishStreamWrite(handle).then(() => ({
          writeSettledWhenFinishResolved: writeSettled,
        }));
        const [, finishFacts] = await Promise.all([write, finish]);
        await probe.closeStream(handle);
        return finishFacts;
      }, targetIds),
    );
    const concurrentFinishReachedPeerEof = await waitFor(
      () => homeA.application.writeSideEnds > writeSideEndsBeforeConcurrentFinish,
      15_000,
    );
    outcome.concurrentFinishReachedPeerEof = concurrentFinishReachedPeerEof;

    // 5c-iii. After a target's connection terminates, the NEXT open carries its
    //         relay facts again: nothing is remembered per target on this side.
    Object.assign(
      outcome,
      await page.evaluate(async () => {
        const { probe } = window.__live;
        const { decoder, openA, openB } = window.__probeKit;
        const facts = {};

        probe.cancel();
        facts.targetsAfterTermination = probe.liveConnectionTargets();
        facts.refreshedHintsB = decoder.decode(await openB());
        facts.refreshedHintsA = decoder.decode(await openA());
        facts.targetsAfterRefreshedHints = probe.liveConnectionTargets();
        return facts;
      }),
    );

    // 5c-iv. The A7.3 surface moves request and response bytes incrementally,
    //         proves the authenticated remote EndpointId, half-closes only the
    //         write side, and makes close idempotent.
    Object.assign(
      outcome,
      await page.evaluate(async (input) => {
        const { probe, wasm } = window.__live;
        const { decoder, requestA } = window.__probeKit;
        const handle = await probe.openIncrementalHomeTunnelStream(
          input.homeAId,
          [input.relayUrl],
          new wasm.HappierBrowserIrohOpenCancellation(),
        );
        const remoteEndpointId = probe.streamRemoteEndpointId(handle);
        const splitAt = Math.floor(requestA.byteLength / 2);
        await probe.writeStream(handle, requestA.slice(0, splitAt));
        await probe.writeStream(handle, requestA.slice(splitAt));
        await probe.finishStreamWrite(handle);
        // Half-close is idempotent and leaves the response direction readable.
        await probe.finishStreamWrite(handle);
        const chunks = [];
        while (true) {
          const chunk = await probe.readStream(handle, 7);
          if (chunk === null) break;
          chunks.push(...chunk);
        }
        await probe.closeStream(handle);
        await probe.closeStream(handle);
        let readAfterClose;
        try {
          await probe.readStream(handle, 1);
          readAfterClose = 'unexpectedly succeeded';
        } catch (error) {
          readAfterClose = String(error);
        }
        return {
          incrementalResponse: decoder.decode(new Uint8Array(chunks)),
          incrementalRemoteEndpointId: remoteEndpointId,
          incrementalReadAfterClose: readAfterClose,
        };
      }, targetIds),
    );

    // 5c-iv-b. A7.4: one real `happier/machine/1` dial from the browser to a
    //          real native `MachineAcceptor`.
    //
    //          The acceptor deliberately runs on Home A's endpoint, which is
    //          already serving `happier/home-tunnel/1`. One EndpointId, two
    //          protocols: a machine stream that were confused for a Home stream
    //          would be answered by the Home application instead of reaching
    //          admission at all. No production transfer routing is involved —
    //          the frame is written by this gate, exactly as the machine
    //          carrier seam writes it.
    const machineApplication = startHomeApplication(MACHINE_MARKER);
    const machineApplicationPort = await listen(machineApplication.server);
    cleanups.push(
      () =>
        new Promise((resolve) => {
          machineApplication.releaseHeld();
          machineApplication.server.closeAllConnections?.();
          machineApplication.server.close(resolve);
        }),
    );
    const machineAdmission = startMachineAdmission({ applicationPort: machineApplicationPort });
    const machineAdmissionPort = await listen(machineAdmission.server);
    cleanups.push(
      () =>
        new Promise((resolve) => {
          machineAdmission.server.closeAllConnections?.();
          machineAdmission.server.close(resolve);
        }),
    );
    await callAddon(
      addon.startMachineAcceptor(
        JSON.stringify({
          endpointHandle: homeA.endpointHandle,
          admissionHost: '127.0.0.1',
          admissionPort: machineAdmissionPort,
        }),
      ),
      'startMachineAcceptor(home-a)',
    );
    cleanups.push(() =>
      callAddon(
        addon.stopMachineAcceptor(JSON.stringify({ endpointHandle: homeA.endpointHandle })),
        'stopMachineAcceptor(home-a)',
      ),
    );

    const machineHandshakeJson = JSON.stringify({
      probe: 'a7.4-browser-machine-alpn',
      flow: 'file_transfer',
    });
    Object.assign(
      outcome,
      await page.evaluate(
        async (input) => {
          const { probe, wasm } = window.__live;
          const { decoder } = window.__probeKit;
          const encoder = new TextEncoder();
          const facts = {};
          const dialsBefore = probe.dialsStarted();

          // The machine dial is its own operation. No ALPN string is passed.
          const handle = await probe.openIncrementalMachineStream(input.machineTargetId, [
            input.relayUrl,
          ], new wasm.HappierBrowserIrohOpenCancellation());
          facts.machineRemoteEndpointId = probe.streamRemoteEndpointId(handle);
          facts.machineObservedPath = probe.streamObservedPath(handle);
          // A live Home-tunnel connection to this same EndpointId must not be
          // reused: this is a different protocol, so it costs its own dial.
          facts.machineDials = probe.dialsStarted() - dialsBefore;

          // The canonical machine admission frame, written exactly as the
          // existing machine-carrier seam writes it: preamble, big-endian
          // handshake length, handshake.
          const handshake = encoder.encode(input.machineHandshakeJson);
          const frame = new Uint8Array(5 + handshake.byteLength);
          frame[0] = 0x01;
          new DataView(frame.buffer).setUint32(1, handshake.byteLength, false);
          frame.set(handshake, 5);
          await probe.writeStream(handle, frame);

          const decision = await probe.readStream(handle, 1);
          facts.machineAdmissionDecision = decision === null ? 'eof' : Array.from(decision);
          if (decision !== null && decision[0] === 1) {
            await probe.writeStream(
              handle,
              encoder.encode(
                `GET ${input.machinePath} HTTP/1.1\r\nHost: happier.invalid\r\nConnection: close\r\n\r\n`,
              ),
            );
            await probe.finishStreamWrite(handle);
            const chunks = [];
            for (;;) {
              const chunk = await probe.readStream(handle, 64);
              if (chunk === null) break;
              chunks.push(...chunk);
            }
            facts.machineApplicationResponse = decoder.decode(new Uint8Array(chunks));
          }
          facts.machineTargetsWhileOpen = probe.liveConnectionTargets();
          await probe.closeStream(handle);
          return facts;
        },
        { ...targetIds, machineTargetId: homeA.endpointId, machineHandshakeJson },
      ),
    );

    // The Home protocol on that same endpoint is unaffected by the machine
    // connection beside it.
    Object.assign(
      outcome,
      await page.evaluate(async () => {
        const { decoder, openA } = window.__probeKit;
        return { homeAfterMachineStream: decoder.decode(await openA()) };
      }),
    );

    // 5c-v. A held incremental read is cancelled at stream scope. The Home's
    //        late response cannot resurrect it and the endpoint remains usable.
    await page.evaluate(async (input) => {
      const { probe, wasm } = window.__live;
      const { requestHold } = window.__probeKit;
      const handle = await probe.openIncrementalHomeTunnelStream(
        input.homeAId,
        [input.relayUrl],
        new wasm.HappierBrowserIrohOpenCancellation(),
      );
      await probe.writeStream(handle, requestHold);
      await probe.finishStreamWrite(handle);
      window.__incrementalHeldHandle = handle;
      window.__incrementalHeldSettled = null;
      window.__incrementalHeld = probe.readStream(handle, 64).then(
        (bytes) => `resolved: ${bytes === null ? 'eof' : bytes.byteLength}`,
        (error) => `rejected: ${error}`,
      ).then((result) => {
        window.__incrementalHeldSettled = result;
        return result;
      });
    }, targetIds);

    const incrementalHeldObserved = await waitFor(() => homeA.application.held.length > 0, 15_000);
    Object.assign(
      outcome,
      await page.evaluate(async () => {
        const { probe } = window.__live;
        const facts = {
          incrementalHeldStillInFlightBeforeCancel: window.__incrementalHeldSettled === null,
        };
        const cancelledAt = performance.now();
        probe.cancelStream(window.__incrementalHeldHandle);
        facts.incrementalHeldCancelOutcome = await Promise.race([
          window.__incrementalHeld,
          new Promise((resolve) => setTimeout(() => resolve('still pending after cancel'), 4000)),
        ]);
        facts.incrementalHeldCancelMs = performance.now() - cancelledAt;
        await probe.closeStream(window.__incrementalHeldHandle);
        await probe.closeStream(window.__incrementalHeldHandle);
        return facts;
      }),
    );
    const incrementalReleasedHeld = homeA.application.releaseHeld();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    Object.assign(
      outcome,
      await page.evaluate(async () => ({
        incrementalHeldOutcomeAfterLateResponse: window.__incrementalHeldSettled,
      })),
    );

    // 5c-vi. A real Home acceptor receives the request and withholds its
    //        response. Cancelling must reject the browser operation promptly and
    //        the late response must not complete it.
    await page.evaluate(async (input) => {
      const { requestHold, open, outcomeOf } = window.__probeKit;
      window.__heldSettled = null;
      window.__held = outcomeOf(
        open(input.homeAId, requestHold, [input.relayUrl]),
      ).then((result) => {
        window.__heldSettled = result;
        return result;
      });
    }, targetIds);

    const heldObserved = await waitFor(() => homeA.application.held.length > 0, 15_000);
    Object.assign(
      outcome,
      await page.evaluate(async () => {
        const { probe } = window.__live;
        const facts = { heldStillInFlightBeforeCancel: window.__heldSettled === null };
        const cancelledAt = performance.now();
        probe.cancel();
        facts.heldCancelOutcome = await Promise.race([
          window.__held,
          new Promise((resolve) => setTimeout(() => resolve('still pending after cancel'), 4000)),
        ]);
        facts.heldCancelMs = performance.now() - cancelledAt;
        return facts;
      }),
    );

    // The Home answers late. A cancelled operation must not complete on it.
    const releasedHeld = homeA.application.releaseHeld();
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // 5c-vii. No late completion, another target still usable, terminal close.
    Object.assign(
      outcome,
      await page.evaluate(async (input) => {
        const { probe, wasm } = window.__live;
        const { decoder, requestA, open, openA, openB } = window.__probeKit;
        const facts = { heldOutcomeAfterLateResponse: window.__heldSettled };

        // The endpoint — and a target other than the cancelled one — is still
        // usable after the cancellation.
        facts.otherTargetAfterHeldCancel = decoder.decode(await openB());
        facts.sameTargetAfterHeldCancel = decoder.decode(await openA());

        await probe.close();
        facts.closed = probe.isClosed();
        facts.targetsAfterClose = probe.liveConnectionTargets();
        // Terminal close took the endpoint out of the probe: it can no longer
        // even report its own identity.
        for (const [name, call] of [
          ['endpointId', () => probe.endpointId()],
          ['appliedRelayUrls', () => probe.appliedRelayUrls()],
        ]) {
          try {
            call();
            facts[`${name}AfterClose`] = 'unexpectedly succeeded';
          } catch (error) {
            facts[`${name}AfterClose`] = String(error);
          }
        }
        try {
          await open(input.homeAId, requestA, [input.relayUrl], 1024);
          facts.streamAfterClose = 'unexpectedly succeeded';
        } catch (error) {
          facts.streamAfterClose = String(error);
        }
        // Close is idempotent.
        await probe.close();
        facts.closedAfterSecondClose = probe.isClosed();
        facts.linearMemoryAfterCloseBytes = wasm.memory?.buffer?.byteLength ?? null;
        return facts;
      }, targetIds),
    );

    // 5d. A7.1 item 5, implicit release. A JS caller may never call `close`: the
    //     generated `free` (or a garbage-collected wrapper) is the only release
    //     the probe gets. An in-flight `openHomeTunnelStream` Promise holds the
    //     Rust probe independently of that wrapper, so releasing the wrapper
    //     must be terminal custody — the pending operation rejects, the real
    //     Home's connection is closed, and the Home's late answer cannot revive
    //     it — rather than leaving a live endpoint nobody can reach or stop.
    //
    //     The first probe was terminally closed above, so only one browser
    //     endpoint is ever live at a time.
    const freedBinding = await page.evaluate(
      async ({ relayUrl: relay, seed }) => {
        const { HappierBrowserIrohProbe } = await window.__probe;
        const probe = await HappierBrowserIrohProbe.create(new Uint8Array(seed), [relay]);
        window.__freed = { probe };
        return { endpointId: probe.endpointId() };
      },
      { relayUrl, seed: FREED_BROWSER_SEED },
    );

    const heldRequestsBeforeFree = homeA.application.requests;
    await page.evaluate(async (input) => {
      const { requestHold, outcomeOf } = window.__probeKit;
      const { probe } = window.__freed;
      window.__freedSettled = null;
      window.__freedHeld = outcomeOf(
        probe.openHomeTunnelStream(input.homeAId, requestHold, 65_536, [input.relayUrl]),
      ).then((result) => {
        window.__freedSettled = result;
        return result;
      });
    }, targetIds);

    // The request is genuinely delivered to the real Home, which withholds its
    // response: only then is there a pending operation for `free` to release,
    // and only then is the Home really holding this browser's connection.
    const freedHeldObserved = await waitFor(() => homeA.application.held.length > 0, 15_000);
    const freedHomeConnectionsBeforeFree = await homeConnectionsActive(homeA);

    Object.assign(
      outcome,
      await page.evaluate(async () => {
        const { probe } = window.__freed;
        const facts = { freedStillInFlightBeforeFree: window.__freedSettled === null };
        const freedAt = performance.now();
        // wasm-bindgen's generated release. No `close`, no `cancel`.
        probe.free();
        facts.freedOutcome = await Promise.race([
          window.__freedHeld,
          new Promise((resolve) => setTimeout(() => resolve('still pending after free'), 4000)),
        ]);
        facts.freedMs = performance.now() - freedAt;
        try {
          probe.endpointId();
          facts.freedProbeStillUsable = 'unexpectedly succeeded';
        } catch (error) {
          facts.freedProbeStillUsable = String(error);
        }
        return facts;
      }),
    );

    // Real-peer evidence, from the Home acceptor's own connection accounting:
    // the browser connection this Home was holding is gone. That is the endpoint
    // side of the release — it cannot be satisfied by a detached JS wrapper, and
    // it needs no GC timing to observe.
    const freedHomeConnectionsAfterFree = await waitFor(
      async () => (await homeConnectionsActive(homeA)) === 0,
      10_000,
    );

    // The Home answers late. After a real release its socket is already gone, so
    // the answer cannot even be delivered — and the freed operation's outcome
    // must be unchanged either way.
    const freedReleasedHeld = homeA.application.releaseHeld();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    Object.assign(
      outcome,
      await page.evaluate(async () => ({
        freedOutcomeAfterLateResponse: window.__freedSettled,
      })),
    );

    const failures = [];
    const expectedRelays = JSON.stringify([new URL(relayUrl).toString()]);

    // A7.1 item 4 — identity, exact configured relay, no ambient discovery.
    if (JSON.stringify(bound.appliedRelayUrls) !== expectedRelays) {
      failures.push(
        `applied relays ${JSON.stringify(bound.appliedRelayUrls)} are not exactly the configured relay ${expectedRelays}`,
      );
    }
    // A browser endpoint is dial-only: it advertises no inbound ALPN.
    if (JSON.stringify(bound.advertisedInboundAlpns) !== '[]') {
      failures.push(
        `the browser endpoint advertises inbound ALPNs ${JSON.stringify(bound.advertisedInboundAlpns)}`,
      );
    }
    for (const [label, attempt] of [
      ['Home', inboundHome],
      ['machine', inboundMachine],
    ]) {
      if (attempt.timedOut) {
        failures.push(
          `a native peer's inbound ${label} handshake to the browser endpoint was neither served nor rejected within ${NATIVE_DIAL_TIMEOUT_MS}ms`,
        );
      } else if (attempt.envelope?.ok !== false) {
        failures.push(
          `a native peer established an inbound ${label} connection to the browser endpoint: ${JSON.stringify(attempt.envelope)}`,
        );
      }
    }

    // A7.1 item 3 — a real bidirectional stream reaching each real Home.
    if (!outcome.firstA.includes(HOME_A_MARKER)) {
      failures.push(`first stream did not reach Home A: ${JSON.stringify(outcome.firstA)}`);
    }
    if (!outcome.firstA.includes(PROBE_PATH)) {
      failures.push('Home A did not observe the browser request path');
    }
    if (!outcome.firstB.includes(HOME_B_MARKER)) {
      failures.push(`Home B did not answer its own request: ${JSON.stringify(outcome.firstB)}`);
    }
    if (!outcome.secondA.includes(HOME_A_MARKER) || !outcome.secondB.includes(HOME_B_MARKER)) {
      failures.push('an interleaved Home request was answered by the wrong Home or not at all');
    }
    const expectedTargets = JSON.stringify([homeA.endpointId, homeB.endpointId].sort());
    if (JSON.stringify(outcome.concurrentTargets) !== expectedTargets) {
      failures.push(
        `both Homes must stay concurrently connected under one endpoint; live targets were ${JSON.stringify(outcome.concurrentTargets)}`,
      );
    }
    if (outcome.dialsForConcurrentHomes !== 2) {
      failures.push(
        `two Homes over four requests must cost exactly two dials, got ${outcome.dialsForConcurrentHomes} (a target switch is evicting the other connection)`,
      );
    }
    if (outcome.streamsAfterConcurrentHomes < 4) {
      failures.push(`expected 4 opened streams, got ${outcome.streamsAfterConcurrentHomes}`);
    }
    if (homeA.application.requests < 2 || homeB.application.requests < 2) {
      failures.push(
        `Home application servers saw A=${homeA.application.requests} B=${homeB.application.requests} requests`,
      );
    }
    if (!outcome.incrementalResponse.includes(HOME_A_MARKER)) {
      failures.push(
        `incremental stream bytes did not reach Home A: ${JSON.stringify(outcome.incrementalResponse)}`,
      );
    }
    if (outcome.incrementalRemoteEndpointId !== homeA.endpointId) {
      failures.push(
        `incremental stream authenticated ${outcome.incrementalRemoteEndpointId}, expected exact EndpointId ${homeA.endpointId}`,
      );
    }
    if (outcome.incrementalRemoteEndpointId === homeB.endpointId) {
      failures.push('incremental Home A stream reported Home B as its authenticated remote');
    }
    if (!String(outcome.incrementalReadAfterClose).includes('unknown_stream')) {
      failures.push(
        `incremental close did not retire its opaque handle: ${outcome.incrementalReadAfterClose}`,
      );
    }
    if (outcome.writeSettledWhenFinishResolved !== true) {
      failures.push('finishStreamWrite resolved while writeStream still owned the send direction');
    }
    if (!outcome.concurrentFinishReachedPeerEof) {
      failures.push('concurrent finish did not produce a peer-visible write-side EOF');
    }

    // A7.4 — the browser's machine/1 dial reached a real native MachineAcceptor
    // on an EndpointId that also serves the Home tunnel, was admitted through
    // the canonical frame, and moved application bytes afterwards.
    if (outcome.machineRemoteEndpointId !== homeA.endpointId) {
      failures.push(
        `machine stream authenticated ${outcome.machineRemoteEndpointId}, expected exact EndpointId ${homeA.endpointId}`,
      );
    }
    if (outcome.machineObservedPath === 'direct') {
      failures.push('the relay-only browser carrier reported a direct path for a machine stream');
    }
    if (outcome.machineDials !== 1) {
      failures.push(
        `a machine dial to an endpoint already connected for the Home tunnel must dial its own connection, got ${outcome.machineDials} dials (the Home connection is being reused across ALPNs)`,
      );
    }
    if (JSON.stringify(outcome.machineAdmissionDecision) !== '[1]') {
      failures.push(
        `the real machine acceptor did not admit the canonical frame: ${JSON.stringify(outcome.machineAdmissionDecision)}`,
      );
    }
    if (machineAdmission.requests.length !== 1) {
      failures.push(
        `the machine admission owner saw ${machineAdmission.requests.length} requests, expected exactly one`,
      );
    } else {
      const admitted = machineAdmission.requests[0];
      if (admitted.remoteEndpointId !== bound.endpointId) {
        failures.push(
          `admission was asked about ${admitted.remoteEndpointId}, not the browser's authenticated EndpointId ${bound.endpointId}`,
        );
      }
      if (admitted.handshake !== machineHandshakeJson) {
        failures.push(
          `admission received a handshake other than the bytes the browser wrote: ${admitted.handshake}`,
        );
      }
    }
    if (!String(outcome.machineApplicationResponse ?? '').includes(MACHINE_MARKER)) {
      failures.push(
        `machine application bytes did not reach the admitted destination: ${JSON.stringify(outcome.machineApplicationResponse)}`,
      );
    }
    if (String(outcome.machineApplicationResponse ?? '').includes(HOME_A_MARKER)) {
      failures.push('a machine/1 stream was answered by the Home application: the ALPNs are confused');
    }
    // Home A appears twice while both protocols are connected to it, which is
    // the custody evidence that they are two connections rather than one.
    if ((outcome.machineTargetsWhileOpen ?? []).filter((id) => id === homeA.endpointId).length !== 2) {
      failures.push(
        `Home A must hold one Home-tunnel and one machine connection while the machine stream is open, got ${JSON.stringify(outcome.machineTargetsWhileOpen)}`,
      );
    }
    if (!String(outcome.homeAfterMachineStream ?? '').includes(HOME_A_MARKER)) {
      failures.push(
        `the Home tunnel on that endpoint was damaged by the machine connection beside it: ${JSON.stringify(outcome.homeAfterMachineStream)}`,
      );
    }

    // Per-target relay facts: validated before a cached connection is reused,
    // applied as a union, and the ONLY hints a cold dial may use.
    for (const [label, observed] of [
      ['a credential-bearing', outcome.cachedCredentialHintOutcome],
      ['an empty', outcome.cachedEmptyHintOutcome],
    ]) {
      if (!/^rejected:/u.test(String(observed))) {
        failures.push(
          `${label} relay hint set was accepted for an already-connected target: ${observed}`,
        );
      } else if (!/InvalidDescriptor/u.test(String(observed))) {
        failures.push(`${label} relay hint set failed for another reason: ${observed}`);
      }
    }
    if (!outcome.reuseAfterRejectedHints.includes(HOME_B_MARKER)) {
      failures.push('a rejected hint set damaged the target it was rejected for');
    }
    if (outcome.dialsAfterRejectedHints !== outcome.dialsAfterInterleavedHomes) {
      failures.push(
        `rejected hint sets must not dial, dials went ${outcome.dialsAfterInterleavedHomes} -> ${outcome.dialsAfterRejectedHints}`,
      );
    }
    if (JSON.stringify(outcome.targetsAfterRejectedHints) !== expectedTargets) {
      failures.push(
        `rejected hint sets changed connection custody to ${JSON.stringify(outcome.targetsAfterRejectedHints)}`,
      );
    }
    if (/^resolved:/u.test(String(outcome.decoyHintOutcome))) {
      failures.push(
        `Home B answered an open carrying a relay set it never published (${outcome.decoyHintOutcome}): a cold dial is using the endpoint relay union instead of this target's facts`,
      );
    }
    if (!/^rejected:/u.test(String(outcome.decoyCancelOutcome))) {
      failures.push(
        `the wrong-relay open was not released by cancel: ${outcome.decoyCancelOutcome}`,
      );
    }
    const expectedUnion = JSON.stringify(
      [new URL(relayUrl).toString(), new URL(decoyRelayUrl).toString()].sort(),
    );
    if (JSON.stringify([...outcome.appliedRelayUrlsAfterDecoy].sort()) !== expectedUnion) {
      failures.push(
        `endpoint relay membership must grow as a union, got ${JSON.stringify(outcome.appliedRelayUrlsAfterDecoy)} expected ${expectedUnion}`,
      );
    }
    if (JSON.stringify(outcome.targetsAfterTermination) !== '[]') {
      failures.push(
        `the refreshed-hint check did not start from terminated connections: ${JSON.stringify(outcome.targetsAfterTermination)}`,
      );
    }
    if (!outcome.refreshedHintsB.includes(HOME_B_MARKER)) {
      failures.push(
        `refreshed relay facts were not used for Home B after its connection terminated: ${JSON.stringify(outcome.refreshedHintsB)}`,
      );
    }
    if (!outcome.refreshedHintsA.includes(HOME_A_MARKER)) {
      failures.push('Home A was not reachable with refreshed relay facts');
    }
    if (JSON.stringify(outcome.targetsAfterRefreshedHints) !== expectedTargets) {
      failures.push(
        `refreshed relay facts left ${JSON.stringify(outcome.targetsAfterRefreshedHints)} in custody, expected both Homes ${expectedTargets}`,
      );
    }

    // A7.1 item 5 — cancellation and close release browser resources.
    if (outcome.pendingStillInFlightBeforeCancel !== true) {
      failures.push('the pending-dial cancellation check did not observe a genuinely pending operation');
    }
    if (!/^rejected:/u.test(String(outcome.pendingCancelOutcome))) {
      failures.push(`cancel did not reject the pending operation: ${outcome.pendingCancelOutcome}`);
    } else if (!/cancel/iu.test(String(outcome.pendingCancelOutcome))) {
      failures.push(`the pending operation failed for another reason: ${outcome.pendingCancelOutcome}`);
    }
    if (!(outcome.pendingCancelMs < 2000)) {
      failures.push(`cancel took ${Math.round(outcome.pendingCancelMs)}ms to reject the pending operation`);
    }
    if (JSON.stringify(outcome.targetsAfterCancel) !== expectedTargets) {
      failures.push(
        `one cancelled open disturbed sibling connections: ${JSON.stringify(outcome.targetsAfterCancel)}`,
      );
    }
    if (!outcome.afterCancel.includes(HOME_A_MARKER)) {
      failures.push('the endpoint was not reusable after a cancellation');
    }
    // One dial for the cancelled pending open. Home A stays live and is reused.
    if (outcome.dialsAfterReuse !== outcome.dialsAfterRejectedHints + 1) {
      failures.push(
        `a scoped cancel must not re-dial a sibling, dials went ${outcome.dialsAfterRejectedHints} -> ${outcome.dialsAfterReuse}`,
      );
    }
    if (!outcome.racedSameTarget.every((body) => body.includes(HOME_B_MARKER))) {
      failures.push(
        `concurrent cold opens for one target did not both reach it: ${JSON.stringify(outcome.racedSameTarget)}`,
      );
    }
    if (JSON.stringify(outcome.targetsBeforeRacedSameTarget) !== JSON.stringify([targetIds.homeAId])) {
      failures.push(
        `the same-target race was not cold for Home B: ${JSON.stringify(outcome.targetsBeforeRacedSameTarget)}`,
      );
    }
    if (outcome.dialsForRacedSameTarget !== 1) {
      failures.push(
        `concurrent cold opens for one target used ${outcome.dialsForRacedSameTarget} dials instead of one`,
      );
    }
    if (JSON.stringify(outcome.targetsAfterRacedSameTarget) !== expectedTargets) {
      failures.push(
        `concurrent cold opens left ${JSON.stringify(outcome.targetsAfterRacedSameTarget)} in custody, expected both Homes ${expectedTargets}`,
      );
    }
    if (
      JSON.stringify(outcome.appliedRelayUrlsAfterTargetHints) !==
      JSON.stringify(outcome.appliedRelayUrlsAfterDecoy)
    ) {
      failures.push(
        `re-supplying a relay the endpoint already has changed its set to ${JSON.stringify(outcome.appliedRelayUrlsAfterTargetHints)}`,
      );
    }
    // A7.1 item 5 — a response the real Home received and withheld. Cancelling
    // must reject it promptly, and the Home's late answer must not complete it.
    if (!heldObserved) {
      failures.push('the real Home never received the withheld request, so nothing was cancelled');
    }
    if (outcome.heldStillInFlightBeforeCancel !== true) {
      failures.push('the withheld-response check did not observe a genuinely pending operation');
    }
    if (!/^rejected:/u.test(String(outcome.heldCancelOutcome))) {
      failures.push(
        `cancel did not reject the operation whose response the Home was holding: ${outcome.heldCancelOutcome}`,
      );
    } else if (!/cancel/iu.test(String(outcome.heldCancelOutcome))) {
      failures.push(
        `the withheld-response operation failed for another reason: ${outcome.heldCancelOutcome}`,
      );
    }
    if (!(outcome.heldCancelMs < 2000)) {
      failures.push(
        `cancel took ${Math.round(outcome.heldCancelMs)}ms to reject the withheld-response operation`,
      );
    }
    if (releasedHeld < 1) {
      failures.push('no withheld response was released, so late completion was never tested');
    }
    if (outcome.heldOutcomeAfterLateResponse !== outcome.heldCancelOutcome) {
      failures.push(
        `the Home's late response changed a cancelled operation's outcome to ${outcome.heldOutcomeAfterLateResponse}`,
      );
    }
    if (!outcome.otherTargetAfterHeldCancel.includes(HOME_B_MARKER)) {
      failures.push(
        `another target was not usable after the withheld-response cancellation: ${JSON.stringify(outcome.otherTargetAfterHeldCancel)}`,
      );
    }
    if (!outcome.sameTargetAfterHeldCancel.includes(HOME_A_MARKER)) {
      failures.push('the cancelled target was not usable again after the cancellation');
    }
    if (!incrementalHeldObserved) {
      failures.push('the real Home never observed the incrementally written held request');
    }
    if (outcome.incrementalHeldStillInFlightBeforeCancel !== true) {
      failures.push('the incremental read was not genuinely pending before stream cancellation');
    }
    if (!/^rejected:/u.test(String(outcome.incrementalHeldCancelOutcome))) {
      failures.push(
        `stream cancellation did not reject the held incremental read: ${outcome.incrementalHeldCancelOutcome}`,
      );
    } else if (!/cancel/iu.test(String(outcome.incrementalHeldCancelOutcome))) {
      failures.push(
        `the held incremental read failed for another reason: ${outcome.incrementalHeldCancelOutcome}`,
      );
    }
    if (!(outcome.incrementalHeldCancelMs < 2000)) {
      failures.push(
        `stream cancellation took ${Math.round(outcome.incrementalHeldCancelMs)}ms to reject the held read`,
      );
    }
    if (incrementalReleasedHeld < 1) {
      failures.push('no incremental held response was released, so late completion was not tested');
    }
    if (outcome.incrementalHeldOutcomeAfterLateResponse !== outcome.incrementalHeldCancelOutcome) {
      failures.push(
        `the late incremental response changed the cancelled read to ${outcome.incrementalHeldOutcomeAfterLateResponse}`,
      );
    }
    if (outcome.closed !== true || outcome.closedAfterSecondClose !== true) {
      failures.push('close is not terminal and idempotent');
    }
    if (JSON.stringify(outcome.targetsAfterClose) !== '[]') {
      failures.push(`close left live connections: ${JSON.stringify(outcome.targetsAfterClose)}`);
    }
    for (const name of ['endpointId', 'appliedRelayUrls', 'stream']) {
      const observed = String(outcome[`${name}AfterClose`] ?? '');
      if (!observed.includes('endpoint_closed')) {
        failures.push(`${name} after close did not fail endpoint_closed: ${observed}`);
      }
    }
    // A7.1 item 5 — the generated `free` is terminal custody for the Rust probe,
    // not a detach that strands a live endpoint behind a pending Promise.
    if (!freedHeldObserved) {
      failures.push(
        'the real Home never received the implicit-release request, so `free` was never tested against a pending operation',
      );
    }
    if (homeA.application.requests <= heldRequestsBeforeFree) {
      failures.push('the implicit-release request never reached Home A');
    }
    if (outcome.freedStillInFlightBeforeFree !== true) {
      failures.push('the implicit-release check did not observe a genuinely pending operation');
    }
    if (!/^rejected:/u.test(String(outcome.freedOutcome))) {
      failures.push(
        `releasing the probe wrapper did not release its pending operation: ${outcome.freedOutcome}`,
      );
    } else if (!/cancel|close/iu.test(String(outcome.freedOutcome))) {
      failures.push(
        `the pending operation failed for another reason after the wrapper was freed: ${outcome.freedOutcome}`,
      );
    }
    if (!(outcome.freedMs < 2000)) {
      failures.push(
        `releasing the probe wrapper took ${Math.round(outcome.freedMs)}ms to release the pending operation`,
      );
    }
    if (!(freedHomeConnectionsBeforeFree >= 1)) {
      failures.push(
        `the real Home was not holding the freed probe's connection before the free (connectionsActive=${freedHomeConnectionsBeforeFree}), so its release proves nothing`,
      );
    }
    if (!freedHomeConnectionsAfterFree) {
      failures.push(
        "the real Home's connection to the freed probe outlived it: the browser endpoint's connections were not released",
      );
    }
    if (outcome.freedProbeStillUsable === 'unexpectedly succeeded') {
      failures.push('the freed probe wrapper was still usable from JS');
    }
    if (freedReleasedHeld < 1) {
      failures.push('no withheld response was released after the free, so late completion was never tested');
    }
    if (outcome.freedOutcomeAfterLateResponse !== outcome.freedOutcome) {
      failures.push(
        `the Home's late response changed a freed operation's outcome to ${outcome.freedOutcomeAfterLateResponse}`,
      );
    }

    // Chromium reports every failed WebSocket handshake as a console error, and
    // the wrong-relay check deliberately produces those against the decoy
    // server. Only errors that do not name the decoy are unexpected.
    const decoyConsoleErrors = consoleErrors.filter((text) => text.includes(decoyAuthority));
    const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes(decoyAuthority));
    if (unexpectedConsoleErrors.length > 0) {
      failures.push(`browser errors: ${unexpectedConsoleErrors.join(' | ')}`);
    }

    const report = {
      chromiumBuild,
      relayUrl,
      homeEndpointIds: { a: homeA.endpointId, b: homeB.endpointId },
      absentEndpointId,
      browserEndpointId: bound.endpointId,
      appliedRelayUrls: bound.appliedRelayUrls,
      advertisedInboundAlpns: bound.advertisedInboundAlpns,
      nativeInboundRejection: {
        home: inboundHome.timedOut ? 'timed out' : inboundHome.envelope,
        machine: inboundMachine.timedOut ? 'timed out' : inboundMachine.envelope,
      },
      homeApplicationRequests: { a: homeA.application.requests, b: homeB.application.requests },
      concurrentTargets: outcome.concurrentTargets,
      appliedRelayUrlsAfterTargetHints: outcome.appliedRelayUrlsAfterTargetHints,
      dials: {
        forConcurrentHomes: outcome.dialsForConcurrentHomes,
        afterReuse: outcome.dialsAfterReuse,
        afterRacedSameTarget: outcome.dialsAfterRacedSameTarget,
      },
      streamsOpened: outcome.streamsAfterConcurrentHomes,
      incrementalStream: {
        authenticatedRemoteEndpointId: outcome.incrementalRemoteEndpointId,
        reachedHomeA: outcome.incrementalResponse.includes(HOME_A_MARKER),
        readAfterIdempotentClose: outcome.incrementalReadAfterClose,
        heldReadObservedByHome: incrementalHeldObserved,
        heldReadStillInFlightBeforeCancel: outcome.incrementalHeldStillInFlightBeforeCancel,
        heldReadCancelOutcome: outcome.incrementalHeldCancelOutcome,
        heldReadCancelMs: Math.round(outcome.incrementalHeldCancelMs),
        heldResponsesReleasedLate: incrementalReleasedHeld,
        heldReadOutcomeAfterLateResponse: outcome.incrementalHeldOutcomeAfterLateResponse,
      },
      machineCarrierStream: {
        target: homeA.endpointId,
        authenticatedRemoteEndpointId: outcome.machineRemoteEndpointId,
        observedPath: outcome.machineObservedPath,
        dialsForMachineProtocol: outcome.machineDials,
        admissionDecision: outcome.machineAdmissionDecision,
        admissionRequests: machineAdmission.requests,
        applicationResponse: outcome.machineApplicationResponse,
        targetsWhileOpen: outcome.machineTargetsWhileOpen,
        homeTunnelStillUsable: String(outcome.homeAfterMachineStream ?? '').includes(HOME_A_MARKER),
        // What this gate does NOT prove: the admission responder here stands in
        // for the daemon's machine-admission owner, so the signed V2 grant is
        // not verified. Production activation still requires that owner to
        // validate the grant, plus transfer routing selecting this carrier.
        remainingProductionGate:
          'daemon admission owner verifies the signed V2 grant; transfer routing selects the browser machine carrier',
      },
      timings: {
        wasmInitMs: Math.round(bound.initMs),
        endpointCreateMs: Math.round(bound.createMs),
        firstStreamMs: Math.round(outcome.firstStreamMs),
        pendingCancelMs: Math.round(outcome.pendingCancelMs),
      },
      memory: {
        wasmLinearBeforeEndpointBytes: bound.linearMemoryBeforeEndpointBytes,
        wasmLinearAfterEndpointBytes: bound.linearMemoryAfterEndpointBytes,
        wasmLinearAfterStreamsBytes: outcome.linearMemoryAfterStreamsBytes,
        wasmLinearAfterCloseBytes: outcome.linearMemoryAfterCloseBytes,
      },
      perTargetRelayFacts: {
        decoyRelayUrl,
        cachedCredentialHintOutcome: outcome.cachedCredentialHintOutcome,
        cachedEmptyHintOutcome: outcome.cachedEmptyHintOutcome,
        dialsAfterRejectedHints: outcome.dialsAfterRejectedHints,
        decoyHintOutcome: outcome.decoyHintOutcome,
        decoyCancelOutcome: outcome.decoyCancelOutcome,
        appliedRelayUrlsAfterDecoy: outcome.appliedRelayUrlsAfterDecoy,
        refreshedHintsReachedHomeB: outcome.refreshedHintsB.includes(HOME_B_MARKER),
        decoyRelayConsoleErrors: decoyConsoleErrors,
      },
      cancellation: {
        pendingStillInFlightBeforeCancel: outcome.pendingStillInFlightBeforeCancel,
        pendingCancelOutcome: outcome.pendingCancelOutcome,
        targetsAfterCancel: outcome.targetsAfterCancel,
        reusedAfterCancel: outcome.afterCancel.includes(HOME_A_MARKER),
        heldRequestObservedByHome: heldObserved,
        heldStillInFlightBeforeCancel: outcome.heldStillInFlightBeforeCancel,
        heldCancelOutcome: outcome.heldCancelOutcome,
        heldCancelMs: Math.round(outcome.heldCancelMs),
        heldResponsesReleasedLate: releasedHeld,
        heldOutcomeAfterLateResponse: outcome.heldOutcomeAfterLateResponse,
        otherTargetUsableAfterHeldCancel:
          outcome.otherTargetAfterHeldCancel.includes(HOME_B_MARKER),
      },
      terminalClose: {
        closed: outcome.closed,
        closedAfterSecondClose: outcome.closedAfterSecondClose,
        endpointIdAfterClose: outcome.endpointIdAfterClose,
        appliedRelayUrlsAfterClose: outcome.appliedRelayUrlsAfterClose,
        streamAfterClose: outcome.streamAfterClose,
      },
      implicitRelease: {
        browserEndpointId: freedBinding.endpointId,
        heldRequestObservedByHome: freedHeldObserved,
        stillInFlightBeforeFree: outcome.freedStillInFlightBeforeFree,
        freeOutcome: outcome.freedOutcome,
        freeMs: Math.round(outcome.freedMs),
        homeConnectionsActiveBeforeFree: freedHomeConnectionsBeforeFree,
        homeConnectionsReleasedAfterFree: freedHomeConnectionsAfterFree,
        freedProbeStillUsable: outcome.freedProbeStillUsable,
        heldResponsesReleasedLate: freedReleasedHeld,
        outcomeAfterLateResponse: outcome.freedOutcomeAfterLateResponse,
      },
      artifacts: built.measurements,
    };
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
    if (failures.length > 0) {
      bail(`browser-iroh live gate FAILED:\n  ${failures.join('\n  ')}`);
    }
    process.stdout.write(
      '\nbrowser-iroh live gate: PASS (real Chromium → configured relay → two real Home acceptors)\n',
    );
  } finally {
    await cleanup();
  }
}

await main();
