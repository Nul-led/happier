/**
 * Lane 06 composed production journey (A2.1 / A4.6 items 3–4).
 *
 * The lower-level `packages/iroh-native` real fixture already proves Home
 * HTTP/Socket.IO bytes, the Lane 08 rooted duplex, and client↔machine transfers
 * on forced-direct and forced-relay paths. It composes those from an in-process
 * Fastify app plus a directly constructed daemon Iroh runtime, so it cannot
 * prove that the *product* composition roots reach the same carrier.
 *
 * This fixture closes exactly that gap by running the real processes:
 *
 *   startServer('light')                    (apps/server/sources/startServer.ts)
 *     -> verifyPersonalHomeExposureProof
 *     -> ensureHomeIrohEndpoint (persistent endpoint key + continuity)
 *     -> published HomeConnectionDescriptorV1
 *   startDaemon()                           (apps/cli/src/daemon/startDaemon.ts)
 *     -> createDaemonMachineIrohRuntime
 *     -> prepareDaemonHomeIrohTransport -> publishServerHttpRuntimeOrigin
 *     -> authenticated Machine registration
 *     -> scoped Socket.IO machine-activity publication
 *   Home process restart -> endpoint identity continuity -> exact descriptor
 *     re-adoption -> daemon re-registration
 *
 * Both the server and the daemon load the ordinary packaged
 * `@happier-dev/iroh-native` Node addon through its production loader; no
 * native, server, or daemon internal is injected or mocked. The parent test
 * process alone loads the stable `test-relay-fixture` addon through the
 * canonical Iroh test controller and starts one stock plain-HTTP test relay
 * for the whole journey. That relay's ordinary URL is the only relay fact the
 * production children receive — through the real `HAPPIER_IROH_RELAY_POLICY=automatic`
 * + `HAPPIER_IROH_RELAY_URLS` configuration — so the restarted Home publishes
 * a fresh descriptor with a stable relay set and the restarted daemon
 * reacquires it over a transport path that survives the Home process restart
 * even though its persisted direct-address hints went stale. The fixture
 * addon path never reaches a production child, and forced-direct coverage
 * stays owned by the lower-level fixture.
 *
 * Remote executor mirrors deliberately exclude ignored native build output, so
 * the ordinary addon the runner builds can disappear while this journey runs.
 * The fixture therefore re-establishes artifact custody — one canonical
 * `iroh-native` `build:native` invocation — immediately before every
 * production child start (server and daemon, first start and restart).
 *
 * The suite is inert unless the canonical Iroh real-integration runner
 * (`packages/iroh-native` `test:home-iroh:real`) selects it.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import {
  createIrohTestControllerFromNativeAddon,
  type IrohTestController,
} from '@happier-dev/iroh-native/test-controller';

import { createTestAuth, type TestAuth } from '../../src/testkit/auth';
import { seedCliAuthForTestAccount } from '../../src/testkit/cliAuth';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { fetchJson } from '../../src/testkit/http';
import { ensureProductionIrohNodeAddon } from '../../src/testkit/iroh/productionIrohNodeAddon';
import { fetchMachineIdentities } from '../../src/testkit/machineIdentity';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import { createUserScopedSocketCollector, type SocketCollector } from '../../src/testkit/socketClient';
import { waitForRegexInFile } from '../../src/testkit/waitForRegexInFile';

const run = createRunDirs({ runLabel: 'core' });

const shouldRunComposedHomeIrohJourney =
  process.env.HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION === '1';

/**
 * The stable `test-relay-fixture` addon the canonical real-integration runner
 * stages for this parent test process. It owns the one shared stock test
 * relay; production server/daemon children never receive this path.
 */
const fixtureIrohAddonPath = process.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH?.trim();

