// Lane 06 amendment A7.4 — the real browser Machine carrier/admission journey.
//
// This is the Machine stage of the ONE Chromium proof harness. It reuses the
// A7.3 page, the A7.3 native relay/acceptor fixture, and the A7.3 runner, and
// adds only the other side of a transfer:
//
//   real Chromium
//     → production `resolveMachineCarrierRoute` (the transfer route owner)
//     → production browser machine carrier
//         · signed V2 grant minted by the CANONICAL server mint owner,
//           requested over the production Home carrier
//         · relay-only `happier/machine/1` dial on the one SharedWorker endpoint
//     → the real native `happier/machine/1` acceptor
//     → the CANONICAL daemon admission owner
//     → the machine's own loopback transfer application
//
// Nothing about acceptance is invented here. The acceptor is the production
// Rust one; the admission decision is `startPeerMediationLoopbackServer` with
// its `irohMachineAdmission` route (the same owner the daemon runs), which
// verifies the handshake, the signed grant, the endpoint binding and the role
// through `verifyMachineCarrierHandshakeV1`; and the grant is signed by
// `mintDirectRouteGrantV2` with a key resolved through
// `resolvePeerMediationGrantSigningConfig`. Both are loaded from source through
// isolated `tsx` namespaces, because each app resolves its own `@/` alias.
//
// The Home is ingress-less by construction, exactly as in A7.3: its canonical
// URL is a `.invalid` origin that resolves nowhere, so every byte the browser
// exchanges with it — including the grant request — could only have come over
// the Iroh carrier.
//
// A verdict is PASS only when every observation in `REQUIRED_A74_OBSERVATIONS`
// was actually recorded true. A stage that never ran cannot pass.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tweetnacl from 'tweetnacl';

import {
  buildAndLoadBrowserIrohTestAddon,
  createBrowserIrohNativeHomeFixture,
  listen,
  waitFor,
} from '../../../../packages/iroh-native/scripts/browserIrohNativeHomeFixture.mjs';
import { ensureProductionCarrierSeamBundle } from './runProductionCarrierPageSeam.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

/**
 * The A7.4 carrier/admission observations. Every one of
 * them must be recorded true by a run before it may print PASS.
 */
export const REQUIRED_A74_OBSERVATIONS = [
  'exactRelayToRealMachineAcceptor',
  'signedGrantBindsInitiatorTargetOperationFlowAndMaxBytes',
  'browserToMachineBytesWithIntegrity',
  'machineToBrowserBytesWithIntegrity',
  'abortedTransferCancelsPromptlyAndNeverCompletesLate',
  'wrongPeerRoleEndpointOrGrantRejectedBeforeApplicationBytes',
  'noUserSocketOrServerRelayFallbackAfterIrohSelection',
  'browserReportsRelayOnlyNeverDirect',
  'releaseClosesMachineStreamsAndConnections',
];

/** The production seam page commands this journey drives. */
export const REQUIRED_MACHINE_JOURNEY_PAGE_COMMANDS = [
  'seedMachineTransferHome',
  'publishMachineDescriptor',
  'resolveMachineRoute',
  'acquireMachineCarrier',
  'machineRequest',
  'readHttpOutcome',
  'releaseMachineCarrier',
];

/** The machine lifecycle this journey needs from the one shared native fixture. */
export const REQUIRED_MACHINE_FIXTURE_OPERATIONS = ['startMachine', 'machineAcceptorStatus'];

/**
 * The daemon side is canonical, not re-implemented. These paths are asserted by
 * the contract test so a future edit cannot quietly swap in a hand-rolled
 * acceptor or a hand-signed grant and still print PASS.
 */
export const CANONICAL_DAEMON_OWNERS = {
  admissionModule: 'apps/cli/src/daemon/peer/mediation/loopback/server.ts',
  grantMintModule: 'apps/server/sources/app/machines/peer/mediation/mintDirectRouteGrantV1.ts',
};

/** The Home this journey adopts. `.invalid` never resolves (RFC 2606). */
const CANONICAL_HOME_URL = 'https://a74-ingressless-home.happier.invalid';
const HOME_IDENTITY = 'srv_a74_ingressless_home';
const ACCOUNT_ID = 'account-a74-browser-machine';
const MACHINE_ID = 'machine-a74-target';
/** A machine id the acceptor does not own, published at the acceptor's endpoint. */
const IMPOSTOR_MACHINE_ID = 'machine-a74-impostor';
const GRANT_SIGNING_KEY_ID = 'a74-route-grant-key';
const TRANSFER_FLOW = 'file_transfer';
const TRANSFER_MAX_BYTES = 1_048_576;

