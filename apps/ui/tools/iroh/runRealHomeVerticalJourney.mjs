// Lane 06 amendment A7.3 — the REAL browser Home vertical journey.
//
// This is the completion stage of the one Chromium proof harness. Where
// `runProductionCarrierPageSeam.mjs` proves the Metro-built page carries and
// runs the production owners, this stage puts a real stock relay and a real
// Home acceptor in front of them and drives the amendment's journey:
//
//   real Chromium
//     → production `browserIrohHomeCarrierOwner` (SharedWorker endpoint, wasm)
//     → happier/home-tunnel/1 over the exact configured relay
//     → the real `startHomeAcceptor`
//     → the Home's own HTTP + Engine.IO server
//
// The relay and the acceptor are the production owners, supplied by the one
// shared native fixture (`packages/iroh-native/scripts/browserIrohNativeHomeFixture.mjs`)
// the A7.1/I10 live gate uses. The only fixture part is the loopback application
// behind the acceptor: a real `node:http` server with a real Engine.IO server
// attached, which is what a Home exposes to its acceptor. Nothing internal to
// the carrier, `serverFetch`, or the Socket.IO owner is stubbed — the browser
// side is entirely production code, reached through the packaged assets.
//
// The Home is ingress-less by construction: its canonical URL is a `.invalid`
// origin that resolves nowhere, and the journey proves that with the browser's
// own `fetch` before trusting a single carried byte.
//
// A verdict is PASS only when every observation in `REQUIRED_A73_OBSERVATIONS`
// was actually recorded true. A stage that never ran cannot pass.
import { createServer } from 'node:http';

import { attach } from 'engine.io';

import {
  buildAndLoadBrowserIrohTestAddon,
  createBrowserIrohNativeHomeFixture,
  listen,
  waitFor,
} from '../../../../packages/iroh-native/scripts/browserIrohNativeHomeFixture.mjs';
import { ensureProductionCarrierSeamBundle } from './runProductionCarrierPageSeam.mjs';

/**
 * The A7.3 completion observations, in the amendment's own terms. Every one of
 * them must be recorded true by a run before it may print PASS.
 */
export const REQUIRED_A73_OBSERVATIONS = [
  'exactRelayToIngresslessHome',
  'authenticatedHttpThroughCarrier',
  'liveSocketIoEventThroughCarrier',
  'reconnectAfterCarrierAcceptorRestartWithoutDuplicateEvent',
  'mismatchedEndpointIdSendsNoApplicationBytes',
  'browserReportsRelayOrUnknownOnly',
  'abortedHttpCancelsPromptlyAndNeverCompletesLate',
  'releaseClosesHomeStreamsAndConnections',
];

/** The production seam page commands this journey drives. */
export const REQUIRED_JOURNEY_PAGE_COMMANDS = [
  'acquireCarrier',
  'probeCanonicalOrigin',
  'httpRequest',
  'readHttpOutcome',
  'openSocket',
  'readSocket',
  'emitSocket',
  'reconnectSocket',
  'destroySocket',
  'releaseCarrier',
];

/** The Home this journey adopts. `.invalid` never resolves (RFC 2606). */
const CANONICAL_HOME_URL = 'https://a73-ingressless-home.happier.invalid';
const HOME_IDENTITY = 'srv_a73_ingressless_home';
/** A second adopted-Home identity pointed at an EndpointId that is not the Home's. */
const WRONG_ENDPOINT_IDENTITY = 'srv_a73_wrong_endpoint';
const HOME_TOKEN = 'a73-home-token';

const SESSIONS_PATH = '/v1/sessions';
/** Requests here are received by the Home in full and left unanswered. */
const HOLD_PATH = '/v1/hold';

/** A request the carrier must cancel is aborted this long after it starts. */
const ABORT_AFTER_MS = 1_500;
/** How long an aborted or misaddressed request may still be given to settle. */
const CANCELLED_SETTLE_BUDGET_MS = 6_000;
/** A request that must NOT reach a Home is given this long to prove it cannot. */
const MUST_NOT_COMPLETE_MS = 8_000;
/** How long the journey waits for a Home-side or browser-side state change. */
const OBSERVE_TIMEOUT_MS = 20_000;
/**
 * The bound on any one page command.
 *
 * `page.evaluate` has no timeout of its own, so a carrier call that never
 * settles would hang the whole gate silently instead of failing it. A command
 * that carries its own `giveUpAfterMs` resolves well inside this; anything that
 * does not is a defect, and this turns it into a named failure at the exact
 * command rather than a stalled run with no verdict.
 */
