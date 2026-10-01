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
 * canonical Iroh test controller and selects one test relay for the journey:
 * an in-process fixture in the native lane, or the external stock Docker
 * relay in the Docker lane. That relay's ordinary URL is the only relay fact the
 * production children receive — through the real `HAPPIER_IROH_RELAY_POLICY=automatic`
 * + `HAPPIER_IROH_RELAY_URLS` configuration — so the restarted Home publishes
 * a fresh descriptor with a stable relay set, allowing the still-running
 * daemon to reacquire Iroh after the Home process restart even when its
 * persisted direct-address hints are stale. The daemon uses automatic policy;
 * this test does not assert whether its final path is direct or relayed. The
 * separate finite-transfer assertions below force and observe stock-relay
 * carriage. The fixture
 * addon path never reaches a production child, and forced-direct coverage
 * stays owned by the lower-level fixture.
 *
 * Remote executor mirrors deliberately exclude ignored native build output, so
 * the ordinary addon the runner builds can disappear while this journey runs.
 * The fixture therefore re-establishes artifact custody — one canonical
 * `iroh-native` `build:native` invocation — immediately before every
 * production child start (each server start/restart and the daemon's initial
 * start). The daemon then remains alive while only Home restarts.
 *
 * The suite is inert unless the canonical Iroh real-integration runner
 * (`packages/iroh-native` `test:home-iroh:real`) selects it.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDirectRouteGrantSigningInputV2,
  createEphemeralPeerRouteProofHandleV2,
  DIRECT_ROUTE_GRANT_TTL_MS,
  FeaturesResponseSchema,
  IrohMachineHandshakeV1Schema,
  readMachineIrohEndpointAuthorityV1,
  SignedDirectRouteGrantV2Schema,
  type HomeConnectionDescriptorV1,
} from '@happier-dev/protocol';
import {
  createIrohTestControllerFromNativeAddon,
  type IrohTestController,
} from '@happier-dev/iroh-native/test-controller';
import { loadIrohNodeNativeAddon } from '@happier-dev/iroh-native/node';
import { createIrohNodeNativeModule } from '@happier-dev/iroh-native/node';

import {
  TokenStorage,
  uploadBulkPayloadFromFileViaDirectImport,
  upsertAndActivateServer,
} from '@happier-tests/ui-machine-carrier';

import { createTestAuth, type TestAuth } from '../../src/testkit/auth';
import { buildTestAccountCliAuthCredentials, seedCliAuthForTestAccount } from '../../src/testkit/cliAuth';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { fetchJson } from '../../src/testkit/http';
import {
  ensureProductionIrohNodeAddon,
  stageProductionIrohNodeAddonForConsumer,
} from '../../src/testkit/iroh/productionIrohNodeAddon';
import {
  fetchMachineIdentities,
  type MachineIdentityRow,
} from '../../src/testkit/machineIdentity';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { isProcessAlive } from '../../src/testkit/process/processTree';
import { createRunDirs } from '../../src/testkit/runDir';
import { repoRootDir } from '../../src/testkit/paths';
import { createUserScopedSocketCollector, type SocketCollector } from '../../src/testkit/socketClient';
import { waitFor } from '../../src/testkit/timing';
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