function requireIrohTestRelayController(): IrohTestController {
  if (!fixtureIrohAddonPath) {
    throw new Error(
      'The composed Personal Home Iroh journey requires the stable test-relay-fixture addon in HAPPIER_TEST_IROH_NODE_ADDON_PATH (staged by the canonical real-integration runner)',
    );
  }
  const requireFromAddon = createRequire(pathToFileURL(fixtureIrohAddonPath));
  return createIrohTestControllerFromNativeAddon(requireFromAddon(fixtureIrohAddonPath));
}

type FeaturesPayload = Readonly<{
  homeConnectionDescriptor?: HomeConnectionDescriptorV1;
}>;

type IrohEndpointEntry = Readonly<{
  kind: 'iroh';
  endpointId: string;
  relayUrls?: readonly string[];
  directAddresses?: readonly string[];
}>;

async function fetchPublicFeatures(baseUrl: string): Promise<FeaturesPayload> {
  const response = await fetchJson<FeaturesPayload>(`${baseUrl}/v1/features`, { timeoutMs: 15_000 });
  if (response.status !== 200) throw new Error(`Home /v1/features failed (status=${response.status})`);
  return response.data;
}

async function fetchAuthenticatedFeatures(baseUrl: string, token: string): Promise<FeaturesPayload> {
  const response = await fetchJson<FeaturesPayload>(`${baseUrl}/v1/features/authenticated`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 15_000,
  });
  if (response.status !== 200) {
    throw new Error(`Home /v1/features/authenticated failed (status=${response.status})`);
  }
  return response.data;
}

async function readServerStartupLogs(testDir: string): Promise<string> {
  const stdout = await readFile(resolve(testDir, 'server.attempt-1.stdout.log'), 'utf8').catch(() => '');
  const stderr = await readFile(resolve(testDir, 'server.attempt-1.stderr.log'), 'utf8').catch(() => '');
  return `${stdout}\n${stderr}`.trim();
}

function readIrohEndpoint(descriptor: HomeConnectionDescriptorV1 | undefined): IrohEndpointEntry | null {
  const entry = descriptor?.endpoints.find((candidate) => candidate.kind === 'iroh');
  return (entry as IrohEndpointEntry | undefined) ?? null;
}

/**
 * Starts the real `startServer('light')` process as a managed Personal Home
 * and returns only after that process has passed its own Iroh composition
 * point. `startServer` awaits `ensureHomeIrohEndpoint` before it writes its
 * startup receipt and logs `Ready`, so that line is the exact composition
 * barrier: the carrier decision — compose or refuse — is already final.
 * Without it, a `/health`-only wait races an in-flight native endpoint start
 * and would report a false negative.
 */
async function startPersonalHome(params: Readonly<{
  testDir: string;
  port: number;
  canonicalServerUrl: string;
  anonymousSignupEnabled: boolean;
  reuseExistingDataDir: boolean;
  relayUrl: string;
}>): Promise<StartedServer> {
  // Executor mirrors drop the ignored ordinary addon at arbitrary points, so
  // custody is re-established at the narrowest possible point: immediately
  // before this production child spawns.
  await ensureProductionIrohNodeAddon({ testDir: params.testDir });
  const started = await startServerLight({
    testDir: params.testDir,
    dbProvider: 'sqlite',
    port: params.port,
    ...(params.reuseExistingDataDir ? { dataDirMode: 'reuse-existing' as const } : {}),
    extraEnv: {
      // The managed Personal Home runtime spec: loopback-only, canonical
      // audience equal to the bound loopback origin, no public ingress.
      HAPPIER_MANAGED_RELAY_PURPOSE: 'personal-home',
      HAPPIER_CANONICAL_SERVER_URL: params.canonicalServerUrl,
      AUTH_ANONYMOUS_SIGNUP_ENABLED: params.anonymousSignupEnabled ? 'true' : '0',
      // Ordinary automatic relay configuration pointing at the one stock
      // test relay this journey owns; the server consumes it like any other
      // operator relay fleet.
      HAPPIER_IROH_RELAY_POLICY: 'automatic',
      HAPPIER_IROH_RELAY_URLS: params.relayUrl,
      // The fixture addon belongs to this parent test process alone; the
      // production server must resolve its ordinary addon itself.
      HAPPIER_TEST_IROH_NODE_ADDON_PATH: undefined,
      // The canonical real-Iroh lane runs through hstack-exec against an
      // already prepared source workspace. Rebuilding the server's entire
      // unrelated dependency closure here can replace the ignored native
      // addon between its producing build and the production child load.
      HAPPIER_E2E_PROVIDER_SKIP_SERVER_SHARED_DEPS_BUILD: '1',
    },
  });
  await waitForRegexInFile({
    path: resolve(params.testDir, 'server.attempt-1.stdout.log'),
    regex: /Ready/u,
    timeoutMs: 120_000,
    context: 'managed Personal Home startup completion (Iroh composition point)',
  });
  return started;
}