const UPLOAD_PATH = '/v1/machine/transfer/upload';
const DOWNLOAD_PATH = '/v1/machine/transfer/download';
/** Requests here are received by the machine in full and left unanswered. */
const HOLD_PATH = '/v1/machine/transfer/hold';

/** A transfer that must be cancelled is aborted this long after it starts. */
const ABORT_AFTER_MS = 1_500;
/** How long an aborted transfer may still be given to settle. */
const CANCELLED_SETTLE_BUDGET_MS = 6_000;
/** A request that must NOT reach the machine is given this long to prove it. */
const MUST_NOT_COMPLETE_MS = 8_000;
/** How long the journey waits for a machine-side or browser-side state change. */
const OBSERVE_TIMEOUT_MS = 20_000;
/** The bound on any one page command; see the A7.3 journey for why it exists. */
const PAGE_COMMAND_TIMEOUT_MS = 60_000;
/** Settling time after the machine releases a held response, before re-reading. */
const LATE_COMPLETION_WATCH_MS = 2_500;

function bail(message) {
  throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/**
 * A token in the shape the production credential path parses: the account this
 * Home authenticated is read from the payload's `sub`, and the account the
 * canonical mint and the canonical admission owner both bind is that same one.
 */
function accountToken(accountId) {
  const payload = Buffer.from(JSON.stringify({ sub: accountId }), 'utf8').toString('base64');
  return `header.${payload}.signature`;
}

/**
 * Loads the canonical daemon admission owner and the canonical server grant
 * mint from source.
 *
 * `apps/cli` and `apps/server` each resolve `@/` to their own root, so they are
 * loaded through two isolated `tsx` namespaces rather than one global loader
 * that could only satisfy one of them.
 */
async function loadCanonicalDaemonOwners() {
  const { register } = await import('tsx/esm/api');
  const cli = register({
    namespace: 'happier-a74-cli',
    tsconfig: resolve(repoRoot, 'apps/cli/tsconfig.json'),
  });
  const server = register({
    namespace: 'happier-a74-server',
    tsconfig: resolve(repoRoot, 'apps/server/tsconfig.json'),
  });
  const [admission, mint] = await Promise.all([
    cli.import(resolve(repoRoot, CANONICAL_DAEMON_OWNERS.admissionModule), import.meta.url),
    server.import(resolve(repoRoot, CANONICAL_DAEMON_OWNERS.grantMintModule), import.meta.url),
  ]);
  if (typeof admission.startPeerMediationLoopbackServer !== 'function') {
    bail('the canonical daemon admission owner does not export startPeerMediationLoopbackServer');
  }
  if (typeof mint.mintDirectRouteGrantV2 !== 'function') {
    bail('the canonical server grant owner does not export mintDirectRouteGrantV2');
  }
  return { admission, mint };
}

/** Runs one page command; a command that never settles is a named failure. */
async function command(page, name, argument) {
  let timer = null;
  const evaluated = page.evaluate(
    ([commandName, commandArgument]) => window.__happierProductionCarrierSeam[commandName](commandArgument),
    [name, argument ?? null],
  );
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

async function requireCommand(page, name, argument) {
  const reply = await command(page, name, argument);
  if (reply?.ok !== true) {
    bail(`page command ${name} failed: ${JSON.stringify(reply)}`);
  }
  return reply;
}

/**
 * The Home this browser is signed in to: server features, the canonical V2
 * grant mint, and the counters that make "no ordinary fallback happened" an
 * observation rather than an inference.
 *
 * Only the HTTP shell is fixture; the grant itself is minted by the canonical
 * server owner with a key resolved by the canonical signing-config owner.
 */
function startHomeApplication({ mint, signingKey }) {
  const state = {
    requests: [],
    /** Every grant exchange, so a refusal names itself instead of being inferred. */
    grantExchanges: [],
    mintedGrants: [],
    mintRejections: [],
    /** Anything an ordinary server-relayed or user-socket transfer would touch. */
    fallbackTransferRequests: [],
    socketUpgrades: 0,
  };

  const signing = mint.resolvePeerMediationGrantSigningConfig({
    HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: GRANT_SIGNING_KEY_ID,
    HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: base64Url(signingKey.secretKey),
  });
  if (!signing.ok) {
    bail(`the canonical grant signing config rejected the journey key: ${JSON.stringify(signing)}`);
  }

  const features = {
    features: {
      machines: {
        enabled: true,
        transfer: {
          enabled: true,
          directPeer: { enabled: true },
          serverRouted: { enabled: false },
        },
      },
    },
  };

  const server = createServer((request, response) => {
    const url = new URL(String(request.url ?? '/'), 'http://home.invalid').pathname;
    state.requests.push({ method: request.method, url });
    if (request.headers.upgrade) state.socketUpgrades += 1;
    // Any ordinary transfer path is a fallback this gate forbids after the
    // Iroh route was selected, so it is recorded rather than served.
    if (/^\/v1\/(transfers|files|updates)/u.test(url)) {
      state.fallbackTransferRequests.push({ method: request.method, url });
      response.writeHead(404).end();
      return;
    }
    if (url === '/v1/features' || url === '/v1/features/authenticated') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(features));
      return;
    }
    if (url === '/v1/machines/peer/mediation/route-grants' && request.method === 'POST') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (error) {
          state.grantExchanges.push({ outcome: 'unparseable_request', detail: String(error) });
          response.writeHead(400).end();
          return;
        }
        // The canonical server mint, with exactly the client-supplied binding.
        // The journey never edits the binding: a grant that does not bind what
        // the browser asked for is a defect this gate must be able to see.
        const minted = mint.mintDirectRouteGrantV2({
          accountId: ACCOUNT_ID,
          machineId: body.machineId,
          flowKind: body.flowKind,
          routeKind: body.routeKind,
          scope: body.scope,
          ...(body.endpointFingerprint ? { endpointFingerprint: body.endpointFingerprint } : {}),
          nowMs: Date.now(),
          ttlMs: body.ttlMs,
          serverGateEnabled: true,
          signingKey: {
            keyId: signing.keyId,
            secretKey: signing.secretKey,
            expiresAt: signing.capability.expiresAt,
          },
          ...(body.iroh ? { iroh: body.iroh } : {}),
          ephemeralPublicKeyBase64Url: body.ephemeralPublicKeyBase64Url,
        });
        if (!minted.ok) {
          state.mintRejections.push({ request: body, reasonCode: minted.reasonCode });
          state.grantExchanges.push({ outcome: 'mint_rejected', reasonCode: minted.reasonCode, request: body });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ v: 2, ok: false, reasonCode: minted.reasonCode }));
          return;
        }
        state.mintedGrants.push(minted.grant);
        state.grantExchanges.push({ outcome: 'minted', grantId: minted.grant.payload.grantId });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ v: 2, ok: true, grant: minted.grant }));
      });
      return;
    }
    response.writeHead(404).end();
  });
  server.httpAllowHalfOpen = true;

  state.server = server;
  state.trustRoots = [{ keyId: signing.keyId, publicKey: signing.capability.publicKey }];
  return state;
}