const PAGE_COMMAND_TIMEOUT_MS = 60_000;
/** Settling time after the Home releases a held response, before re-reading it. */
const LATE_COMPLETION_WATCH_MS = 2_500;

function bail(message) {
  throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one page command and returns its JSON-safe reply.
 *
 * Bounded on purpose: a command that never settles is reported as a failure
 * naming itself, so the gate cannot stall without a verdict. The bound is
 * generous enough that no correct command can be cut short — the longest
 * deliberate wait a command carries is `MUST_NOT_COMPLETE_MS`.
 */
async function command(page, name, argument) {
  let timer = null;
  const evaluated = page.evaluate(
    ([commandName, commandArgument]) => window.__happierProductionCarrierSeam[commandName](commandArgument),
    [name, argument ?? null],
  );
  // A command that loses the race must not leave an unhandled rejection behind
  // when the page is torn down; the timeout is already the reported failure.
  evaluated.catch(() => {});
  try {
    return await Promise.race([
      evaluated,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`page command ${name} did not settle within ${PAGE_COMMAND_TIMEOUT_MS}ms`)),
          PAGE_COMMAND_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Runs one page command and fails the run if the page reported an error. */
async function requireCommand(page, name, argument) {
  const reply = await command(page, name, argument);
  if (reply?.ok !== true) {
    bail(`page command ${name} failed: ${JSON.stringify(reply)}`);
  }
  return reply;
}

/**
 * One Home: a real `node:http` server with a real Engine.IO server attached —
 * the shape a Home exposes to its Iroh acceptor — plus the counters that make
 * "the Home really saw this" an observation instead of an inference.
 */
function startHomeApplication() {
  const state = {
    requests: [],
    authorizations: [],
    held: [],
    handshakePackets: [],
    engineConnections: 0,
    engineDisconnects: 0,
    updatesSent: 0,
  };

  const server = createServer((request, response) => {
    state.requests.push({ method: request.method, url: request.url });
    state.authorizations.push(request.headers.authorization ?? null);
    if (request.url === SESSIONS_PATH) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ sessions: [{ id: 'session-1' }] }));
      return;
    }
    if (request.url === HOLD_PATH) {
      // Received in full, deliberately unanswered: a genuinely pending request
      // the Home is really holding, which is what a cancellation contract has
      // to be proven against.
      state.held.push(response);
      return;
    }
    response.writeHead(404).end();
  });
  // The carrier half-closes its write side once the request is written, as any
  // bounded HTTP client does. Node would otherwise end the response side with
  // it, and a withheld response could never actually be held open.
  server.httpAllowHalfOpen = true;

  // The same Engine.IO server and the same hand-rolled Socket.IO replies the
  // owner-level production Home vertical test uses, so both prove the client
  // against one description of Home's wire behavior. Engine.IO has already
  // removed its MESSAGE prefix here, so Socket.IO EVENT packets arrive as
  // `2[...]`, not `42[...]`.
  const engine = attach(server, { path: '/v1/updates/' });
  engine.on('connection', (connected) => {
    state.engineConnections += 1;
    connected.on('close', () => { state.engineDisconnects += 1; });
    connected.on('message', (raw) => {
      const packet = typeof raw === 'string' ? raw : raw.toString('utf8');
      state.handshakePackets.push(packet);
      if (packet.startsWith('0')) connected.send('0{"sid":"a73-home-side-sid"}');
      if (packet.startsWith('2')) {
        // Each delivery carries its own sequence number, so a duplicate is
        // visible as a repeated `seq` rather than hidden behind equal payloads.
        state.updatesSent += 1;
        connected.send(`2["update",{"seq":${state.updatesSent}}]`);
      }
    });
  });

  state.server = server;
  state.engine = engine;
  /** Drops every live Engine.IO connection: the Home's side of a socket drop. */
  state.dropSocketConnections = () => {
    const clients = Object.values(engine.clients ?? {});
    for (const client of clients) {
      try {
        client.close(true);
      } catch {
        // Already gone; the drop is still what this asked for.
      }
    }
    return clients.length;
  };
  state.releaseHeld = () => {
    const held = state.held.splice(0);
    for (const response of held) {
      try {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('held-response-released');
      } catch {
        // The carrier cancelled and its loopback socket may already be gone,
        // which is not a failure of this write.
      }
    }
    return held.length;
  };
  return state;
}

