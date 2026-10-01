// The one native relay + Home fixture the browser Iroh gates share (Lane 06 A7).
//
// Both browser gates need the same three real things from the native side: the
// local test relay a browser can reach over plain `ws://`, real Home endpoints
// behind the ordinary `startHomeAcceptor` lifecycle, and the acceptor's own
// connection counters. This module owns that lifecycle once so the A7.1/I10 live
// gate (`run-browser-iroh-live.mjs`) and the A7.3 real Home vertical
// (`apps/ui/tools/iroh/runRealHomeVerticalJourney.mjs`) cannot drift into two
// relay/Home stacks with two sets of assumptions.
//
// The A7.4 browser Machine vertical
// (`apps/ui/tools/iroh/runBrowserMachineTransferJourney.mjs`) reuses the same
// relay and the same endpoint lifecycle for the other side of the transfer: a
// real `happier/machine/1` acceptor whose admission decision is delegated over
// loopback HTTP to the canonical daemon admission owner the caller supplies.
//
// What is NOT here: the loopback applications standing behind a Home or a
// Machine. Each gate owns the application shape its own contract needs — a raw
// two-line HTTP responder for the transport gate, a real HTTP + Engine.IO server
// for the production Home vertical, the canonical daemon admission server plus a
// transfer application for the Machine vertical — and passes its port in. The
// relay, the endpoints, the acceptors and the ALPNs are the production owners
// either way.
//
// The test addon is rebuilt from current source by the one addon build owner
// before it is loaded, so a stale artifact cannot false-pass a native or shared
// core change.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

const TEST_ADDON = `happier-iroh-native-lifecycle-test.${process.platform}-${process.arch}.node`;

/** The operations every browser gate needs from the test addon. */
const REQUIRED_ADDON_OPERATIONS = [
  'forceRelayOnly',
  'restoreAutomatic',
  'getTestRelayUrl',
  'createEndpoint',
  'getEndpointStatus',
  'shutdownEndpoint',
  'startHomeAcceptor',
  'stopHomeAcceptor',
];

export function bail(message) {
  throw new Error(message);
}