/**
 * The machine's own loopback transfer application: the local owner the daemon's
 * admission response selects for an already-verified stream. It is the only
 * place application bytes can appear, which is what makes "no application byte
 * reached the machine" observable for every rejection case.
 */
function startMachineApplication({ downloadPayload }) {
  const state = {
    requests: [],
    uploads: [],
    held: [],
    openConnections: 0,
    closedConnections: 0,
  };

  const server = createServer((request, response) => {
    const url = String(request.url ?? '');
    state.requests.push({ method: request.method, url });
    if (url === UPLOAD_PATH && request.method === 'POST') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const received = Buffer.concat(chunks);
        state.uploads.push({ byteLength: received.byteLength, sha256: sha256(received) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ received: received.byteLength, sha256: sha256(received) }));
      });
      return;
    }
    if (url === DOWNLOAD_PATH) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(downloadPayload.byteLength),
      });
      response.end(downloadPayload);
      return;
    }
    if (url === HOLD_PATH) {
      // Received in full, deliberately unanswered: a genuinely pending transfer
      // the machine is really holding, which is what a cancellation contract
      // has to be proven against.
      state.held.push(response);
      return;
    }
    response.writeHead(404).end();
  });
  server.httpAllowHalfOpen = true;
  server.on('connection', (socket) => {
    state.openConnections += 1;
    socket.on('close', () => { state.closedConnections += 1; });
  });

  state.server = server;
  state.releaseHeld = () => {
    const held = state.held.splice(0);
    for (const response of held) {
      try {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('held-transfer-released');
      } catch {
        // The carrier cancelled and its loopback socket may already be gone.
      }
    }
    return held.length;
  };
  return state;
}