/**
 * Decides the verdict from what a run actually observed.
 *
 * This is the false-PASS guard: PASS requires every required observation to be
 * present AND true, and no failure. A run that threw, exited a stage early, or
 * simply never reached an observation cannot reach PASS by staying quiet.
 */
export function evaluateRealHomeVerticalJourney({ observations = {}, failures = [] }) {
  const reasons = [];
  for (const name of REQUIRED_A73_OBSERVATIONS) {
    if (!(name in observations)) {
      reasons.push(`observation never ran: ${name}`);
      continue;
    }
    if (observations[name] !== true) reasons.push(`observation failed: ${name}`);
  }
  reasons.push(...failures);
  return { verdict: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
}

/**
 * Preserve useful authentication evidence without copying Home bearer values
 * or Socket.IO authentication payloads into CI and terminal artifacts.
 */
export function summarizeHomeAuthenticationEvidence({ authorizations, handshakePackets }) {
  return {
    authenticatedHttpRequestCount: authorizations.length,
    socketHandshakePacketCount: handshakePackets.length,
    socketConnectPacketCount: handshakePackets.filter((packet) => packet.startsWith('0')).length,
    socketEventPacketCount: handshakePackets.filter((packet) => packet.startsWith('2')).length,
  };
}

/**
 * Runs the A7.3 journey.
 *
 * `openJourneyPage` is supplied by the harness and returns a real Chromium page
 * already at the Metro-built production seam page. Everything native, the Home,
 * and the relay are owned here and released in `finally`.
 */
export async function runRealHomeVerticalJourney({ webOutputRoot, openJourneyPage, pageErrors }) {
  const failures = [];
  const observations = {};
  const report = {};

  /** Records one observation and, when it is false, why. */
  const observe = (name, ok, detail) => {
    observations[name] = ok === true;
    report[name] = detail;
    if (ok !== true) failures.push(`${name}: ${JSON.stringify(detail)}`);
  };

  // 1. The page: built and graph-checked by the same owner the loaded seam uses.
  const built = await ensureProductionCarrierSeamBundle({ webOutputRoot });
  report.pageBundle = built.report;

  // 2. The real native side: current-source addon, the one local test relay, and
  //    one real Home acceptor in front of the Home application.
  const { addon, addonPath } = buildAndLoadBrowserIrohTestAddon();
  const home = startHomeApplication();
  let fixture = null;
  let socketOpen = false;
  const acquiredCarriers = [];

  try {
    const homePort = await listen(home.server);
    fixture = await createBrowserIrohNativeHomeFixture({ addon });
    const homeEndpoint = await fixture.startHome({ label: 'a73-home', targetPort: homePort });
    // A well-formed EndpointId that is not this Home's: a real endpoint, taken
    // down again. Nothing the browser addresses to it can ever be answered by
    // the Home, and Iroh will not let anything else answer for it either.
    const wrongEndpointId = await fixture.mintAbsentEndpointId('a73-wrong-endpoint');

    report.identities = {
      addonPath,
      relayUrl: fixture.relayUrl,
      homeEndpointId: homeEndpoint.endpointId,
      wrongEndpointId,
      homeApplicationPort: homePort,
      canonicalServerUrl: CANONICAL_HOME_URL,
    };

    const page = await openJourneyPage();

    // 3. The Home is genuinely ingress-less: the browser's own HTTP stack
    //    cannot reach the origin every carried byte is addressed to.
    const canonicalProbe = await requireCommand(page, 'probeCanonicalOrigin', CANONICAL_HOME_URL);
    const carrier = await requireCommand(page, 'acquireCarrier', {
      homeServerIdentityId: HOME_IDENTITY,
      endpointId: homeEndpoint.endpointId,
      relayUrls: [fixture.relayUrl],
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
    });
    acquiredCarriers.push(HOME_IDENTITY);
    observe(
      'exactRelayToIngresslessHome',
      canonicalProbe.reachable === false
        && carrier.endpointId === homeEndpoint.endpointId
        && Array.isArray(carrier.appliedRelayUrls)
        && carrier.appliedRelayUrls.includes(fixture.relayUrl)
        && home.requests.length === 0,
      {
        canonicalOriginReachable: canonicalProbe.reachable,
        canonicalOriginError: canonicalProbe.error,
        carrierEndpointId: carrier.endpointId,
        configuredRelayUrl: fixture.relayUrl,
        appliedRelayUrls: carrier.appliedRelayUrls,
        homeRequestsBeforeAnyCarriedByte: home.requests.length,
      },
    );

    // 4. Authenticated HTTP through the production carrier to the real Home.
    const httpReply = await requireCommand(page, 'httpRequest', {
      homeServerIdentityId: HOME_IDENTITY,
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
      path: SESSIONS_PATH,
    });
    observe(
      'authenticatedHttpThroughCarrier',
      httpReply.settled === 'resolved'
        && httpReply.status === 200
        && httpReply.bodyText === JSON.stringify({ sessions: [{ id: 'session-1' }] })
        && home.requests.some((request) => request.url === SESSIONS_PATH)
        && home.authorizations.includes(`Bearer ${HOME_TOKEN}`),
      {
        status: httpReply.status,
        bodyText: httpReply.bodyText,
        observedPath: httpReply.observedPath,
        homeRequests: home.requests,
        authenticationEvidence: summarizeHomeAuthenticationEvidence({
          authorizations: home.authorizations,
          handshakePackets: home.handshakePackets,
        }),
      },
    );

    // 5. The browser reports only what a relay-only carrier can prove.
    const observedPaths = [carrier.observedPath, httpReply.observedPath];
    observe(
      'browserReportsRelayOrUnknownOnly',
      httpReply.observedPath === 'relay'
        && observedPaths.every((path) => path === 'relay' || path === 'unknown'),
      { observedPathAfterAcquire: carrier.observedPath, observedPathAfterHttp: httpReply.observedPath },
    );

    // 6. A live Socket.IO session over the same carrier.
    await requireCommand(page, 'openSocket', {
      homeServerIdentityId: HOME_IDENTITY,
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
    });
    socketOpen = true;
    const connected = await pollSocket(page, (state) => state.connected === true, OBSERVE_TIMEOUT_MS);
    await requireCommand(page, 'emitSocket', 'ping-me');
    const withUpdate = await pollSocket(page, (state) => state.updates.length >= 1, OBSERVE_TIMEOUT_MS);
    const expectedSocketUri = `${CANONICAL_HOME_URL.replace('https:', 'wss:')}/v1/updates/?EIO=4&transport=websocket`;
    const firstHandshake = home.handshakePackets.find((packet) => packet.startsWith('0'));
    const liveSocket = await readSocket(page);
    observe(
      'liveSocketIoEventThroughCarrier',
      connected === true
        && withUpdate === true
        && liveSocket.updates.length === 1
        && liveSocket.requestedUris.length === 1
        && liveSocket.requestedUris.every((uri) => uri === expectedSocketUri)
        && typeof firstHandshake === 'string'
        && JSON.parse(firstHandshake.slice(1))?.token === HOME_TOKEN
        && home.engineConnections === 1,
      {
        socket: liveSocket,
        expectedSocketUri,
        homeEngineConnections: home.engineConnections,
        authenticationEvidence: summarizeHomeAuthenticationEvidence({
          authorizations: home.authorizations,
          handshakePackets: home.handshakePackets,
        }),
      },
    );

    // 7. The fixture drops the socket and restarts its carrier acceptor; the existing
    //    socket owner reconnects over a fresh carrier stream, and nothing is
    //    replayed or delivered twice.
    const updatesBeforeDrop = (await readSocket(page)).updates;
    home.dropSocketConnections();
    await fixture.stopHomeAcceptor(homeEndpoint);
    const sawDisconnect = await pollSocket(
      page,
      (state) => state.connected === false && state.disconnects.length >= 1,
      OBSERVE_TIMEOUT_MS,
    );
    await fixture.restartHomeAcceptor(homeEndpoint);
    await requireCommand(page, 'reconnectSocket');
    const reconnected = await pollSocket(
      page,
      (state) => state.connected === true && state.connectCount >= 2,
      OBSERVE_TIMEOUT_MS,
    );
    // Nothing may arrive on the reconnected socket until something asks for it.
    await sleep(LATE_COMPLETION_WATCH_MS);
    const afterReconnect = await readSocket(page);
    await requireCommand(page, 'emitSocket', 'ping-me');
    await pollSocket(page, (state) => state.updates.length >= 2, OBSERVE_TIMEOUT_MS);
    const afterSecondEmit = await readSocket(page);
    const seqs = afterSecondEmit.updates.map((update) => update?.seq);
    observe(
      'reconnectAfterCarrierAcceptorRestartWithoutDuplicateEvent',
      sawDisconnect === true
        && reconnected === true
        && afterReconnect.updates.length === updatesBeforeDrop.length
        && afterSecondEmit.updates.length === 2
        && new Set(seqs).size === seqs.length
        && home.engineConnections === 2,
      {
        updatesBeforeDrop,
        disconnects: afterReconnect.disconnects,
        connectCount: afterSecondEmit.connectCount,
        updatesAfterReconnectBeforeEmit: afterReconnect.updates,
        updatesAfterSecondEmit: afterSecondEmit.updates,
        homeEngineConnections: home.engineConnections,
        homeUpdatesSent: home.updatesSent,
      },
    );

    // 8. An EndpointId that is not this Home's carries no application byte to
    //    it. Iroh authenticates the exact selected EndpointId, so a request
    //    addressed to another one can never be answered by this Home.
    const homeRequestsBeforeWrongEndpoint = home.requests.length;
    await requireCommand(page, 'acquireCarrier', {
      homeServerIdentityId: WRONG_ENDPOINT_IDENTITY,
      endpointId: wrongEndpointId,
      relayUrls: [fixture.relayUrl],
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
    });
    acquiredCarriers.push(WRONG_ENDPOINT_IDENTITY);
    const wrongEndpointReply = await requireCommand(page, 'httpRequest', {
      homeServerIdentityId: WRONG_ENDPOINT_IDENTITY,
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
      path: SESSIONS_PATH,
      giveUpAfterMs: MUST_NOT_COMPLETE_MS,
    });
    observe(
      'mismatchedEndpointIdSendsNoApplicationBytes',
      wrongEndpointReply.settled !== 'resolved'
        && home.requests.length === homeRequestsBeforeWrongEndpoint
        && !home.authorizations.slice(homeRequestsBeforeWrongEndpoint).includes(`Bearer ${HOME_TOKEN}`),
      {
        wrongEndpointId,
        outcome: wrongEndpointReply.settled,
        error: wrongEndpointReply.error,
        homeRequestsBefore: homeRequestsBeforeWrongEndpoint,
        homeRequestsAfter: home.requests.length,
      },
    );

    // 9. A request the Home really received and is really holding is aborted:
    //    it must fail promptly, and releasing the response afterwards must not
    //    complete it late.
    const connectionsBeforeHold = await fixture.homeConnectionsActive(homeEndpoint);
    const heldReply = await requireCommand(page, 'httpRequest', {
      homeServerIdentityId: HOME_IDENTITY,
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
      path: HOLD_PATH,
      abortAfterMs: ABORT_AFTER_MS,
      giveUpAfterMs: ABORT_AFTER_MS + CANCELLED_SETTLE_BUDGET_MS,
    });
    const homeHeldTheRequest = await waitFor(() => home.held.length > 0, OBSERVE_TIMEOUT_MS);
    const releasedHeld = home.releaseHeld();
    await sleep(LATE_COMPLETION_WATCH_MS);
    const afterRelease = await requireCommand(page, 'readHttpOutcome', heldReply.requestId);
    const connectionsAfterCancel = await waitFor(
      async () => (await fixture.homeConnectionsActive(homeEndpoint)) <= connectionsBeforeHold,
      OBSERVE_TIMEOUT_MS,
    );
    observe(
      'abortedHttpCancelsPromptlyAndNeverCompletesLate',
      homeHeldTheRequest === true
        && releasedHeld >= 1
        && heldReply.settled === 'rejected'
        && heldReply.elapsedMs < ABORT_AFTER_MS + CANCELLED_SETTLE_BUDGET_MS
        && afterRelease.settled === 'rejected'
        && afterRelease.settledAtMs === heldReply.settledAtMs
        && afterRelease.bodyText === undefined
        && connectionsAfterCancel === true,
      {
        homeHeldTheRequest,
        releasedHeldResponses: releasedHeld,
        outcomeAtAbort: { settled: heldReply.settled, elapsedMs: heldReply.elapsedMs, error: heldReply.error },
        outcomeAfterHomeReleasedIt: afterRelease,
        homeConnectionsActiveBeforeHold: connectionsBeforeHold,
        homeConnectionsActiveAfterCancel: await fixture.homeConnectionsActive(homeEndpoint),
      },
    );

    // 10. Release closes this Home's streams and connections. The socket is
    //     still open on purpose: release owns every stream the lease holds, and
    //     the Home must observe its live Socket.IO connection end.
    //
    //     The endpoint's own Iroh connection is NOT part of this observation:
    //     A7.2/A8 make the endpoint outlive its last lease deliberately, so the
    //     acceptor's `connectionsActive` is recorded as a fact rather than
    //     asserted to reach zero — asserting that would gate on behavior the
    //     amendment forbids.
    const connectionsBeforeRelease = await fixture.homeConnectionsActive(homeEndpoint);
    const engineDisconnectsBeforeRelease = home.engineDisconnects;
    await requireCommand(page, 'releaseCarrier', HOME_IDENTITY);
    acquiredCarriers.splice(acquiredCarriers.indexOf(HOME_IDENTITY), 1);
    const homeSawSocketClosed = await waitFor(
      () => home.engineDisconnects > engineDisconnectsBeforeRelease,
      OBSERVE_TIMEOUT_MS,
    );
    const socketAfterRelease = await readSocket(page);
    // The released carrier is gone from the page's owner map, so the production
    // request path has nothing left to run on.
    const requestAfterRelease = await command(page, 'httpRequest', {
      homeServerIdentityId: HOME_IDENTITY,
      canonicalServerUrl: CANONICAL_HOME_URL,
      token: HOME_TOKEN,
      path: SESSIONS_PATH,
      giveUpAfterMs: MUST_NOT_COMPLETE_MS,
    });
    observe(
      'releaseClosesHomeStreamsAndConnections',
      connectionsBeforeRelease > 0
        && homeSawSocketClosed === true
        && socketAfterRelease.connected === false
        && requestAfterRelease?.ok === false,
      {
        homeConnectionsActiveBeforeRelease: connectionsBeforeRelease,
        homeConnectionsActiveAfterRelease: await fixture.homeConnectionsActive(homeEndpoint),
        homeEngineDisconnects: home.engineDisconnects,
        socketConnectedAfterRelease: socketAfterRelease.connected,
        requestAfterRelease,
      },
    );

    if (pageErrors.length > 0) {
      failures.push(`browser page errors: ${pageErrors.join(' | ')}`);
    }

    // The socket owner is torn down through its own destroy path, after the
    // release observation has been made.
    if (socketOpen) {
      await command(page, 'destroySocket');
      socketOpen = false;
    }
    for (const identity of [...acquiredCarriers]) {
      await command(page, 'releaseCarrier', identity);
    }
    acquiredCarriers.length = 0;
  } finally {
    home.releaseHeld();
    home.dropSocketConnections();
    try {
      home.engine.close();
    } catch {
      // Already closed.
    }
    home.server.closeAllConnections?.();
    await new Promise((resolve) => home.server.close(resolve));
    if (fixture) await fixture.dispose();
  }

  const { verdict, reasons } = evaluateRealHomeVerticalJourney({ observations, failures });
  return { report, observations, failures: reasons, verdict };
}

async function readSocket(page) {
  const reply = await requireCommand(page, 'readSocket');
  return {
    connected: reply.connected === true,
    requestedUris: reply.requestedUris ?? [],
    updates: reply.updates ?? [],
    connectCount: reply.connectCount ?? 0,
    disconnects: reply.disconnects ?? [],
  };
}

/** Polls the page's socket state until `predicate` holds or the budget runs out. */
async function pollSocket(page, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate(await readSocket(page))) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}