/** Awaits one JSON-envelope C ABI operation from the raw addon. */
export async function callAddon(promise, label) {
  const raw = await promise;
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (envelope && envelope.ok === false) {
    bail(`${label} failed: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

/**
 * Awaits one addon operation that is EXPECTED to fail, without letting a hung
 * dial hang the gate. A timeout is reported as its own outcome: a handshake that
 * neither succeeds nor is rejected is exactly the defect a gate exists to catch.
 */
export async function attemptAddon(promise, timeoutMs) {
  return Promise.race([
    promise.then(
      (raw) => ({ envelope: typeof raw === 'string' ? JSON.parse(raw) : raw }),
      (error) => ({ envelope: { ok: false, error: String(error) } }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), timeoutMs)),
  ]);
}

export async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

/**
 * Polls a condition without letting a stuck gate hang forever. The predicate may
 * be async, so a condition read through the addon's own status operations is
 * polled the same way as an in-process one.
 */
export async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

/**
 * Builds the test addon from current source through its one build owner and
 * loads it. `extraOperations` lets a gate declare the operations it additionally
 * depends on (machine acceptors, tunnels) so a missing SPI fails loudly here
 * rather than as an undefined call deep inside a journey.
 */
export function buildAndLoadBrowserIrohTestAddon({ extraOperations = [] } = {}) {
  execFileSync(process.execPath, [join(packageDir, 'scripts', 'build-node-addon.mjs'), '--test-relay-fixture'], {
    cwd: packageDir,
    stdio: 'inherit',
  });

  const addonPath = join(packageDir, 'native-test', TEST_ADDON);
  if (!existsSync(addonPath)) {
    bail(`the addon build owner did not produce ${addonPath}`);
  }
  const addon = require(addonPath);
  for (const name of [...REQUIRED_ADDON_OPERATIONS, ...extraOperations]) {
    if (typeof addon[name] !== 'function') bail(`test addon does not expose ${name}`);
  }
  return { addon, addonPath };
}

/**
 * Starts the one local test relay and hands back the Home lifecycle around it.
 *
 * `dispose()` reverses everything this fixture created, in the reverse order it
 * was created. Callers own their own servers and browsers; this owns only the
 * relay policy, the endpoints, and the acceptors.
 */
export async function createBrowserIrohNativeHomeFixture({ addon }) {
  const cleanups = [];

  await callAddon(addon.forceRelayOnly(), 'forceRelayOnly');
  cleanups.push(() => callAddon(addon.restoreAutomatic(), 'restoreAutomatic'));

  const relayUrl = addon.getTestRelayUrl();
  if (!relayUrl || !relayUrl.startsWith('http://')) {
    bail(`the test relay must expose a browser-consumable http:// URL, got ${relayUrl}`);
  }

  /** Creates one endpoint and returns its handle plus its proven EndpointId. */
  async function createEndpoint(label) {
    const created = await callAddon(
      addon.createEndpoint(JSON.stringify({ relayPolicy: 'automatic' })),
      `createEndpoint(${label})`,
    );
    const endpointHandle = created?.result?.endpointHandle ?? created?.endpointHandle;
    if (!endpointHandle) bail(`createEndpoint(${label}) returned no handle: ${JSON.stringify(created)}`);

    const status = await callAddon(
      addon.getEndpointStatus(JSON.stringify({ endpointHandle })),
      `getEndpointStatus(${label})`,
    );
    const endpointId = status?.result?.endpointId ?? status?.endpointId;
    if (!endpointId) bail(`getEndpointStatus(${label}) returned no endpointId: ${JSON.stringify(status)}`);
    return { endpointHandle, endpointId };
  }

  async function startAcceptor(home, label) {
    return await callAddon(
      addon.startHomeAcceptor(
        JSON.stringify({
          endpointHandle: home.endpointHandle,
          targetHost: '127.0.0.1',
          targetPort: home.targetPort,
        }),
      ),
      `startHomeAcceptor(${label})`,
    );
  }

  return {
    addon,
    relayUrl,

    /** The ordinary endpoint + acceptor lifecycle in front of one loopback port. */
    startHome: async ({ label, targetPort }) => {
      const { endpointHandle, endpointId } = await createEndpoint(label);
      cleanups.push(() =>
        callAddon(addon.shutdownEndpoint(JSON.stringify({ endpointHandle })), `shutdownEndpoint(${label})`),
      );

      const home = { label, endpointHandle, endpointId, targetPort, port: targetPort };
      await startAcceptor(home, label);
      cleanups.push(() =>
        callAddon(addon.stopHomeAcceptor(JSON.stringify({ endpointHandle })), `stopHomeAcceptor(${label})`),
      );
      return home;
    },

    /**
     * How many browser connections this real Home is currently holding, read
     * from the acceptor's own counters. Re-issuing `startHomeAcceptor` for the
     * running acceptor's own target is the existing way to read them: it reuses
     * the live acceptor and returns its current status.
     */
    homeConnectionsActive: async (home) => {
      const envelope = await startAcceptor(home, `${home.label}, status`);
      const result = envelope?.result ?? envelope;
      if (result?.reused !== true) {
        bail(`reading ${home.label}'s acceptor status restarted it: ${JSON.stringify(envelope)}`);
      }
      return result?.status?.connectionsActive ?? null;
    },

    /**
     * The ordinary endpoint + `happier/machine/1` acceptor lifecycle for one
     * Machine (A7.4).
     *
     * The acceptor's admission target is the caller's canonical daemon admission
     * server: native Rust POSTs the canonical handshake there and admits a
     * stream only on that owner's 2xx decision, so nothing about acceptance is
     * decided by this fixture. That server has to bind the machine's own
     * EndpointId, which does not exist until this endpoint is created — hence
     * `resolveAdmissionPort(endpointId)`, called once between the two steps
     * rather than forcing the caller to split the lifecycle.
     */
    startMachine: async ({ label, resolveAdmissionPort }) => {
      const { endpointHandle, endpointId } = await createEndpoint(label);
      cleanups.push(() =>
        callAddon(addon.shutdownEndpoint(JSON.stringify({ endpointHandle })), `shutdownEndpoint(${label})`),
      );

      const admissionPort = await resolveAdmissionPort(endpointId);
      if (!Number.isInteger(admissionPort) || admissionPort <= 0) {
        bail(`startMachine(${label}) needs a real admission port, got ${admissionPort}`);
      }
      await callAddon(
        addon.startMachineAcceptor(JSON.stringify({ endpointHandle, admissionPort })),
        `startMachineAcceptor(${label})`,
      );
      cleanups.push(() =>
        callAddon(addon.stopMachineAcceptor(JSON.stringify({ endpointHandle })), `stopMachineAcceptor(${label})`),
      );
      return { label, endpointHandle, endpointId, admissionPort };
    },

    /**
     * The machine acceptor's own counters: how many streams it admitted, how
     * many it rejected, the last rejection category, and the path it observed.
     * Read straight from the running acceptor, so "the real acceptor admitted
     * this" and "the real acceptor rejected that before any application byte"
     * are observations rather than inferences.
     */
    machineAcceptorStatus: async (machine) => {
      const envelope = await callAddon(
        addon.getMachineAcceptorStatus(JSON.stringify({ endpointHandle: machine.endpointHandle })),
        `getMachineAcceptorStatus(${machine.label})`,
      );
      return envelope?.result ?? envelope ?? null;
    },

    /** Stops one Home's acceptor: the Home stops answering, its endpoint stays. */
    stopHomeAcceptor: async (home) =>
      await callAddon(
        addon.stopHomeAcceptor(JSON.stringify({ endpointHandle: home.endpointHandle })),
        `stopHomeAcceptor(${home.label})`,
      ),

    /** Restarts a stopped acceptor on the same endpoint identity and target. */
    restartHomeAcceptor: async (home) => {
      const envelope = await startAcceptor(home, `${home.label}, restart`);
      const result = envelope?.result ?? envelope;
      if (result?.reused === true) {
        bail(`restarting ${home.label}'s acceptor reused a still-running one: ${JSON.stringify(envelope)}`);
      }
      return result;
    },

    /**
     * A well-formed EndpointId that is genuinely absent from the relay: a real
     * endpoint, taken down again. Dialing it stays pending, which is what a
     * cancellation or identity-binding contract has to be proven against.
     */
    mintAbsentEndpointId: async (label = 'absent') => {
      const { endpointHandle, endpointId } = await createEndpoint(label);
      await callAddon(
        addon.shutdownEndpoint(JSON.stringify({ endpointHandle })),
        `shutdownEndpoint(${label})`,
      );
      return endpointId;
    },

    dispose: async () => {
      for (const fn of cleanups.reverse()) {
        try {
          await fn();
        } catch (error) {
          process.stderr.write(`fixture cleanup warning: ${error}\n`);
        }
      }
      cleanups.length = 0;
    },
  };
}
