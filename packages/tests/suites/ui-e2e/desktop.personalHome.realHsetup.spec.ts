import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as privacyKit from 'privacy-kit';
import tweetnacl from 'tweetnacl';
import { readHappierCliChoiceSync } from '@happier-dev/cli-common/firstPartyRuntime';

import { seedCliAuthForServer } from '../../src/testkit/cliAuth';
import { fetchJson } from '../../src/testkit/http';
import { fetchMachineIdentities, type MachineIdentityRow } from '../../src/testkit/machineIdentity';
import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';
import {
    attachDesktopSystemTaskHost,
    createDesktopSystemTaskHost,
    type DesktopSystemTaskHost,
    type DesktopSystemTaskRecord,
} from '../../src/testkit/uiE2e/desktopSetup/desktopSystemTaskHost';
import { createHermeticDesktopComputer, type HermeticDesktopComputer } from '../../src/testkit/uiE2e/desktopSetup/hermeticDesktopComputer';
import { installFakeTauriDesktopBridge, navigateSpa } from '../../src/testkit/uiE2e/fakeTauriDesktop';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';

/**
 * Desktop first run on 0.3, end to end, with nothing between the UI and the real setup executor
 * but the desktop bridge's transport: the page is the real app (fake Tauri internals only), system
 * tasks run the real `hsetup` built from this checkout, which installs and starts this computer's
 * Personal Home (the server built from this checkout, installed as the managed `happier-server`)
 * and pins this computer's background service to it with the CLI built from this checkout, in a
 * hermetic HOME whose only test double is the systemd user manager. Every assertion reads UI
 * state, task results, Home/relay state or computer state; no step waits a fixed time.
 *
 * "Ready" is what 0.3's readiness owner proves (`usePersonalHomeBootstrapRuntime` `prepareComputer`
 * → `daemonReadyForHome`): a fresh post-setup `daemon.service.status.v1` read scoped to the Home
 * reports a running, registered daemon whose machine id, relay and account are the Home's. No
 * machine RPC is part of that proof in 0.3, so the test asserts that read, not 0.2's INV10.
 */

const run = createRunDirs({ runLabel: 'ui-e2e' });

/** The token-only pairing approval (`tokenOnlyPairingApproval.ts`); answered silently for a managed CLI. */
const PAIRING_PROMPT_KIND = 'authRequest';
/** R12's question (`setup.thisComputer.cliChoice` step); `presentCliChoice`: button 0 Keep, 1 Manage. */
const CLI_CHOICE_PROMPT_KIND = 'setup.cliChoice';
/** The terminal's own background service follows its selected server (`plan.ts` identity segment `default`). */
const DEFAULT_FOLLOWING_UNIT = 'happier-daemon.default.service';

type SeededAccount = Readonly<{ token: string; secret: Uint8Array; accountId: string }>;