function assertFreshProductionIrohAddonLoad(cwd: string, expectedAddonPath: string): void {
  const probe = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { loadIrohNodeNative } from '@happier-dev/iroh-native/node';
     const loaded = loadIrohNodeNative();
     if (!loaded.available) {
       console.error(JSON.stringify({ reason: loaded.reason, addonPath: loaded.addonPath, message: loaded.message }));
       process.exitCode = 1;
     } else {
       console.log(loaded.addonPath);
     }`,
  ], { cwd, encoding: 'utf8' });
  if (probe.status !== 0 || probe.stdout.trim() !== expectedAddonPath) {
    throw new Error(`Fresh production Iroh loader failed before child spawn (expected=${expectedAddonPath}; status=${probe.status}; stdout=${probe.stdout.trim()}; stderr=${probe.stderr.trim()}; error=${probe.error?.message ?? 'none'})`);
  }
  process.stdout.write(`Composed production child pre-spawn Iroh addon loaded: ${probe.stdout.trim()}\n`);
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
  const started = await startServerLight({
    testDir: params.testDir,
    dbProvider: 'sqlite',
    port: params.port,
    ...(params.reuseExistingDataDir ? { dataDirMode: 'reuse-existing' as const } : {}),
    // Server setup creates providers, migrates, and prepares a data directory.
    // The remote mirror can remove ignored native output during that work, so
    // rebuild at the testkit's actual production-child spawn boundary.
    __beforeSpawnAttempt: async () => {
      const { addonPath } = await ensureProductionIrohNodeAddon({ testDir: params.testDir });
      loadIrohNodeNativeAddon(addonPath);
      const serverDir = resolve(repoRootDir(), 'apps/server');
      const stagedAddonPath = stageProductionIrohNodeAddonForConsumer({
        sourceAddonPath: addonPath,
        consumerDir: serverDir,
      });
      assertFreshProductionIrohAddonLoad(serverDir, stagedAddonPath);
    },
    extraEnv: {
      // The managed Personal Home runtime spec: loopback-only, canonical
      // audience equal to the bound loopback origin, no public ingress.
      HAPPIER_MANAGED_RELAY_PURPOSE: 'personal-home',
      HANDY_MASTER_SECRET: undefined,
      // Exercise the signer derived by the fresh Home from its persisted
      // master secret, even if the parent has operator keys.
      HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: undefined,
      HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: undefined,
      HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: undefined,
      HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: undefined,
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
  const rootDir = repoRootDir();
  return await startTestDaemon({
    ...params,
    // Daemon launch setup can outlive an ignored native artifact in the
    // synchronized mirror; establish custody at the actual child spawn.
    __beforeSpawn: async () => {
      const { addonPath } = await ensureProductionIrohNodeAddon({ testDir: params.testDir });
      loadIrohNodeNativeAddon(addonPath);
      const cliDir = resolve(repoRootDir(), 'apps/cli');
      const stagedAddonPath = stageProductionIrohNodeAddonForConsumer({
        sourceAddonPath: addonPath,
        consumerDir: cliDir,
      });
      assertFreshProductionIrohAddonLoad(cliDir, stagedAddonPath);
    },
    // This is a moving-source integration journey, not a packaged-CLI or
    // source-snapshot certification lane. Launch the real CLI command surface
    // directly from the synchronized workspace so this moving-source journey
    // does not require a separate bundled-plugin publication build.
    // Production plugin-manifest validation remains active in the child;
    // `startTestDaemon` still owns environment sanitization, process custody,
    // daemon-state readiness and shutdown.
    cliLaunchSpec: {
      command: process.execPath,
      args: [
        '--preserve-symlinks',
        '--preserve-symlinks-main',
        '--import',
        'tsx',
        resolve(rootDir, 'apps', 'cli', 'src', 'index.ts'),
      ],
      cwd: resolve(rootDir, 'apps', 'cli'),
      env: {
        TSX_TSCONFIG_PATH: resolve(rootDir, 'apps', 'cli', 'tsconfig.json'),
      },
    },
  });
}

async function waitForMachineActive(params: Readonly<{
  baseUrl: string;
  token: string;
  timeoutMs: number;
}>): Promise<MachineIdentityRow> {
  const deadline = Date.now() + params.timeoutMs;
  let lastSeen = 'none';
  while (Date.now() < deadline) {
    const machines = await fetchMachineIdentities({ baseUrl: params.baseUrl, token: params.token })
      .catch(() => []);
    const active = machines.find((machine) => machine.active === true);
    const activeIrohAuthority = readMachineIrohEndpointAuthorityV1({
      capabilities: active?.operationProtocolCapabilities,
      revision: active?.operationProtocolCapabilitiesRevision,
    });
    if (active && activeIrohAuthority) return active;
    lastSeen = machines.length === 0
      ? 'no machines registered'
      : machines.map((machine) => {
          const endpointAuthority = readMachineIrohEndpointAuthorityV1({
            capabilities: machine.operationProtocolCapabilities,
            revision: machine.operationProtocolCapabilitiesRevision,
          });
          return [
            machine.id,
            `active=${String(machine.active)}`,
            `irohEndpoint=${endpointAuthority?.endpointId ?? 'none'}`,
            `revision=${endpointAuthority?.revision ?? 'none'}`,
          ].join(':');
        }).join(', ');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for an active registered Machine with current Iroh endpoint authority (${lastSeen})`);
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