/**
 * Decides the verdict from what a run actually observed. PASS requires every
 * required observation to be present AND true, and no failure.
 */
export function evaluateBrowserMachineTransferJourney({ observations = {}, failures = [] }) {
  const reasons = [];
  for (const name of REQUIRED_A74_OBSERVATIONS) {
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
 * Runs the A7.4 carrier/admission journey. The finite-transfer certification
 * journey additionally owns prepare/chunks/finalize/receipt and destination
 * effects through the canonical direct import/export owners.
 *
 * `openJourneyPage` is supplied by the harness and returns a real Chromium page
 * already at the Metro-built production seam page. Everything native, the Home,
 * the machine, the admission server and the relay are owned here and released
 * in `finally`.
 */
export async function runBrowserMachineTransferJourney({ webOutputRoot, openJourneyPage, pageErrors }) {
  const failures = [];
  const observations = {};
  const report = {};

  const observe = (name, ok, detail) => {
    observations[name] = ok === true;
    report[name] = detail;
    if (ok !== true) failures.push(`${name}: ${JSON.stringify(detail)}`);
  };

  // 1. The page: built and graph-checked by the same owner A7.3 uses.
  const built = await ensureProductionCarrierSeamBundle({ webOutputRoot });
  report.pageBundle = built.report;

  // 2. The canonical daemon owners, from current source.
  const { admission: admissionOwner, mint } = await loadCanonicalDaemonOwners();

  // 3. The real native side: current-source addon, the one local test relay, a
  //    real Home acceptor and a real machine/1 acceptor.
  const { addon, addonPath } = buildAndLoadBrowserIrohTestAddon({
    extraOperations: ['startMachineAcceptor', 'stopMachineAcceptor', 'getMachineAcceptorStatus'],
  });
  const signingKey = tweetnacl.sign.keyPair();
  const home = startHomeApplication({ mint, signingKey });
  const downloadPayload = Buffer.from(
    Array.from({ length: 64 * 1024 }, (_value, index) => (index * 37 + 11) % 251),
  );
  const machine = startMachineApplication({ downloadPayload });
  const uploadPayload = Buffer.from(
    Array.from({ length: 48 * 1024 }, (_value, index) => (index * 53 + 7) % 241),
  );

  let fixture = null;
  let admissionServer = null;
  const acquiredLeaseKeys = [];

  try {
    const homePort = await listen(home.server);
    const machinePort = await listen(machine.server);
    fixture = await createBrowserIrohNativeHomeFixture({ addon });
    const homeEndpoint = await fixture.startHome({ label: 'a74-home', targetPort: homePort });

    // The canonical daemon admission owner, bound to this machine's identity.
    // It is what decides every admission; the fixture only carries the bytes.
    const machineTarget = await fixture.startMachine({
      label: 'a74-machine',
      resolveAdmissionPort: async (machineEndpointId) => {
        admissionServer = await admissionOwner.startPeerMediationLoopbackServer({
          nowMs: () => Date.now(),
          expected: {
            accountId: ACCOUNT_ID,
            machineId: MACHINE_ID,
            flowKind: 'bounded_transfer',
            routeKind: 'loopback_direct',
            endpointFingerprint: machineEndpointId,
          },
          trustRoots: home.trustRoots,
          endpointExpiresAt: Date.now() + 3_600_000,
          irohMachineAdmission: {
            localEndpointId: machineEndpointId,
            role: 'acceptor',
            allowedFlows: [TRANSFER_FLOW],
            // The already-verified stream's local owner. The peer never names a
            // destination; this is the machine's own transfer application.
            resolveApplicationTarget: () => ({ port: machinePort }),
          },
        });
        return Number(new URL(admissionServer.url).port);
      },
    });

    report.identities = {
      addonPath,
      relayUrl: fixture.relayUrl,
      homeEndpointId: homeEndpoint.endpointId,
      machineEndpointId: machineTarget.endpointId,
      admissionUrl: admissionServer?.url ?? null,
      homeApplicationPort: homePort,
      machineApplicationPort: machinePort,
      canonicalServerUrl: CANONICAL_HOME_URL,
      grantSigningKeyId: GRANT_SIGNING_KEY_ID,
    };

    const page = await openJourneyPage();
    const token = accountToken(ACCOUNT_ID);

    // 4. This browser is signed in to the ingress-less Home and knows the target
    //    machine's published Iroh endpoint — through the production adoption,
    //    credential, machine-state and runtime-origin owners.
    const seeded = await requireCommand(page, 'seedMachineTransferHome', {
      homeServerIdentityId: HOME_IDENTITY,
      canonicalServerUrl: CANONICAL_HOME_URL,
      homeEndpointId: homeEndpoint.endpointId,
      homeRelayUrls: [fixture.relayUrl],
      token,
      machineId: MACHINE_ID,
      machineEndpointId: machineTarget.endpointId,
      machineRelayUrls: [fixture.relayUrl],
    });
    report.seed = seeded;
    if (seeded.publishedHomeCarrier !== true) {
      bail(`the production runtime-origin owner refused the Home carrier: ${JSON.stringify(seeded)}`);
    }

    // 5. The production transfer route selects the relay-only browser machine
    //    carrier. Anything else means Iroh was never selected at all.
    // Server-feature discovery is an ordinary asynchronous Home request, so the
    // first decision a freshly seeded browser makes can legitimately precede it.
    // The route is polled until it settles, exactly as an app screen would wait,
    // rather than being read once and called `standard`.
    let route = null;
    const routeDeadline = Date.now() + OBSERVE_TIMEOUT_MS;
    for (;;) {
      route = await requireCommand(page, 'resolveMachineRoute', {
        machineId: MACHINE_ID,
        serverId: seeded.serverId,
      });
      if (route.kind === 'iroh_peer' || Date.now() >= routeDeadline) break;
      await sleep(500);
    }
    report.machineRoute = route;
    if (route.kind !== 'iroh_peer' || route.carrierKind !== 'browser_stream') {
      bail(`the production route did not select the browser machine carrier: ${JSON.stringify(route)}`);
    }

    // 6. One admitted machine carrier: minted grant over the Home carrier, then
    //    the relay-only machine/1 dial admitted by the canonical daemon owner.
    const machineRequestsBeforeAcquire = machine.requests.length;
    const operationId = 'a74-transfer-operation';
    await requireCommand(page, 'acquireMachineCarrier', {
      leaseKey: 'transfer',
      machineId: MACHINE_ID,
      serverId: seeded.serverId,
      operationId,
      flow: TRANSFER_FLOW,
      maxBytes: TRANSFER_MAX_BYTES,
    });
    acquiredLeaseKeys.push('transfer');
    const acceptorAfterAcquire = await fixture.machineAcceptorStatus(machineTarget);
    observe(
      'exactRelayToRealMachineAcceptor',
      acceptorAfterAcquire?.running === true
        && acceptorAfterAcquire.streamsAccepted >= 1
        && acceptorAfterAcquire.connectionsActive >= 1
        && machine.requests.length === machineRequestsBeforeAcquire,
      {
        configuredRelayUrl: fixture.relayUrl,
        acceptor: acceptorAfterAcquire,
        machineApplicationRequestsBeforeAnyTransfer: machine.requests.length,
      },
    );

    // 7. The grant the daemon actually verified binds every fact A7.4 names.
    const grant = home.mintedGrants.at(-1) ?? null;
    const browserInitiatorEndpointId = grant?.payload?.iroh?.initiator?.endpointId ?? null;
    observe(
      'signedGrantBindsInitiatorTargetOperationFlowAndMaxBytes',
      home.mintedGrants.length === 1
        && grant?.payload?.accountId === ACCOUNT_ID
        && grant?.payload?.routeKind === 'iroh_peer'
        && grant?.payload?.flowKind === 'bounded_transfer'
        && grant?.payload?.machineId === MACHINE_ID
        && grant?.payload?.endpointFingerprint === machineTarget.endpointId
        && grant?.payload?.iroh?.initiator?.kind === 'account_client'
        && typeof browserInitiatorEndpointId === 'string'
        && browserInitiatorEndpointId.length > 0
        && browserInitiatorEndpointId !== machineTarget.endpointId
        && browserInitiatorEndpointId !== homeEndpoint.endpointId
        && grant?.payload?.iroh?.target?.machineId === MACHINE_ID
        && grant?.payload?.iroh?.target?.endpointId === machineTarget.endpointId
        && grant?.payload?.iroh?.operationKind === TRANSFER_FLOW
        && grant?.payload?.scope?.kind === 'bounded_transfer'
        && grant?.payload?.scope?.mode === 'single'
        && grant?.payload?.scope?.transferId === operationId
        && grant?.payload?.scope?.maxBytes === TRANSFER_MAX_BYTES
        && grant?.signature?.keyId === GRANT_SIGNING_KEY_ID
        && acceptorAfterAcquire?.lastPath?.remoteEndpointId === browserInitiatorEndpointId,
      {
        mintedGrantCount: home.mintedGrants.length,
        payload: grant?.payload ?? null,
        signatureKeyId: grant?.signature?.keyId ?? null,
        browserInitiatorEndpointId,
        acceptorProvedRemoteEndpointId: acceptorAfterAcquire?.lastPath?.remoteEndpointId ?? null,
        machineEndpointId: machineTarget.endpointId,
      },
    );

    // 8. Browser → machine bytes, over the admitted stream, byte-exact.
    const uploadReply = await requireCommand(page, 'machineRequest', {
      leaseKey: 'transfer',
      method: 'POST',
      path: UPLOAD_PATH,
      bodyBase64: uploadPayload.toString('base64'),
    });
    const upload = machine.uploads.at(-1) ?? null;
    observe(
      'browserToMachineBytesWithIntegrity',
      uploadReply.settled === 'resolved'
        && uploadReply.status === 200
        && machine.uploads.length === 1
        && upload?.byteLength === uploadPayload.byteLength
        && upload?.sha256 === sha256(uploadPayload),
      {
        status: uploadReply.status,
        sentBytes: uploadPayload.byteLength,
        sentSha256: sha256(uploadPayload),
        machineReceived: upload,
      },
    );

    // 9. Machine → browser bytes, over the SAME admitted stream, byte-exact.
    const downloadReply = await requireCommand(page, 'machineRequest', {
      leaseKey: 'transfer',
      method: 'GET',
      path: DOWNLOAD_PATH,
    });
    const downloadedBytes = typeof downloadReply.bodyBase64 === 'string'
      ? Buffer.from(downloadReply.bodyBase64, 'base64')
      : null;
    observe(
      'machineToBrowserBytesWithIntegrity',
      downloadReply.settled === 'resolved'
        && downloadReply.status === 200
        && downloadedBytes !== null
        && downloadedBytes.byteLength === downloadPayload.byteLength
        && sha256(downloadedBytes) === sha256(downloadPayload),
      {
        status: downloadReply.status,
        expectedBytes: downloadPayload.byteLength,
        expectedSha256: sha256(downloadPayload),
        receivedBytes: downloadedBytes?.byteLength ?? null,
        receivedSha256: downloadedBytes ? sha256(downloadedBytes) : null,
      },
    );

    // 10. A transfer the machine really received and is really holding is
    //     aborted: it must fail promptly, and releasing the response afterwards
    //     must not complete it late.
    const heldReply = await requireCommand(page, 'machineRequest', {
      leaseKey: 'transfer',
      method: 'GET',
      path: HOLD_PATH,
      abortAfterMs: ABORT_AFTER_MS,
      giveUpAfterMs: ABORT_AFTER_MS + CANCELLED_SETTLE_BUDGET_MS,
    });
    const machineHeldTheTransfer = await waitFor(() => machine.held.length > 0, OBSERVE_TIMEOUT_MS);
    const releasedHeld = machine.releaseHeld();
    await sleep(LATE_COMPLETION_WATCH_MS);
    const afterRelease = await requireCommand(page, 'readHttpOutcome', heldReply.requestId);
    observe(
      'abortedTransferCancelsPromptlyAndNeverCompletesLate',
      machineHeldTheTransfer === true
        && releasedHeld >= 1
        && heldReply.settled === 'rejected'
        && heldReply.elapsedMs < ABORT_AFTER_MS + CANCELLED_SETTLE_BUDGET_MS
        && afterRelease.settled === 'rejected'
        && afterRelease.settledAtMs === heldReply.settledAtMs
        && afterRelease.bodyBase64 === undefined,
      {
        machineHeldTheTransfer,
        releasedHeldResponses: releasedHeld,
        outcomeAtAbort: { settled: heldReply.settled, elapsedMs: heldReply.elapsedMs, error: heldReply.error },
        outcomeAfterMachineReleasedIt: afterRelease,
      },
    );

    // 11. The canonical admission owner rejects a handshake that does not bind
    //     this machine's role/identity, and it rejects it BEFORE any
    //     application byte: the machine application must see nothing new.
    //
    //     Two distinct mis-bindings are exercised: a grant whose target machine
    //     the acceptor does not own (rejected by admission, after a real dial),
    //     and a target endpoint that is not the machine's at all (rejected by
    //     the transport, before any admission).
    const machineRequestsBeforeRejections = machine.requests.length;
    const acceptorBeforeRejections = await fixture.machineAcceptorStatus(machineTarget);
    await requireCommand(page, 'publishMachineDescriptor', {
      serverId: seeded.serverId,
      // A machine id this acceptor does not own, published at the acceptor's
      // own endpoint: the dial reaches the real acceptor, and the canonical
      // admission owner is what refuses it.
      machineId: IMPOSTOR_MACHINE_ID,
      machineEndpointId: machineTarget.endpointId,
      machineRelayUrls: [fixture.relayUrl],
    });
    const impostorAttempt = await command(page, 'acquireMachineCarrier', {
      leaseKey: 'impostor',
      machineId: IMPOSTOR_MACHINE_ID,
      serverId: seeded.serverId,
      operationId: 'a74-impostor-operation',
      flow: TRANSFER_FLOW,
      maxBytes: TRANSFER_MAX_BYTES,
    });

    // A well-formed EndpointId that is not the machine's: the Home's. Nothing
    // there speaks `happier/machine/1`, so no admission can even be attempted.
    await requireCommand(page, 'publishMachineDescriptor', {
      serverId: seeded.serverId,
      machineId: 'machine-a74-wrong-endpoint',
      machineEndpointId: homeEndpoint.endpointId,
      machineRelayUrls: [fixture.relayUrl],
    });
    const wrongEndpointAttempt = await command(page, 'acquireMachineCarrier', {
      leaseKey: 'wrong-endpoint',
      machineId: 'machine-a74-wrong-endpoint',
      serverId: seeded.serverId,
      operationId: 'a74-wrong-endpoint-operation',
      flow: TRANSFER_FLOW,
      maxBytes: TRANSFER_MAX_BYTES,
    });
    const acceptorAfterRejections = await waitFor(
      async () => {
        const status = await fixture.machineAcceptorStatus(machineTarget);
        return status?.streamsRejected > (acceptorBeforeRejections?.streamsRejected ?? 0);
      },
      OBSERVE_TIMEOUT_MS,
    );
    const acceptorRejectionStatus = await fixture.machineAcceptorStatus(machineTarget);
    observe(
      'wrongPeerRoleEndpointOrGrantRejectedBeforeApplicationBytes',
      impostorAttempt?.ok === false
        && wrongEndpointAttempt?.ok === false
        && acceptorAfterRejections === true
        && acceptorRejectionStatus?.streamsAccepted === acceptorBeforeRejections?.streamsAccepted
        && machine.requests.length === machineRequestsBeforeRejections,
      {
        impostorAttempt,
        wrongEndpointAttempt,
        acceptorBefore: acceptorBeforeRejections,
        acceptorAfter: acceptorRejectionStatus,
        machineApplicationRequestsBefore: machineRequestsBeforeRejections,
        machineApplicationRequestsAfter: machine.requests.length,
      },
    );

    // 12. Nothing fell back. After Iroh was selected, no ordinary transfer path
    //     and no user socket on the Home was ever used — not by the admitted
    //     transfer, and not by either refused attempt.
    observe(
      'noUserSocketOrServerRelayFallbackAfterIrohSelection',
      home.fallbackTransferRequests.length === 0
        && home.socketUpgrades === 0
        && machine.uploads.length === 1,
      {
        homeFallbackTransferRequests: home.fallbackTransferRequests,
        homeSocketUpgrades: home.socketUpgrades,
        homeRequestPaths: home.requests.map((request) => request.url),
        machineUploads: machine.uploads.length,
      },
    );

    // 13. Relay-only. The acceptor's own path snapshot is the transport's
    //     account of how the browser reached it, and a browser must never
    //     appear as a direct peer.
    observe(
      'browserReportsRelayOnlyNeverDirect',
      acceptorAfterAcquire?.lastPath?.observedPath === 'relay'
        && acceptorAfterAcquire?.lastPath?.isRelay === true
        && acceptorRejectionStatus?.lastPath?.observedPath !== 'direct'
        && seeded.homeCarrierObservedPath !== 'direct',
      {
        acceptorPathAfterAcquire: acceptorAfterAcquire?.lastPath ?? null,
        acceptorPathAfterRejections: acceptorRejectionStatus?.lastPath ?? null,
        homeCarrierObservedPath: seeded.homeCarrierObservedPath,
      },
    );

    // 14. Release closes the machine stream and its connection, and the
    //     released lease can carry nothing more. The cancellation observation
    //     above intentionally closes its transfer stream, so use a fresh
    //     admitted lease here: otherwise this check would merely observe the
    //     earlier abort rather than falsifying a broken release owner.
    await requireCommand(page, 'acquireMachineCarrier', {
      leaseKey: 'release',
      machineId: MACHINE_ID,
      serverId: seeded.serverId,
      operationId: 'a74-release-operation',
      flow: TRANSFER_FLOW,
      maxBytes: TRANSFER_MAX_BYTES,
    });
    acquiredLeaseKeys.push('release');
    const releaseProbe = await requireCommand(page, 'machineRequest', {
      leaseKey: 'release',
      method: 'GET',
      path: DOWNLOAD_PATH,
    });
    if (releaseProbe.status !== 200) {
      failures.push(`release probe did not reach the machine: ${JSON.stringify(releaseProbe)}`);
    }
    await waitFor(
      () => machine.openConnections - machine.closedConnections > 0,
      OBSERVE_TIMEOUT_MS,
    );
    const machineConnectionsBeforeRelease = machine.openConnections - machine.closedConnections;
    await requireCommand(page, 'releaseMachineCarrier', 'release');
    acquiredLeaseKeys.splice(acquiredLeaseKeys.indexOf('release'), 1);
    const machineSawStreamClosed = await waitFor(
      () => machine.openConnections - machine.closedConnections < machineConnectionsBeforeRelease,
      OBSERVE_TIMEOUT_MS,
    );
    // The released lease is still reachable from the page on purpose: the
    // refusal must come from the production closed-connection owner.
    const requestAfterRelease = await command(page, 'machineRequest', {
      leaseKey: 'release',
      method: 'GET',
      path: DOWNLOAD_PATH,
      giveUpAfterMs: MUST_NOT_COMPLETE_MS,
    });
    // The endpoint's own Iroh connection is NOT part of this observation: A7.2
    // and A8 make the shared endpoint outlive its last lease deliberately, so
    // the acceptor's `connectionsActive` is recorded as a fact rather than
    // asserted to reach zero — asserting that would gate on behavior the
    // amendment forbids.
    observe(
      'releaseClosesMachineStreamsAndConnections',
      machineConnectionsBeforeRelease > 0
        && machineSawStreamClosed === true
        && requestAfterRelease?.ok === true
        && requestAfterRelease?.settled === 'rejected'
        && requestAfterRelease?.status === undefined
        && requestAfterRelease?.bodyBase64 === undefined,
      {
        machineConnectionsBeforeRelease,
        machineOpenConnections: machine.openConnections,
        machineClosedConnections: machine.closedConnections,
        acceptorAfterRelease: await fixture.machineAcceptorStatus(machineTarget),
        requestAfterRelease,
      },
    );

    if (pageErrors.length > 0) {
      failures.push(`browser page errors: ${pageErrors.join(' | ')}`);
    }

    for (const leaseKey of [...acquiredLeaseKeys]) {
      await command(page, 'releaseMachineCarrier', leaseKey);
    }
    acquiredLeaseKeys.length = 0;
  } catch (error) {
    // A stage that could not run is a FAIL with everything observed so far
    // still reported, rather than an opaque throw that discards the evidence
    // explaining why it could not run.
    failures.push(`journey aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Both applications' own records, always reported: on a failed run they are
    // the evidence that says which side refused and why.
    report.homeApplication = {
      requestPaths: home.requests.map((request) => `${request.method} ${request.url}`),
      grantExchanges: home.grantExchanges,
      mintRejections: home.mintRejections,
      socketUpgrades: home.socketUpgrades,
      fallbackTransferRequests: home.fallbackTransferRequests,
    };
    report.machineApplication = {
      requestPaths: machine.requests.map((request) => `${request.method} ${request.url}`),
      uploads: machine.uploads,
      openConnections: machine.openConnections,
      closedConnections: machine.closedConnections,
    };
    machine.releaseHeld();
    machine.server.closeAllConnections?.();
    await new Promise((resolve) => machine.server.close(resolve));
    home.server.closeAllConnections?.();
    await new Promise((resolve) => home.server.close(resolve));
    if (admissionServer) await admissionServer.stop().catch(() => undefined);
    if (fixture) await fixture.dispose();
  }

  const { verdict, reasons } = evaluateBrowserMachineTransferJourney({ observations, failures });
  return { report, observations, failures: reasons, verdict };
}