async function createSeededAccount(baseUrl: string): Promise<SeededAccount> {
    const secret = Uint8Array.from(randomBytes(32));
    const keyPair = tweetnacl.sign.keyPair.fromSeed(secret);
    const challenge = Uint8Array.from(randomBytes(32));
    const signature = tweetnacl.sign.detached(challenge, keyPair.secretKey);
    const auth = await fetchJson<{ token?: string }>(`${baseUrl}/v1/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            publicKey: privacyKit.encodeBase64(Uint8Array.from(keyPair.publicKey)),
            challenge: privacyKit.encodeBase64(challenge),
            signature: privacyKit.encodeBase64(Uint8Array.from(signature)),
        }),
        timeoutMs: 15_000,
    });
    if (auth.status !== 200 || typeof auth.data?.token !== 'string') throw new Error(`account creation failed (status=${auth.status})`);
    return { token: auth.data.token, secret, accountId: await readAccountId(baseUrl, auth.data.token) };
}

async function readAccountId(baseUrl: string, token: string): Promise<string> {
    const profile = await fetchJson<{ id?: string }>(`${baseUrl}/v1/account/profile`, {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 15_000,
    });
    if (profile.status !== 200 || typeof profile.data?.id !== 'string') throw new Error(`profile read failed (status=${profile.status})`);
    return profile.data.id;
}

/** The app's stored token for `serverUrl`'s Home (`auth_credentials__srv_*`; a Personal Home account is token-only). */
async function readAppTokenForHome(page: Page, homeUrl: string): Promise<string> {
    const candidates = await page.evaluate(() => {
        const out: string[] = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith('auth_credentials__srv_')) continue;
            const value = localStorage.getItem(key);
            if (value) out.push(value);
        }
        return out;
    });
    for (const raw of candidates) {
        const token = (JSON.parse(raw) as { token?: unknown }).token;
        if (typeof token !== 'string') continue;
        const probe = await fetchJson<{ id?: string }>(`${homeUrl}/v1/account/profile`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 })
            .catch(() => null);
        if (probe?.status === 200) return token;
    }
    throw new Error(`the app holds no credential valid on ${homeUrl}`);
}

type DesktopApp = Readonly<{ page: Page; host: DesktopSystemTaskHost; diagnostics: () => string }>;

/**
 * Opens the app as the desktop shell would: Tauri internals present from the first script (main
 * window, so the Personal Home owner runs), system tasks relayed to this computer's hsetup.
 */
async function openDesktopApp(params: Readonly<{
    context: BrowserContext;
    computer: HermeticDesktopComputer;
    uiBaseUrl: string;
    path?: string;
}>): Promise<DesktopApp> {
    const page = await params.context.newPage();
    await page.setViewportSize({ width: 1280, height: 820 });
    const diagnostics = collectBrowserDiagnostics({ page });
    await installFakeTauriDesktopBridge(page, { state: { platform: 'linux' } });
    const host = await attachDesktopSystemTaskHost(page, (emit) => createDesktopSystemTaskHost({
        launch: params.computer.hsetup,
        emit,
        logPath: `${params.computer.logDir}/system-tasks.log`,
    }));
    await gotoDomContentLoadedWithRetries(page, `${params.uiBaseUrl}${params.path ?? '/'}?happier_hmr=0`, 180_000);
    return { page, host, diagnostics };
}

function tasksOfKind(host: DesktopSystemTaskHost, kind: string): DesktopSystemTaskRecord[] {
    return host.tasks().filter((task) => task.kind === kind);
}

/** Prompts a person would have to see (everything but the silent managed-CLI pairing approval). */
function userFacingPromptKinds(host: DesktopSystemTaskHost): string[] {
    return host.tasks().flatMap((task) => task.snapshot.events
        .filter((event) => event.type === 'prompt')
        .map((event) => String((event.data as { kind?: unknown } | null)?.kind ?? 'unknown'))
        .filter((kind) => kind !== PAIRING_PROMPT_KIND));
}

/** R12's question as the executor asked it (the prompt events the app answered), oldest first. */
function cliChoicePrompts(host: DesktopSystemTaskHost): Array<Readonly<{ command?: unknown; missing?: unknown }>> {
    return host.tasks().flatMap((task) => task.snapshot.events
        .filter((event) => event.type === 'prompt' && (event.data as { kind?: unknown } | null)?.kind === CLI_CHOICE_PROMPT_KIND)
        .map((event) => ((event.data as { data?: unknown } | null)?.data ?? event.data) as { command?: unknown; missing?: unknown }));
}

/** Waits for the first R12 question, checks it names `command`, answers it in the app (`presentCliChoice`). */
async function answerCliChoice(app: DesktopApp, command: string, answer: 'own' | 'managed', timeoutMs: number): Promise<Readonly<{ command?: unknown; missing?: unknown }>> {
    await expect.poll(() => cliChoicePrompts(app.host).length, { message: 'setup never asked which command line to use', timeout: timeoutMs })
        .toBeGreaterThan(0);
    const question = cliChoicePrompts(app.host)[0]!;
    expect(question.command).toBe(command);
    await app.page.getByTestId(answer === 'own' ? 'web-modal-button-0' : 'web-modal-button-1').click({ timeout: 60_000 });
    return question;
}

async function waitForSuccessfulTask(host: DesktopSystemTaskHost, kind: string, timeoutMs: number): Promise<DesktopSystemTaskRecord> {
    try {
        await expect.poll(() => tasksOfKind(host, kind).some((task) => task.snapshot.result?.ok === true), {
            message: `${kind} never succeeded`,
            timeout: timeoutMs,
        }).toBe(true);
    } catch (error) {
        const failures = host.tasks()
            .filter((task) => task.snapshot.result?.ok === false)
            .map((task) => ({ kind: task.kind, result: task.snapshot.result }));
        if (error instanceof Error) error.message += `\nfailed tasks so far: ${JSON.stringify(failures)}`;
        throw error;
    }
    return tasksOfKind(host, kind).find((task) => task.snapshot.result?.ok === true)!;
}

type HomeSetup = Readonly<{ homeUrl: string; homeIdentityId: string; machineId: string; setup: DesktopSystemTaskRecord }>;

/** The app's successful `setup.thisComputer.v1` for its Personal Home: explicit Home, explicit identity. */
function readHomeSetup(setup: DesktopSystemTaskRecord): HomeSetup {
    const params = setup.params as { activeRelayUrl?: unknown; activeServerIdentityId?: unknown } | null;
    const result = setup.snapshot.result;
    const machineId = result?.ok ? (result.data as { machineId?: unknown } | null)?.machineId : null;
    if (typeof params?.activeRelayUrl !== 'string' || typeof params.activeServerIdentityId !== 'string' || typeof machineId !== 'string') {
        throw new Error(`setup run lacks the Home descriptor or machine id: ${JSON.stringify({ params: setup.params, result })}`);
    }
    return { homeUrl: params.activeRelayUrl.replace(/\/+$/u, ''), homeIdentityId: params.activeServerIdentityId, machineId, setup };
}

async function waitForActiveMachine(params: Readonly<{ baseUrl: string; token: string; machineId: string; timeoutMs: number }>): Promise<MachineIdentityRow> {
    let row: MachineIdentityRow | undefined;
    await expect.poll(async () => {
        row = (await fetchMachineIdentities({ baseUrl: params.baseUrl, token: params.token })).find((machine) => machine.id === params.machineId);
        return row?.active === true;
    }, { message: `machine ${params.machineId} never became active for the Home account`, timeout: params.timeoutMs }).toBe(true);
    return row!;
}

function daemonUnits(computer: HermeticDesktopComputer, active = true): string[] {
    return (active ? computer.activeUnits() : computer.installedUnits()).filter((unit) => unit.startsWith('happier-daemon'));
}

function homeRuntimeUnits(computer: HermeticDesktopComputer, active = true): string[] {
    return (active ? computer.activeUnits() : computer.installedUnits()).filter((unit) => !unit.startsWith('happier-daemon'));
}

/** The Personal Home gate has let the shell through: no setup surface, no failure, the Home renders. */
async function expectShellPastHomeGate(app: DesktopApp, timeoutMs: number): Promise<void> {
    await expect(app.page.getByTestId('personal-home-setup-surface')).toHaveCount(0, { timeout: timeoutMs });
    await expect(app.page.getByTestId('personal-home-bootstrap-failure')).toHaveCount(0);
    await expect(app.page.getByTestId('nav-settings').first()).toBeVisible({ timeout: timeoutMs });
}

type DaemonStatusFacts = Readonly<{
    serviceInstalled?: unknown;
    daemonRunning?: unknown;
    needsAuth?: unknown;
    machineId?: unknown;
    daemonServerUrl?: unknown;
    daemonAccountId?: unknown;
    daemonMachineRegistered?: unknown;
}>;

/**
 * 0.3's readiness proof, read where production reads it: a `daemon.service.status.v1` the app ran
 * after `setupRun`, scoped to the Home (`relayUrl` + identity), reporting a running registered
 * daemon on this machine id, on the Home's relay, as the Home account (`daemonReadyForHome`).
 */
async function expectReadyByHomeStatusRead(params: Readonly<{ app: DesktopApp; home: HomeSetup; accountId: string; timeoutMs: number }>): Promise<void> {
    const setupIndex = params.app.host.tasks().findIndex((task) => task.taskId === params.home.setup.taskId);
    const readyRead = () => params.app.host.tasks().slice(setupIndex + 1).find((task) => {
        if (task.kind !== 'daemon.service.status.v1' || task.snapshot.result?.ok !== true) return false;
        const scope = task.params as { relayUrl?: unknown; serverIdentityId?: unknown } | null;
        const facts = task.snapshot.result.data as DaemonStatusFacts | null;
        return typeof scope?.relayUrl === 'string' && scope.relayUrl.replace(/\/+$/u, '') === params.home.homeUrl
            && scope.serverIdentityId === params.home.homeIdentityId
            && facts?.serviceInstalled === true && facts.daemonRunning === true && facts.needsAuth !== true
            && facts.machineId === params.home.machineId
            && facts.daemonMachineRegistered !== false
            && typeof facts.daemonServerUrl === 'string' && facts.daemonServerUrl.replace(/\/+$/u, '') === params.home.homeUrl
            && facts.daemonAccountId === params.accountId;
    });
    try {
        await expect.poll(() => Boolean(readyRead()), {
            message: `no post-setup Home-scoped status read proved machine ${params.home.machineId} ready for ${params.home.homeUrl}`,
            timeout: params.timeoutMs,
        }).toBe(true);
    } catch (error) {
        const reads = params.app.host.tasks().filter((task) => task.kind === 'daemon.service.status.v1').map((task) => ({ params: task.params, result: task.snapshot.result }));
        if (error instanceof Error) error.message += `\nstatus reads: ${JSON.stringify(reads)}`;
        throw error;
    }
}

/** The fresh-Home run: the app installs the Home, closes its signup, pins this computer's service to it. */
async function expectFreshHomeSetUp(app: DesktopApp, computer: HermeticDesktopComputer): Promise<HomeSetup> {
    await waitForSuccessfulTask(app.host, 'relay.runtime.installOrUpdate.v1', 420_000);
    const home = readHomeSetup(await waitForSuccessfulTask(app.host, 'setup.thisComputer.v1', 420_000));
    expect(home.setup.params).toMatchObject({ surface: 'desktop.ui', installService: true, startService: true, verifyService: true });
    expect(new URL(home.homeUrl).hostname).toBe('127.0.0.1');
    await expectShellPastHomeGate(app, 180_000);
    const token = await readAppTokenForHome(app.page, home.homeUrl);
    await waitForActiveMachine({ baseUrl: home.homeUrl, token, machineId: home.machineId, timeoutMs: 120_000 });
    expect(homeRuntimeUnits(computer), 'the Home runtime is not running under the user manager').toHaveLength(1);
    const pinned = daemonUnits(computer).filter((unit) => unit !== DEFAULT_FOLLOWING_UNIT);
    expect(pinned, 'no background service is pinned to the Home').toHaveLength(1);
    // Signup is loopback bootstrap, then closed: a correctly signed new-account request is refused.
    await expect(createSeededAccount(home.homeUrl), 'the Personal Home still accepts new accounts').rejects.toThrow(/account creation failed/);
    return home;
}

function readTerminalActiveServerId(computer: HermeticDesktopComputer): string | null {
    const settingsPath = join(computer.happierHomeDir, 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const value = (JSON.parse(readFileSync(settingsPath, 'utf8')) as { activeServerId?: unknown }).activeServerId;
    return typeof value === 'string' ? value : null;
}

/** The terminal CLI's saved profile for `homeUrl` (`server list --json`). */
async function readTerminalServerIdForUrl(computer: HermeticDesktopComputer, homeUrl: string): Promise<string> {
    const listed = await computer.runCli(['server', 'list', '--json'], { timeoutMs: 120_000 });
    const found: string[] = [];
    const visit = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        const url = typeof record.serverUrl === 'string' ? record.serverUrl.replace(/\/+$/u, '') : null;
        if (url === homeUrl && typeof record.id === 'string') found.push(record.id);
        Object.values(record).forEach(visit);
    };
    visit(JSON.parse(listed.stdout.slice(listed.stdout.indexOf('{'))));
    if (found.length === 0) throw new Error(`the terminal CLI has no profile for ${homeUrl}:\n${listed.stdout}`);
    return found[0]!;
}

/** The running daemons' pids, from the state files the daemons write per server profile. */
function readRunningDaemonPidsByServer(computer: HermeticDesktopComputer): Record<string, number> {
    const serversDir = join(computer.happierHomeDir, 'servers');
    const out: Record<string, number> = {};
    if (!existsSync(serversDir)) return out;
    for (const serverId of readdirSync(serversDir)) {
        const statePath = join(serversDir, serverId, 'daemon.state.json');
        if (!existsSync(statePath)) continue;
        const pid = Number((JSON.parse(readFileSync(statePath, 'utf8')) as { pid?: unknown }).pid);
        if (Number.isInteger(pid) && isProcessAlive(pid)) out[serverId] = pid;
    }
    return out;
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

const MUTATING_SYSTEMCTL_VERBS = new Set(['daemon-reload', 'enable', 'disable', 'restart', 'stop', 'start']);

function mutatingSystemctlCalls(computer: HermeticDesktopComputer): string[][] {
    return computer.systemctlInvocations().filter((argv) => argv.some((arg) => MUTATING_SYSTEMCTL_VERBS.has(arg)));
}

test.describe('ui e2e: desktop Personal Home setup through the real hsetup (hermetic computer)', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(process.platform !== 'linux', 'the hermetic computer models the systemd user manager (Linux only)');

    const suiteDir = run.testDir('desktop-personal-home-real-hsetup-suite');
    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let uiBaseUrl = '';
    const computers: HermeticDesktopComputer[] = [];

    const uiWebEnv: NodeJS.ProcessEnv = {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
        // No runner-mode override: with Tauri internals present the app picks its real Tauri bridge.
        EXPO_PUBLIC_SYSTEM_TASKS_RUNNER_MODE: '',
    };

    test.beforeAll(async () => {
        test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
        await mkdir(suiteDir, { recursive: true });
        // A relay the user set up themselves (and, being sqlite, the migrated schema template every
        // hermetic Home starts from).
        server = await startServerLight({
            testDir: suiteDir,
            dbProvider: 'sqlite',
            extraEnv: { HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys' },
        });
        ui = await startUiWeb({ testDir: suiteDir, env: { ...uiWebEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl } });
        uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    });

    test.afterEach(async () => {
        for (const computer of computers.splice(0)) await computer.destroy();
    });

    test.afterAll(async () => {
        test.setTimeout(120_000);
        await ui?.stop().catch(() => {});
        await server?.stop().catch(() => {});
    });

    async function newComputer(label: string, options: Readonly<{ ring?: 'stable' | 'publicdev'; foreignCli?: boolean }> = {}): Promise<HermeticDesktopComputer> {
        const computer = await createHermeticDesktopComputer({ label, testDir: run.testDir(`desktop-personal-home-${label}`), ...options });
        computers.push(computer);
        return computer;
    }

    test('fresh Personal Home: the app creates this computer\'s Home, pins its service to it, asks nothing; a cold deep link then changes nothing', async ({ context }) => {
        test.setTimeout(900_000);
        const computer = await newComputer('fresh');
        const app = await openDesktopApp({ context, computer, uiBaseUrl });
        let home: HomeSetup;
        try {
            home = await expectFreshHomeSetUp(app, computer);
            expect(home.setup.params).toMatchObject({ channel: 'dev', activeLocalRelayUrl: home.setup.params && (home.setup.params as { activeRelayUrl?: string }).activeRelayUrl });
            expect(userFacingPromptKinds(app.host)).toEqual([]);
            await expect(app.page.getByTestId('web-modal-confirm')).toHaveCount(0);
            const token = await readAppTokenForHome(app.page, home.homeUrl);
            await expectReadyByHomeStatusRead({ app, home, accountId: await readAccountId(home.homeUrl, token), timeoutMs: 180_000 });
        } catch (error) {
            throw appendBrowserDiagnostics(error, app.diagnostics());
        }
        await app.page.close();

        // Cold deep link on the next launch: the Home is complete, so nothing is set up again.
        const before = computer.stateFingerprint();
        const daemonPidsBefore = readRunningDaemonPidsByServer(computer);
        const mutatingBefore = mutatingSystemctlCalls(computer).length;
        const again = await openDesktopApp({ context, computer, uiBaseUrl, path: '/settings/machines/this-computer' });
        try {
            await expect(again.page.getByTestId('settings.localDaemonControl.machineId')).toContainText(home.machineId, { timeout: 240_000 });
            await expectShellPastHomeGate(again, 120_000);
            expect(tasksOfKind(again.host, 'setup.thisComputer.v1')).toEqual([]);
            expect(tasksOfKind(again.host, 'relay.runtime.installOrUpdate.v1')).toEqual([]);
            expect(userFacingPromptKinds(again.host)).toEqual([]);
            expect(computer.stateFingerprint()).toEqual(before);
            expect(readRunningDaemonPidsByServer(computer)).toEqual(daemonPidsBefore);
            expect(mutatingSystemctlCalls(computer).slice(mutatingBefore)).toEqual([]);
        } catch (error) {
            throw appendBrowserDiagnostics(error, again.diagnostics());
        }
    });

    /**
     * R10 D3 + the stand-by rule: the user's own default-following service (set up from the terminal
     * on another relay) is left exactly as it is; the Home gets its own pinned service beside it and
     * the terminal's selection never moves. After `happier server use <home>` the default-following
     * service stands by for the Home's pinned one, and the desktop still reads this computer ready.
     */
    test('a default-following service the user set up stays; the Home gets its own pinned service; after `server use <home>` the default one stands by', async ({ context }) => {
        test.setTimeout(900_000);
        if (!server) throw new Error('missing server');
        const computer = await newComputer('standby');
        const own = await createSeededAccount(server.baseUrl);
        const { serverId: ownServerId } = await seedCliAuthForServer({ cliHome: computer.happierHomeDir, serverUrl: server.baseUrl, token: own.token, secret: own.secret });
        await computer.runCli(['daemon', 'service', 'install', '--json'], { timeoutMs: 240_000 });
        await expect.poll(() => daemonUnits(computer), { message: 'the terminal-installed default-following service never ran', timeout: 120_000 })
            .toEqual([DEFAULT_FOLLOWING_UNIT]);
        const ownCredentialsPath = join(computer.happierHomeDir, 'servers', ownServerId, 'access.key');
        const ownCredentialsBefore = computer.stateFingerprint()[ownCredentialsPath];
        const ownUnitPath = join(computer.unitDir, DEFAULT_FOLLOWING_UNIT);
        const ownUnitBefore = computer.stateFingerprint()[ownUnitPath];
        await expect.poll(() => readRunningDaemonPidsByServer(computer)[ownServerId] ?? null, { timeout: 120_000 }).not.toBeNull();
        const ownDaemonPid = readRunningDaemonPidsByServer(computer)[ownServerId];

        const app = await openDesktopApp({ context, computer, uiBaseUrl });
        let home: HomeSetup;
        try {
            home = await expectFreshHomeSetUp(app, computer);
            expect(userFacingPromptKinds(app.host)).toEqual([]);
            // The user's own service, credentials and daemon are untouched, and the terminal still follows its relay.
            expect(computer.stateFingerprint()[ownCredentialsPath]).toBe(ownCredentialsBefore);
            expect(computer.stateFingerprint()[ownUnitPath]).toBe(ownUnitBefore);
            expect(readRunningDaemonPidsByServer(computer)[ownServerId]).toBe(ownDaemonPid);
            expect(readTerminalActiveServerId(computer)).toBe(ownServerId);
            expect(daemonUnits(computer)).toContain(DEFAULT_FOLLOWING_UNIT);
            expect(daemonUnits(computer).filter((unit) => unit !== DEFAULT_FOLLOWING_UNIT)).toHaveLength(1);
        } catch (error) {
            throw appendBrowserDiagnostics(error, app.diagnostics());
        }

        // From a terminal: follow the Home. The default-following service stands by for its pinned one.
        const homeServerId = await readTerminalServerIdForUrl(computer, home.homeUrl);
        await computer.runCli(['server', 'use', homeServerId], { timeoutMs: 240_000 });
        await expect.poll(() => daemonUnits(computer).includes(DEFAULT_FOLLOWING_UNIT), {
            message: 'the default-following service kept running for a server that has its own pinned service',
            timeout: 180_000,
        }).toBe(false);
        expect(daemonUnits(computer), 'the Home\'s pinned service stopped').toHaveLength(1);
        expect(daemonUnits(computer, false)).toContain(DEFAULT_FOLLOWING_UNIT);

        // The desktop still reads this computer ready for the Home, and sets nothing up again.
        const setupRunsBefore = tasksOfKind(app.host, 'setup.thisComputer.v1').length;
        try {
            await navigateSpa(app.page, '/settings/machines/this-computer?happier_hmr=0');
            await app.page.getByTestId('settings.localDaemonControl.refresh').click({ timeout: 120_000 });
            await expect(app.page.getByTestId('settings.localDaemonControl.machineId')).toContainText(home.machineId, { timeout: 180_000 });
            await expect(app.page.getByTestId('settings.localDaemonControl.repair')).toBeDisabled({ timeout: 60_000 });
            const token = await readAppTokenForHome(app.page, home.homeUrl);
            await waitForActiveMachine({ baseUrl: home.homeUrl, token, machineId: home.machineId, timeoutMs: 120_000 });
            expect(tasksOfKind(app.host, 'setup.thisComputer.v1')).toHaveLength(setupRunsBefore);
        } catch (error) {
            throw appendBrowserDiagnostics(error, app.diagnostics());
        }
    });

    /**
     * Home identity: the Home at this computer's canonical URL is recreated (its data is gone, so
     * the runtime comes back with a new server identity at the same URL). The app's completed
     * profile is bound to the old identity, so it must not read the new Home as ready: it signs in
     * to the new Home and re-pairs this computer's pinned service for the new identity.
     */
    test('Home recreated at the same URL: nothing is inherited from the old identity; this computer is re-paired for the new one', async ({ context }) => {
        test.setTimeout(1_200_000);
        const computer = await newComputer('identity');
        const first = await openDesktopApp({ context, computer, uiBaseUrl });
        let original: HomeSetup;
        try {
            original = await expectFreshHomeSetUp(first, computer);
        } catch (error) {
            throw appendBrowserDiagnostics(error, first.diagnostics());
        }
        await first.page.close();

        // Recreate the Home in place: stop its runtime, remove its data, keep its install and URL.
        const [runtimeUnit] = homeRuntimeUnits(computer, false);
        if (!runtimeUnit) throw new Error('no Home runtime unit');
        const databases = listFilesNamed(computer.homeDir, 'happier-server-light.sqlite');
        expect(databases, 'the Home runtime has no database').toHaveLength(1);
        stopUnit(computer, runtimeUnit);
        await rm(databases[0]!.slice(0, databases[0]!.lastIndexOf('/')), { recursive: true, force: true });

        const second = await openDesktopApp({ context, computer, uiBaseUrl });
        try {
            const setup = await waitForSuccessfulTask(second.host, 'setup.thisComputer.v1', 600_000);
            const recreated = readHomeSetup(setup);
            expect(recreated.homeUrl).toBe(original.homeUrl);
            expect(recreated.homeIdentityId).not.toBe(original.homeIdentityId);
            await expectShellPastHomeGate(second, 180_000);
            const token = await readAppTokenForHome(second.page, recreated.homeUrl);
            await waitForActiveMachine({ baseUrl: recreated.homeUrl, token, machineId: recreated.machineId, timeoutMs: 120_000 });
            expect(userFacingPromptKinds(second.host)).toEqual([]);
        } catch (error) {
            throw appendBrowserDiagnostics(error, second.diagnostics());
        }
    });

    test('a failure Retry cannot fix (no user service manager): named once, Retry fails the same way, the app does not pretend', async ({ context }) => {
        test.setTimeout(600_000);
        const computer = await newComputer('blocked');
        computer.setUserManagerAvailable(false);
        const app = await openDesktopApp({ context, computer, uiBaseUrl });
        try {
            const failure = app.page.getByTestId('personal-home-bootstrap-failure');
            await expect(failure).toBeVisible({ timeout: 420_000 });
            const failedBefore = app.host.tasks().filter((task) => task.snapshot.result?.ok === false).length;
            expect(failedBefore).toBeGreaterThan(0);
            await app.page.getByTestId('personal-home-bootstrap-retry').click();
            await expect.poll(() => app.host.tasks().filter((task) => task.snapshot.result?.ok === false).length, {
                message: 'Retry did not run the failing step again',
                timeout: 300_000,
            }).toBeGreaterThan(failedBefore);
            await expect(failure).toBeVisible({ timeout: 120_000 });
            expect(tasksOfKind(app.host, 'setup.thisComputer.v1').filter((task) => task.snapshot.result?.ok === true)).toEqual([]);
            expect(computer.activeUnits()).toEqual([]);
        } catch (error) {
            throw appendBrowserDiagnostics(error, app.diagnostics());
        }
    });

    /**
     * R12 on the Personal Home flow: a user-installed `happier` is asked about before the Home's
     * service uses any CLI. Manage: the question is the only user-facing prompt, pairing is silent
     * for the managed CLI, the Home is proven ready, and This computer still names the old copy.
     */
    test('R12 Manage: the npm CLI is asked about once; setup converges on the managed CLI and Settings lists the old copy', async ({ context }) => {
        test.setTimeout(900_000);
        const computer = await newComputer('cli-manage', { ring: 'stable', foreignCli: true });
        const own = computer.foreignCli!;
        const app = await openDesktopApp({ context, computer, uiBaseUrl });
        try {
            const question = await answerCliChoice(app, own.command, 'managed', 600_000);
            expect(question.missing).not.toBe(true);
            const home = await expectFreshHomeSetUp(app, computer);
            expect(readHappierCliChoiceSync({ processEnv: computer.env })).toEqual({ mode: 'managed' });
            expect(userFacingPromptKinds(app.host)).toEqual([CLI_CHOICE_PROMPT_KIND]);
            const token = await readAppTokenForHome(app.page, home.homeUrl);
            await expectReadyByHomeStatusRead({ app, home, accountId: await readAccountId(home.homeUrl, token), timeoutMs: 180_000 });
            await navigateSpa(app.page, '/settings/machines/this-computer?happier_hmr=0');
            const oldCli = app.page.getByTestId('settings.localDaemonControl.oldCli');
            await expect(oldCli).toContainText(own.command, { timeout: 180_000 });
            await expect(oldCli).toContainText('npm uninstall -g @happier-dev/cli');
            expect(existsSync(own.command)).toBe(true);
        } catch (error) {
            throw appendBrowserDiagnostics(error, app.diagnostics());
        }
    });

    /**
     * R12 Keep, then the kept CLI disappears: Keep records the user's CLI (its pairing is a
     * non-managed provenance, so a person confirms it once); after `npm uninstall` the next launch
     * asks again about the same path (`missing`) before any other CLI is used; Manage converges.
     */
    test('R12 Keep, then that CLI is removed: the next launch asks again before using another CLI', async ({ context }) => {
        test.setTimeout(1_200_000);
        const computer = await newComputer('cli-keep', { foreignCli: true });
        const own = computer.foreignCli!;
        const first = await openDesktopApp({ context, computer, uiBaseUrl });
        try {
            await answerCliChoice(first, own.command, 'own', 600_000);
            await first.page.getByTestId('web-modal-confirm').click({ timeout: 600_000 });
            await expectFreshHomeSetUp(first, computer);
            expect(readHappierCliChoiceSync({ processEnv: computer.env })).toEqual({ mode: 'own', command: own.command });
        } catch (error) {
            throw appendBrowserDiagnostics(error, first.diagnostics());
        }
        await first.page.close();

        own.remove();
        const second = await openDesktopApp({ context, computer, uiBaseUrl });
        try {
            const question = await answerCliChoice(second, own.command, 'managed', 600_000);
            expect(question.missing).toBe(true);
            await expect.poll(() => readHappierCliChoiceSync({ processEnv: computer.env }), { timeout: 600_000 }).toEqual({ mode: 'managed' });
            expect(userFacingPromptKinds(second.host).filter((kind) => kind !== CLI_CHOICE_PROMPT_KIND)).toEqual([]);
            await expectShellPastHomeGate(second, 600_000);
        } catch (error) {
            throw appendBrowserDiagnostics(error, second.diagnostics());
        }
    });
});

function stopUnit(computer: HermeticDesktopComputer, unit: string): void {
    const result = spawnSync(join(computer.homeDir, '.hermetic-bin', 'systemctl'), ['--user', 'stop', unit], {
        env: computer.env,
        encoding: 'utf8',
        timeout: 120_000,
    });
    if (result.status !== 0) throw new Error(`systemctl --user stop ${unit} failed: ${result.stderr}`);
}

function listFilesNamed(root: string, name: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.hermetic')) continue;
                walk(path);
            } else if (entry.name === name) {
                out.push(path);
            }
        }
    };
    walk(root);
    return out;
}