async function waitForPersistedProfileHomeConnectionDescriptor(params: Readonly<{
  cliHome: string;
  serverId: string;
  expected: HomeConnectionDescriptorV1;
  timeoutMs: number;
}>): Promise<HomeConnectionDescriptorV1> {
  const deadline = Date.now() + params.timeoutMs;
  let observed: HomeConnectionDescriptorV1 | null = null;
  while (Date.now() < deadline) {
    observed = await readPersistedProfileHomeConnectionDescriptor(params).catch(() => null);
    if (observed && isDeepStrictEqual(observed, params.expected)) return observed;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(
    `Timed out waiting for exact restarted Home descriptor adoption (expected revision=${params.expected.revision}, observed revision=${observed?.revision ?? 'none'})`,
  );
}

/**
 * Counts live machine-activity publications for one Machine observed by the
 * account-scoped socket collector. Counting events instead of comparing
 * timestamps keeps the post-restart oracle independent of wall-clock jumps.
 */
function countMachineOnlineEvents(collector: SocketCollector, machineId: string): number {
  return collector.getEvents().filter((event) =>
    event.kind === 'ephemeral'
    && event.payload.type === 'machine-activity'
    && event.payload.id === machineId
    && event.payload.active === true).length;
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
  let transferUiProfile: Readonly<{ serverId: string; serverUrl: string }> | null = null;
  let transferEndpoint: Readonly<{
    native: ReturnType<typeof createIrohNodeNativeModule>;
    endpointHandle: string;
    tunnelId: string | null;
  }> | null = null;

  afterEach(async () => {
    try {
      if (transferUiProfile) {
        await TokenStorage.removeCredentialsForServerUrl(transferUiProfile.serverUrl, {
          serverId: transferUiProfile.serverId,
        }).catch(() => undefined);
      }
      transferUiProfile = null;
      if (transferEndpoint) {
        if (transferEndpoint.tunnelId) {
          await transferEndpoint.native.stopMachineTunnel(transferEndpoint.tunnelId)
            .catch(() => undefined);
        }
        await transferEndpoint.native.shutdownEndpoint({
          endpointHandle: transferEndpoint.endpointHandle,
        }).catch(() => undefined);
        transferEndpoint = null;
      }
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

  it('keeps the spawned daemon registered over Iroh across a Home-only restart and adopts the current descriptor', async () => {
    const testDir = run.testDir(`home-iroh-composed-personal-home-${randomUUID()}`);
    const port = await reserveAvailablePort();
    const canonicalServerUrl = `http://127.0.0.1:${port}`;

    // One stable test relay for the whole journey, selected once in this
    // parent process through the canonical Iroh test controller. Both the
    // first Home process and its restart publish its URL, so the daemon has
    // relay reachability when it reacquires Iroh under automatic policy.
    relayController = requireIrohTestRelayController();
    await relayController.forceRelayOnly(process.env.HAPPIER_TEST_IROH_EXTERNAL_RELAY_URL);
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

    // Startup commits the first descriptor before public discovery. Read its
    // authenticated projection here, then confirm public discovery projects
    // the same endpoint without private direct-address hints.
    const authenticatedDescriptor =
      (await fetchAuthenticatedFeatures(server.baseUrl, auth.token)).homeConnectionDescriptor;
    const authenticatedIroh = readIrohEndpoint(authenticatedDescriptor);
    if (!authenticatedDescriptor || !authenticatedIroh) {
      throw new Error(
        `Managed Personal Home did not publish its authenticated Iroh endpoint after signup closure.\n${await readServerStartupLogs(testDir)}`,
      );
    }

    const publicDescriptor = (await fetchPublicFeatures(server.baseUrl)).homeConnectionDescriptor;
    const publicIroh = readIrohEndpoint(publicDescriptor);
    if (!publicDescriptor || !publicIroh) {
      throw new Error('Managed Personal Home did not project its committed public Iroh descriptor');
    }
    expect(publicDescriptor?.canonicalServerUrl).toBe(canonicalServerUrl);
    // Public projection never leaks private direct-address hints, and it
    // publishes exactly the configured relay fleet — the one stock test relay.
    expect(publicIroh).not.toHaveProperty('directAddresses');
    expect(publicIroh.relayUrls).toEqual([testRelayUrl]);

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

    // The parent-process observer talks to the managed Home's real loopback
    // listener. Only the spawned daemon is under carrier test; the loopback
    // canonical origin is the stable authentication audience while the daemon
    // reaches that listener through its selected Iroh runtime origin.
    accountSocket = createUserScopedSocketCollector(server.baseUrl, auth.token);
    accountSocket.connect();
    await waitFor(() => accountSocket?.isConnected() === true, {
      timeoutMs: 20_000,
      context: 'account activity observer connected before daemon startup',
    });

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
      baseUrl: server.baseUrl,
      token: auth.token,
      timeoutMs: 90_000,
    });
    const initialMachineIrohAuthority = readMachineIrohEndpointAuthorityV1({
      capabilities: registeredMachine.operationProtocolCapabilities,
      revision: registeredMachine.operationProtocolCapabilitiesRevision,
    });
    if (!initialMachineIrohAuthority) {
      throw new Error('Registered Machine did not publish its current Iroh EndpointId authority');
    }

    // Mint against the spawned Home and the endpoint authority published by
    // the spawned daemon. The Home's advertised key must verify the signature.
    const homeFeatures = FeaturesResponseSchema.parse(
      await fetchAuthenticatedFeatures(server.baseUrl, auth.token),
    );
    const signingKeys = homeFeatures.capabilities.machines.peerMediation.grantSigningKeys;
    expect(signingKeys).toHaveLength(1);
    if (!fixtureIrohAddonPath) throw new Error('Missing parent-process Iroh fixture addon');
    const transferNative = createIrohNodeNativeModule(loadIrohNodeNativeAddon(fixtureIrohAddonPath));
    // Native identity files require a private parent directory. The run's
    // shared log directory is deliberately not private, so keep this key in
    // its own mkdtemp-created 0700 directory like the native fixtures do.
    const transferIdentityDir = await mkdtemp(join(testDir, 'transfer-client-iroh-'));
    const transferKeyPath = join(transferIdentityDir, 'endpoint.key');
    const clientEndpoint = await transferNative.createEndpoint({
      keyPath: transferKeyPath,
      relayPolicy: 'automatic',
      relayUrls: [testRelayUrl],
      capProfile: 'machineBulk',
    }).catch(async (error: unknown) => {
      // Native admission can reserve a handle before key provisioning fails.
      // Release it so the controller can restore topology in afterEach while
      // the original create error remains the reported failure.
      await transferNative.shutdownEndpoint({ endpointHandle: transferKeyPath }).catch(() => undefined);
      throw error;
    });
    transferEndpoint = {
      native: transferNative,
      endpointHandle: clientEndpoint.endpointHandle,
      tunnelId: null,
    };
    const proofHandle = createEphemeralPeerRouteProofHandleV2({ randomBytes });
    const grantResponse = await fetchJson<{ ok?: boolean; grant?: unknown; reasonCode?: string }>(
      server.baseUrl + '/v1/machines/peer/mediation/route-grants',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          v: 2,
          kind: 'ephemeral_ed25519',
          ephemeralPublicKeyBase64Url: proofHandle.publicKeyBase64Url,
          machineId: registeredMachine.id,
          flowKind: 'bounded_transfer',
          routeKind: 'iroh_peer',
          endpointFingerprint: initialMachineIrohAuthority.endpointId,
          ttlMs: DIRECT_ROUTE_GRANT_TTL_MS.finiteTransferCarrier,
          scope: { kind: 'bounded_transfer', mode: 'carrier' },
          iroh: {
            initiator: { kind: 'account_client', endpointId: clientEndpoint.endpointId },
            target: { machineId: registeredMachine.id, endpointId: initialMachineIrohAuthority.endpointId },
            operationKind: 'finite_transfer',
          },
        }),
      },
    );
    expect(grantResponse.status, JSON.stringify(grantResponse.data)).toBe(200);
    expect(grantResponse.data.ok, JSON.stringify(grantResponse.data)).toBe(true);
    const grant = SignedDirectRouteGrantV2Schema.parse(grantResponse.data.grant);
    expect(grant.payload.iroh?.initiator.endpointId).toBe(clientEndpoint.endpointId);
    expect(grant.payload.iroh?.target.endpointId).toBe(initialMachineIrohAuthority.endpointId);
    const signingKey = signingKeys.find((key) => key.keyId === grant.signature.keyId);
    expect(signingKey).toBeDefined();
    if (!signingKey) throw new Error('Fresh Home grant was not signed by its advertised key');
    expect(tweetnacl.sign.detached.verify(
      new TextEncoder().encode(createDirectRouteGrantSigningInputV2(grant.payload)),
      Buffer.from(grant.signature.valueBase64Url, 'base64url'),
      Buffer.from(signingKey.publicKey, 'base64url'),
    )).toBe(true);

    // Give the direct-import uploader scoped Home credentials. This journey
    // supplies its grant, handshake, and native tunnel explicitly, then checks
    // the transferred bytes and relay path. The separate machine-carrier HTTP
    // integration test exercises production UI route selection.
    const transferProfile = await upsertAndActivateServer({
      serverUrl: canonicalServerUrl,
      scope: 'device',
    });
    transferUiProfile = { serverId: transferProfile.id, serverUrl: canonicalServerUrl };
    expect(await TokenStorage.setCredentialsForServerUrl(
      canonicalServerUrl,
      { serverId: transferProfile.id },
      buildTestAccountCliAuthCredentials({ auth, mode: 'legacy' }),
    )).toBe(true);

    const handshake = IrohMachineHandshakeV1Schema.parse({
      v: 1,
      accountId: grant.payload.accountId,
      initiator: grant.payload.iroh?.initiator,
      target: grant.payload.iroh?.target,
      flow: 'finite_transfer',
      grant,
      proof: proofHandle.sign(grant),
    });
    const transferWorkspace = join(testDir, 'transfer-workspace');
    await mkdir(transferWorkspace, { recursive: true });
    const transferBytes = randomBytes((256 * 1024) + 1);
    const transferSha256 = createHash('sha256').update(transferBytes).digest('hex');
    let observedTransferPath: string | null = null;
    const transferResult = await uploadBulkPayloadFromFileViaDirectImport<Readonly<{
      success: true;
      path: string;
      sizeBytes: number;
      sha256: string;
    }>>({
      machineId: registeredMachine.id,
      serverId: transferProfile.id,
      fileReader: {
        sizeBytes: transferBytes.byteLength,
        readBytes: async (offset, length) => transferBytes.subarray(offset, offset + length),
        close: async () => undefined,
      },
      request: {
        t: 'session_file_upload_v1',
        workingDirectory: transferWorkspace,
        path: 'iroh-composed-payload.bin',
        sizeBytes: transferBytes.byteLength,
        sha256: transferSha256,
        overwrite: true,
      },
      acquirePreparedCarrier: async () => {
        const started = await transferNative.startMachineTunnel({
          endpointHandle: clientEndpoint.endpointHandle,
          endpointId: initialMachineIrohAuthority.endpointId,
          directAddresses: [],
          relayUrls: [testRelayUrl],
          handshakeJson: JSON.stringify(handshake),
          capProfile: 'machineBulk',
        });
        transferEndpoint = {
          native: transferNative,
          endpointHandle: clientEndpoint.endpointHandle,
          tunnelId: started.machineTunnelId,
        };
        return {
          kind: 'native_http' as const,
          localOrigin: `http://127.0.0.1:${started.localPort}`,
          release: async () => {
            try {
              const status = await transferNative.getMachineTunnelStatus(started.machineTunnelId);
              observedTransferPath = status?.observedPath ?? started.observedPath;
            } finally {
              await transferNative.stopMachineTunnel(started.machineTunnelId);
              transferEndpoint = {
                native: transferNative,
                endpointHandle: clientEndpoint.endpointHandle,
                tunnelId: null,
              };
            }
          },
        };
      },
    });
    if (transferResult.success === false) {
      throw new Error(`Composed direct import failed: ${JSON.stringify({
        error: transferResult.error,
        errorCode: transferResult.errorCode ?? null,
      })}`);
    }
    expect(transferResult).toMatchObject({
      success: true,
      path: 'iroh-composed-payload.bin',
      sizeBytes: transferBytes.byteLength,
      sha256: transferSha256,
    });
    expect(observedTransferPath).toBe('relay');
    expect(transferEndpoint?.tunnelId).toBeNull();
    await expect(readFile(join(transferWorkspace, 'iroh-composed-payload.bin')))
      .resolves.toEqual(transferBytes);

    // Independently, the daemon's composition root reports the carrier for
    // its Home connection. A standard-carrier daemon would still register.
    const daemonLog = await readDaemonLog(daemon, testDir);
    expect(daemonLog).toMatch(/Home transport prepared/);
    expect(daemonLog).toMatch(/"carrier":\s*"iroh"|carrier: 'iroh'|carrier=iroh/);

    // Scoped Socket.IO publication: the account-scoped listener observes the
    // machine-activity state the daemon published over its Iroh-carried socket.
    // The observed count is kept as the baseline for the restart oracle below:
    // while this first daemon process is the only possible publisher, every
    // matching event it produced is counted before the Home restart begins.
    const machineActivityBeforeRestart =
      countMachineOnlineEvents(accountSocket, registeredMachine.id);
    expect(machineActivityBeforeRestart).toBeGreaterThan(0);

    // --- Phase 4: Home-only restart. The daemon process deliberately remains
    // alive. Its existing Socket.IO connection and Iroh lease both lose the
    // Home, so the production reconnect supervisor must reacquire the carrier,
    // refresh the descriptor and republish live Machine activity without a
    // daemon restart masking any lifecycle gap.
    const daemonPidBeforeHomeRestart = daemon.state.pid;
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
    // created. The restarted Home publishes the same stable relay set, keeping
    // relay reachability available to the still-running daemon, while the
    // descriptor revision only ever moves forward: a restart rebinds an
    // ephemeral UDP port, so its direct-address hints legitimately change.
    expect(restartedIroh?.endpointId).toBe(publicIroh?.endpointId);
    expect(restartedIroh?.relayUrls).toEqual([testRelayUrl]);
    expect(restartedDescriptor?.revision ?? 0).toBeGreaterThanOrEqual(publicDescriptor?.revision ?? 0);
    expect(isProcessAlive(daemonPidBeforeHomeRestart)).toBe(true);

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
    const restartedFeatures = FeaturesResponseSchema.parse(
      await fetchAuthenticatedFeatures(server.baseUrl, auth.token),
    );
    expect(restartedFeatures.capabilities.machines.peerMediation.grantSigningKeys).toEqual(signingKeys);
    const restartedAuthenticatedIroh = readIrohEndpoint(restartedAuthenticatedDescriptor);
    if (!restartedAuthenticatedDescriptor || !restartedAuthenticatedIroh) {
      throw new Error('Restarted Home did not republish its authenticated descriptor');
    }
    expect(restartedAuthenticatedIroh.endpointId).toBe(publicIroh?.endpointId);
    expect(restartedAuthenticatedIroh.relayUrls).toEqual([testRelayUrl]);

    const reconnectedMachine = await waitForMachineActive({
      baseUrl: server.baseUrl,
      token: auth.token,
      timeoutMs: 90_000,
    });
    expect(reconnectedMachine.id).toBe(registeredMachine.id);
    expect(isProcessAlive(daemonPidBeforeHomeRestart)).toBe(true);
    const reconnectedMachineIrohAuthority = readMachineIrohEndpointAuthorityV1({
      capabilities: reconnectedMachine.operationProtocolCapabilities,
      revision: reconnectedMachine.operationProtocolCapabilitiesRevision,
    });
    if (!reconnectedMachineIrohAuthority) {
      throw new Error('Reconnected Machine did not republish its current Iroh EndpointId authority');
    }
    expect(reconnectedMachineIrohAuthority.endpointId).toBe(initialMachineIrohAuthority.endpointId);

    // Endpoint authority is stable across a Home-only restart; a persisted
    // active Machine row and its unchanged revision do not prove reconnection.
    // The account socket survives the Home restart (socket.io reconnection),
    // so machine-activity events beyond the pre-restart baseline prove the
    // still-running daemon process published live state through a freshly
    // acquired Home transport.
    // In this loopback-only composition that transport can only be the verified Iroh
    // lease — no standard carrier is ever published, so an authenticated
    // Machine cannot publish through anything else.
    const freshActivityDeadline = Date.now() + 90_000;
    while (
      countMachineOnlineEvents(accountSocket, registeredMachine.id)
        <= machineActivityBeforeRestart
    ) {
      if (Date.now() > freshActivityDeadline) {
        throw new Error(
          'Timed out waiting for post-restart machine-activity publication from the still-running daemon',
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }

    // The fixture never rewrote the persisted profile, so the exact adoption
    // of the restarted authenticated projection is observable in the
    // daemon-owned profile: it must match the restarted projection through the
    // production reconcile owner.
    const adoptedDescriptor = await waitForPersistedProfileHomeConnectionDescriptor({
      cliHome: daemonHomeDir,
      serverId: seeded.serverId,
      expected: restartedAuthenticatedDescriptor,
      timeoutMs: 90_000,
    });
    expect(adoptedDescriptor).toEqual(restartedAuthenticatedDescriptor);
  }, 900_000);
});