/**
 * Starts the real daemon composition root only after the ordinary production
 * addon is verifiably present again — the daemon's Iroh runtime loads it
 * through the same production resolution path as the server.
 */
async function startComposedDaemon(params: Readonly<{
  testDir: string;
  happyHomeDir: string;
  env: NodeJS.ProcessEnv;
}>): Promise<StartedDaemon> {
  await ensureProductionIrohNodeAddon({ testDir: params.testDir });
  return await startTestDaemon(params);
}

async function waitForMachineActive(params: Readonly<{
  baseUrl: string;
  token: string;
  timeoutMs: number;
}>): Promise<Readonly<{ id: string }>> {
  const deadline = Date.now() + params.timeoutMs;
  let lastSeen = 'none';
  while (Date.now() < deadline) {
    const machines = await fetchMachineIdentities({ baseUrl: params.baseUrl, token: params.token })
      .catch(() => []);
    const active = machines.find((machine) => machine.active === true);
    if (active) return { id: active.id };
    lastSeen = machines.length === 0
      ? 'no machines registered'
      : machines.map((machine) => `${machine.id}:active=${String(machine.active)}`).join(', ');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for an active registered Machine (${lastSeen})`);
}

/**
 * Read-only observation of the daemon-owned CLI profile descriptor. The
 * fixture never writes settings.json; this only reports what the production
 * reconcile owner (`reconcileActiveServerProfileHomeConnectionDescriptor`)
 * persisted, so adoption of the exact restarted descriptor is attributable to
 * the daemon's own descriptor-refresh path rather than to fixture mutation.
 */
async function readPersistedProfileHomeConnectionDescriptor(params: Readonly<{
  cliHome: string;
  serverId: string;
}>): Promise<HomeConnectionDescriptorV1 | null> {
  const settingsPath = join(params.cliHome, 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
    servers?: Record<string, { homeConnectionDescriptor?: HomeConnectionDescriptorV1 } | undefined>;
  };
  return settings.servers?.[params.serverId]?.homeConnectionDescriptor ?? null;
}

/**
 * Counts live machine-activity publications for one Machine observed by the
 * account-scoped socket collector. Counting events instead of comparing
 * timestamps keeps the post-restart oracle independent of wall-clock jumps.
 */
function countMachineActivityEvents(collector: SocketCollector, machineId: string): number {
  return collector.getEvents().filter((event) =>
    event.kind === 'ephemeral'
    && event.payload.type === 'machine-activity'
    && event.payload.id === machineId).length;
}

async function readDaemonLog(daemon: StartedDaemon, testDir: string): Promise<string> {
  const stdout = await readFile(resolve(testDir, 'daemon.stdout.log'), 'utf8').catch(() => '');
  const stderr = await readFile(resolve(testDir, 'daemon.stderr.log'), 'utf8').catch(() => '');
  const daemonLogPath = daemon.state.daemonLogPath;
  const daemonLog = daemonLogPath
    ? await readFile(daemonLogPath, 'utf8').catch(() => '')
    : '';
  return `${stdout}\n${stderr}\n${daemonLog}`;
}

describe.skipIf(!shouldRunComposedHomeIrohJourney)('core e2e: composed Personal Home Iroh production journey', () => {
  let server: StartedServer | null = null;
  let daemon: StartedDaemon | null = null;
  let accountSocket: SocketCollector | null = null;
  let relayController: IrohTestController | null = null;

  afterEach(async () => {
    try {
      accountSocket?.close();
      accountSocket = null;
      await daemon?.stop().catch(() => {});
      daemon = null;
      await server?.stop().catch(() => {});
      server = null;
    } finally {
      // The one stock test relay is owned by this parent process through the
      // canonical controller; its topology state is restored even when the
      // journey above failed, so no fixture state can leak between runs.
      await relayController?.restoreAutomatic();
      relayController = null;
    }
  });

  it('runs startServer -> Home Iroh endpoint -> startDaemon -> authenticated registration -> scoped Socket.IO state, then re-registers after Home restart and exact descriptor refresh', async () => {
    const testDir = run.testDir(`home-iroh-composed-personal-home-${randomUUID()}`);
    const port = await reserveAvailablePort();
    const canonicalServerUrl = `http://127.0.0.1:${port}`;

    // One stable stock test relay for the whole journey, started once in this
    // parent process through the canonical Iroh test controller. Both the
    // first Home process and its restart publish against it, and the daemon
    // reacquires the Home through it after its direct hints went stale.
    relayController = requireIrohTestRelayController();
    await relayController.forceRelayOnly();
    const testRelayUrl = relayController.getTestRelayUrl();
    if (!testRelayUrl) {
      throw new Error('Forced-relay native fixture did not publish its test relay URL');
    }

    // --- Phase 1: loopback bootstrap. Anonymous signup is still open, so the
    // Personal Home exposure proof must refuse to compose an Iroh acceptor.
    server = await startPersonalHome({
      testDir,
      port,
      canonicalServerUrl,
      anonymousSignupEnabled: true,
      reuseExistingDataDir: false,
      relayUrl: testRelayUrl,
    });
    expect(server.baseUrl).toBe(canonicalServerUrl);

    const auth: TestAuth = await createTestAuth(server.baseUrl);
    expect(readIrohEndpoint((await fetchPublicFeatures(server.baseUrl)).homeConnectionDescriptor)).toBeNull();

    await server.stop();
    server = null;

    // --- Phase 2: signup closure restart. The real startServer composition
    // root now passes the exposure proof and composes the persistent Home Iroh
    // endpoint through the packaged native addon.
    server = await startPersonalHome({
      testDir,
      port,
      canonicalServerUrl,
      anonymousSignupEnabled: false,
      reuseExistingDataDir: true,
      relayUrl: testRelayUrl,
    });

    const publicDescriptor = (await fetchPublicFeatures(server.baseUrl)).homeConnectionDescriptor;
    const publicIroh = readIrohEndpoint(publicDescriptor);
    if (!publicIroh) {
      throw new Error(
        `Managed Personal Home did not publish its Iroh endpoint after signup closure.\n${await readServerStartupLogs(testDir)}`,
      );
    }
    expect(publicDescriptor?.canonicalServerUrl).toBe(canonicalServerUrl);
    // Public projection never leaks private direct-address hints, and it
    // publishes exactly the configured relay fleet — the one stock test relay.
    expect(publicIroh).not.toHaveProperty('directAddresses');
    expect(publicIroh.relayUrls).toEqual([testRelayUrl]);

    const authenticatedDescriptor =
      (await fetchAuthenticatedFeatures(server.baseUrl, auth.token)).homeConnectionDescriptor;
    const authenticatedIroh = readIrohEndpoint(authenticatedDescriptor);
    if (!authenticatedDescriptor || !authenticatedIroh) {
      throw new Error('Composed Personal Home did not publish an authenticated Iroh endpoint descriptor');
    }
    expect(authenticatedIroh.endpointId).toBe(publicIroh?.endpointId);
    expect(authenticatedIroh.directAddresses ?? []).not.toHaveLength(0);
    // The applied native endpoint exposes exactly the configured relay set.
    expect(authenticatedIroh.relayUrls).toEqual([testRelayUrl]);
    // A loopback-only Home has no public ingress, so the descriptor carries no
    // HTTPS endpoint. That is what makes the rest of this journey discriminating:
    // the daemon's Home transport owner has no trusted-HTTPS origin to fall back
    // to, so an authenticated Machine can only be registered through the verified
    // Iroh tunnel. The canonical URL stays the auth audience only.
    expect(authenticatedDescriptor.endpoints.map((endpoint) => endpoint.kind)).toEqual(['iroh']);
    expect(authenticatedDescriptor.canonicalServerUrl).toBe(canonicalServerUrl);

    // --- Phase 3: the real daemon composition root adopts the descriptor,
    // acquires a Home tunnel, registers its Machine and publishes state.
    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    await mkdir(daemonHomeDir, { recursive: true });
    const seeded = await seedCliAuthForTestAccount({
      cliHome: daemonHomeDir,
      serverUrl: canonicalServerUrl,
      auth,
      mode: 'legacy',
      homeConnectionDescriptor: authenticatedDescriptor,
    });

    accountSocket = createUserScopedSocketCollector(canonicalServerUrl, auth.token);
    accountSocket.connect();

    const daemonEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CI: '1',
      HAPPIER_VARIANT: 'dev',
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_HOME_DIR: daemonHomeDir,
      HAPPIER_SERVER_URL: canonicalServerUrl,
      HAPPIER_WEBAPP_URL: canonicalServerUrl,
      // Ordinary automatic relay configuration: the daemon consumes the same
      // stock test relay like any operator fleet, never a fixture API.
      HAPPIER_IROH_RELAY_POLICY: 'automatic',
      HAPPIER_IROH_RELAY_URLS: testRelayUrl,
      // The fixture addon belongs to this parent test process alone; the
      // production daemon must resolve its ordinary addon itself.
      HAPPIER_TEST_IROH_NODE_ADDON_PATH: undefined,
      HAPPIER_E2E_DAEMON_CLI_SNAPSHOT_MODE: 'testdir',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    };
    daemon = await startComposedDaemon({ testDir, happyHomeDir: daemonHomeDir, env: daemonEnv });

    const registeredMachine = await waitForMachineActive({
      baseUrl: canonicalServerUrl,
      token: auth.token,
      timeoutMs: 90_000,
    });

    // The daemon's own composition root reports which carrier moved those
    // authenticated bytes. A standard-carrier daemon would still register, so
    // this is the assertion that separates the Iroh journey from HTTPS.
    const daemonLog = await readDaemonLog(daemon, testDir);
    expect(daemonLog).toMatch(/Home transport prepared/);
    expect(daemonLog).toMatch(/"carrier":\s*"iroh"|carrier: 'iroh'|carrier=iroh/);

    // Scoped Socket.IO publication: the account-scoped listener observes the
    // machine-activity state the daemon published over its Iroh-carried socket.
    // The observed count is kept as the baseline for the restart oracle below:
    // while this first daemon process is the only possible publisher, every
    // matching event it produced is counted before any restart begins.
    const machineActivityBeforeRestart =
      countMachineActivityEvents(accountSocket, registeredMachine.id);
    expect(machineActivityBeforeRestart).toBeGreaterThan(0);

    // --- Phase 4: Home restart. The persistent endpoint key and continuity
    // record must preserve the EndpointId across the real process restart, and
    // a restarted daemon must reconnect through the same descriptor.
    await daemon.stop();
    daemon = null;
    await server.stop();
    server = null;

    server = await startPersonalHome({
      testDir,
      port,
      canonicalServerUrl,
      anonymousSignupEnabled: false,
      reuseExistingDataDir: true,
      relayUrl: testRelayUrl,
    });

    const restartedDescriptor = (await fetchPublicFeatures(server.baseUrl)).homeConnectionDescriptor;
    const restartedIroh = readIrohEndpoint(restartedDescriptor);
    // The persistent endpoint key and continuity record survive the process
    // restart, so the EndpointId is stable and no new transport identity is
    // created. The restarted Home publishes the same stable relay set — that
    // is what lets the restarted daemon reacquire it remotely — while the
    // descriptor revision only ever moves forward: a restart rebinds an
    // ephemeral UDP port, so its direct-address hints legitimately change.
    expect(restartedIroh?.endpointId).toBe(publicIroh?.endpointId);
    expect(restartedIroh?.relayUrls).toEqual([testRelayUrl]);
    expect(restartedDescriptor?.revision ?? 0).toBeGreaterThanOrEqual(publicDescriptor?.revision ?? 0);

    // A restart rebinds the endpoint's ephemeral UDP port, so the daemon's
    // persisted direct-address hints are stale. The fixture leaves the seeded
    // profile byte-for-byte unchanged: the production daemon must reacquire
    // the exact authenticated descriptor itself — its connected-service
    // features refresh fetches `/v1/features/authenticated` under the profile
    // credential, `applyDaemonHomeDescriptorRefresh` reconciles the projection
    // into the active profile through
    // `reconcileActiveServerProfileHomeConnectionDescriptor`, and the Home
    // transport owner then reacquires against the refreshed profile and
    // re-registers this Machine through the verified Iroh lease. The fetched
    // projection below is only the adoption oracle; nothing is written back.
    const restartedAuthenticatedDescriptor =
      (await fetchAuthenticatedFeatures(server.baseUrl, auth.token)).homeConnectionDescriptor;
    const restartedAuthenticatedIroh = readIrohEndpoint(restartedAuthenticatedDescriptor);
    if (!restartedAuthenticatedDescriptor || !restartedAuthenticatedIroh) {
      throw new Error('Restarted Home did not republish its authenticated descriptor');
    }
    expect(restartedAuthenticatedIroh.endpointId).toBe(publicIroh?.endpointId);
    expect(restartedAuthenticatedIroh.relayUrls).toEqual([testRelayUrl]);

    daemon = await startComposedDaemon({ testDir, happyHomeDir: daemonHomeDir, env: daemonEnv });
    const reconnectedMachine = await waitForMachineActive({
      baseUrl: canonicalServerUrl,
      token: auth.token,
      timeoutMs: 90_000,
    });
    expect(reconnectedMachine.id).toBe(registeredMachine.id);

    // Stale-row guard: the row lookup above proves identity continuity, but a
    // pre-restart row that never deactivated would satisfy it without any
    // fresh publication. The account socket survives the Home restart
    // (socket.io reconnection), so machine-activity events beyond the
    // pre-restart baseline prove the restarted daemon process itself published
    // live state through a freshly acquired Home transport. In this
    // loopback-only composition that transport can only be the verified Iroh
    // lease — no standard carrier is ever published, so an authenticated
    // Machine cannot publish through anything else.
    const freshActivityDeadline = Date.now() + 90_000;
    while (
      countMachineActivityEvents(accountSocket, registeredMachine.id)
        <= machineActivityBeforeRestart
    ) {
      if (Date.now() > freshActivityDeadline) {
        throw new Error(
          'Timed out waiting for post-restart machine-activity publication from the restarted daemon',
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }

    // The fixture never rewrote the persisted profile, so the exact adoption
    // of the restarted authenticated projection is observable in the
    // daemon-owned profile: the stale seeded revision must have been replaced
    // by the restarted projection through the production reconcile owner.
    const adoptedDescriptor = await readPersistedProfileHomeConnectionDescriptor({
      cliHome: daemonHomeDir,
      serverId: seeded.serverId,
    });
    expect(adoptedDescriptor?.revision).toBe(restartedAuthenticatedDescriptor.revision);
    expect(readIrohEndpoint(adoptedDescriptor ?? undefined)?.endpointId).toBe(publicIroh?.endpointId);
  }, 900_000);
});
