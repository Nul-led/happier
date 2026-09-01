import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseHomeQrInviteV2Payload } from '@happier-dev/protocol';

import { createTestAuth, type TestAuth } from '../../src/testkit/auth';
import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { buildAuthBootstrapStorageSnapshot } from '../../src/testkit/uiE2e/buildAuthBootstrapStorageSnapshot';
import { installAuthBootstrapStorageSnapshot, type AuthBootstrapStorageSnapshot } from '../../src/testkit/uiE2e/readLegacyAuthSecretFromLocalStorage';
import { secretBearingBrowserCapturePolicy } from '../../src/testkit/uiE2e/secretBearingBrowserCapture';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { resolveCanonicalServerIdForUi } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';

const run = createRunDirs({ runLabel: 'ui-e2e' });
test.use(secretBearingBrowserCapturePolicy);
const storageScope = `e2e-${run.runId}-pairing`;

type CredentialKind = 'tokenOnly' | 'dataKey';
type HomeFixture = Readonly<{
  server: StartedServer;
  auth: TestAuth;
  serverIdentityId: string;
  credentialKind: CredentialKind;
}>;
type BrowserHomeState = Readonly<{
  activeServerId: string | null;
  homeViewState: unknown;
  activeProfile: unknown;
  profiles: Readonly<Record<string, unknown>>;
  credentialsByKey: Readonly<Record<string, string>>;
}>;
type StoredCredentials = Readonly<{
  storageKey: string;
  value: Readonly<Record<string, unknown>>;
}>;

function collectBrowserDiagnostics(page: Page): () => string {
  const entries: string[] = [];
  page.on('console', (message) => entries.push(`console.${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => entries.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    entries.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) entries.push(`response: ${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return () => entries.slice(-80).join('\n') || 'No browser errors were captured.';
}

const REQUIRED_ENROLLMENT_PATHS = new Set([
  '/v1/auth/pairing/start',
  '/v1/auth/pairing/request',
  '/v1/auth/pairing/status',
  '/v1/auth/account/response',
  '/v2/auth/account/request',
]);
const TRACKED_ENROLLMENT_PATHS = new Set([
  ...REQUIRED_ENROLLMENT_PATHS,
  '/v1/auth/pairing/consume',
]);
const FORBIDDEN_DIRECT_QR_UI_IDS = [
  'restore-scan-confirm-code',
  'add-phone-request-confirm-code',
  'add-phone-approve',
  'add-phone-reject',
] as const;
const FORBIDDEN_DIRECT_QR_OBSERVER_KEY = '__happierLane09ForbiddenDirectQrUi';

async function observeForbiddenDirectQrUi(page: Page): Promise<void> {
  await page.evaluate(({ key, testIds }) => {
    const seen = new Set<string>();
    const scan = () => {
      for (const testId of testIds) {
        if (document.querySelector(`[data-testid="${testId}"]`)) seen.add(testId);
      }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    Reflect.set(window, key, { observer, seen });
  }, { key: FORBIDDEN_DIRECT_QR_OBSERVER_KEY, testIds: FORBIDDEN_DIRECT_QR_UI_IDS });
}

async function readObservedForbiddenDirectQrUi(page: Page): Promise<readonly string[]> {
  return await page.evaluate((key) => {
    const state = Reflect.get(window, key) as { seen?: Set<string> } | undefined;
    return state?.seen ? [...state.seen].sort() : [];
  }, FORBIDDEN_DIRECT_QR_OBSERVER_KEY);
}

function withVisibleHomeAGroup(snapshot: AuthBootstrapStorageSnapshot): AuthBootstrapStorageSnapshot {
  const localStorage = { ...snapshot.localStorage };
  for (const [key, raw] of Object.entries(localStorage)) {
    if (!key.includes('server-state-v1')) continue;
    const state = JSON.parse(raw) as { activeServerId?: unknown; homeViewState?: unknown };
    const activeServerId = typeof state.activeServerId === 'string' ? state.activeServerId : '';
    if (!activeServerId) throw new Error('Home A bootstrap is missing activeServerId');
    state.homeViewState = {
      version: 1,
      groups: [{ id: 'home-a-visible', name: 'Home A visible', serverIds: [activeServerId] }],
      activeTargetKind: 'server',
      activeTargetId: activeServerId,
    };
    localStorage[key] = JSON.stringify(state);
  }
  return { localStorage, sessionStorage: snapshot.sessionStorage };
}

async function openAuthenticatedPage(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
  home: HomeFixture;
  withVisibleGroup?: boolean;
}>): Promise<void> {
  const browserDiagnostics = collectBrowserDiagnostics(params.page);
  const snapshot = buildAuthBootstrapStorageSnapshot({
    serverUrl: params.home.server.baseUrl,
    auth: params.home.auth,
    mode: params.home.credentialKind,
    storageScope,
    serverIdentityId: params.home.serverIdentityId,
  });
  await installAuthBootstrapStorageSnapshot(
    params.page,
    params.withVisibleGroup ? withVisibleHomeAGroup(snapshot) : snapshot,
  );
  await gotoDomContentLoadedWithRetries(params.page, params.uiBaseUrl, 180_000);
  await waitForInitialAppUi({ page: params.page, timeoutMs: 180_000, browserDiagnostics });
}

async function readHomeState(page: Page): Promise<BrowserHomeState> {
  return await page.evaluate(() => {
    const states: Array<Record<string, unknown>> = [];
    const credentialsByKey: Record<string, string> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      if (key.includes('server-state-v1')) {
        try {
          states.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          // Ignore unrelated malformed compatibility state.
        }
      }
      if (key === 'auth_credentials' || key.includes('auth_credentials__srv_')) {
        credentialsByKey[key] = raw;
      }
    }
    const sessionActiveServerId = window.sessionStorage.getItem('activeServerId');
    const state = states.find((candidate) => candidate.activeServerId === sessionActiveServerId) ?? states[0] ?? null;
    const servers = state?.servers && typeof state.servers === 'object' ? state.servers as Record<string, unknown> : {};
    const activeServerId = typeof state?.activeServerId === 'string' ? state.activeServerId : sessionActiveServerId;
    return {
      activeServerId,
      homeViewState: state?.homeViewState ?? null,
      activeProfile: activeServerId ? servers[activeServerId] ?? null : null,
      profiles: servers,
      credentialsByKey,
    };
  });
}

async function readCredentialsForStableIdentity(page: Page, serverIdentityId: string): Promise<StoredCredentials> {
  return await page.evaluate((identity) => {
    const scope = `auth_credentials__srv_${identity.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_')}`;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.toLowerCase().includes(scope)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (typeof value.token === 'string' && value.token.length > 0) return { storageKey: key, value };
    }
    throw new Error(`No credentials stored for stable Home identity ${identity}`);
  }, serverIdentityId);
}

function trackEnrollmentRequests(page: Page, sink: URL[]): void {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (TRACKED_ENROLLMENT_PATHS.has(url.pathname)) sink.push(url);
  });
}

async function runEnrollmentScenario(params: Readonly<{
  browser: Browser;
  uiBaseUrl: string;
  homeA: HomeFixture;
  homeB: HomeFixture;
}>): Promise<void> {
  let homeAContext: BrowserContext | null = null;
  let homeBContext: BrowserContext | null = null;
  try {
    homeAContext = await params.browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      hasTouch: true,
    });
    homeBContext = await params.browser.newContext({ viewport: { width: 1280, height: 844 } });
    await homeAContext.grantPermissions(['camera'], { origin: params.uiBaseUrl }).catch(() => {});

    const joiningPage = await homeAContext.newPage();
    const trustedHomeBPage = await homeBContext.newPage();
    await openAuthenticatedPage({ page: joiningPage, uiBaseUrl: params.uiBaseUrl, home: params.homeA, withVisibleGroup: true });
    await openAuthenticatedPage({ page: trustedHomeBPage, uiBaseUrl: params.uiBaseUrl, home: params.homeB });

    const homeABefore = await readHomeState(joiningPage);
    expect(homeABefore.activeServerId).not.toBeNull();
    expect(homeABefore.homeViewState).toMatchObject({ version: 1, groups: [{ id: 'home-a-visible' }] });

    const enrollmentRequests: URL[] = [];
    trackEnrollmentRequests(joiningPage, enrollmentRequests);
    trackEnrollmentRequests(trustedHomeBPage, enrollmentRequests);

    await gotoDomContentLoadedWithRetries(trustedHomeBPage, `${params.uiBaseUrl}/settings`, 180_000);
    await expect(trustedHomeBPage.getByTestId('settings-add-your-phone-shortcut')).toHaveCount(1, { timeout: 120_000 });
    await trustedHomeBPage.getByTestId('settings-add-your-phone-shortcut').click();
    await expect(trustedHomeBPage).toHaveURL(/\/settings\/add-phone/, { timeout: 60_000 });
    await expect(trustedHomeBPage.getByTestId('add-phone-pairing-link')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-show-link')).toHaveCount(1, { timeout: 120_000 });
    await trustedHomeBPage.getByTestId('add-phone-show-link').click();
    const pairingLink = trustedHomeBPage.getByTestId('add-phone-pairing-link');
    await expect(pairingLink).toHaveCount(1, { timeout: 120_000 });
    const pairingLinkRaw = (await pairingLink.innerText()).trim();

    const pairingUrl = new URL(pairingLinkRaw);
    expect(pairingUrl.protocol.startsWith('happier')).toBe(true);
    expect(pairingUrl.pathname).toBe('/pair');
    expect(pairingUrl.hash).toBe('');
    expect([...pairingUrl.searchParams.keys()].sort()).toEqual(['payload', 'v']);
    expect(pairingUrl.searchParams.get('v')).toBe('2');
    expect(pairingUrl.searchParams.has('pairId')).toBe(false);
    expect(pairingUrl.searchParams.has('secret')).toBe(false);
    const invite = parseHomeQrInviteV2Payload(pairingUrl.searchParams.get('payload') ?? '', { nowMs: Date.now() });
    expect(invite).toMatchObject({
      v: 2,
      intent: 'home_device',
      home: { homeServerIdentityId: params.homeB.serverIdentityId, canonicalServerUrl: params.homeB.server.baseUrl },
    });
    expect(invite?.home.endpoints).toContainEqual({ kind: 'https', url: params.homeB.server.baseUrl });
    expect(Buffer.from(invite?.qrSecretBase64Url ?? '', 'base64url')).toHaveLength(32);

    await gotoDomContentLoadedWithRetries(joiningPage, `${params.uiBaseUrl}/restore`, 180_000);
    const manualLinkButton = joiningPage.getByTestId('restore-enter-pairing-link');
    await expect(manualLinkButton).toHaveCount(1, { timeout: 120_000 });
    await manualLinkButton.click();
    await expect(joiningPage.getByTestId('web-prompt-input')).toHaveCount(1, { timeout: 30_000 });
    await joiningPage.getByTestId('web-prompt-input').fill(pairingLinkRaw);
    await Promise.all([
      observeForbiddenDirectQrUi(joiningPage),
      observeForbiddenDirectQrUi(trustedHomeBPage),
    ]);
    await joiningPage.getByTestId('web-prompt-confirm').click();

    await expect(joiningPage.getByTestId('restore-scan-confirm-code')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-request-confirm-code')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-approve')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-reject')).toHaveCount(0);
    await expect.poll(
      async () => await readCredentialsForStableIdentity(joiningPage, params.homeB.serverIdentityId).then(() => true).catch(() => false),
      { timeout: 120_000 },
    ).toBe(true);
    expect(await readObservedForbiddenDirectQrUi(joiningPage)).toEqual([]);
    expect(await readObservedForbiddenDirectQrUi(trustedHomeBPage)).toEqual([]);

    const homeBCredentials = await readCredentialsForStableIdentity(joiningPage, params.homeB.serverIdentityId);
    const token = homeBCredentials.value.token;
    expect(typeof token).toBe('string');
    if (params.homeB.credentialKind === 'tokenOnly') {
      expect(Object.keys(homeBCredentials.value).sort()).toEqual(['token']);
    } else {
      expect(Object.keys(homeBCredentials.value).sort()).toEqual(['encryption', 'token']);
      expect(homeBCredentials.value).not.toHaveProperty('secret');
      const encryption = homeBCredentials.value.encryption as Record<string, unknown>;
      expect(Object.keys(encryption).sort()).toEqual(['machineKey', 'publicKey']);
      expect(Buffer.from(String(encryption.machineKey), 'base64')).toEqual(Buffer.from(params.homeB.auth.accountMachineKey));
      expect(Buffer.from(String(encryption.publicKey), 'base64')).toHaveLength(32);
    }

    const profileAtHomeB = await fetch(`${params.homeB.server.baseUrl}/v1/account/profile`, {
      headers: { Authorization: `Bearer ${String(token)}` },
      signal: AbortSignal.timeout(15_000),
    });
    expect(profileAtHomeB.status).toBe(200);
    const sameTokenAtHomeA = await fetch(`${params.homeA.server.baseUrl}/v1/account/profile`, {
      headers: { Authorization: `Bearer ${String(token)}` },
      signal: AbortSignal.timeout(15_000),
    });
    expect([401, 403]).toContain(sameTokenAtHomeA.status);

    const homeAAfter = await readHomeState(joiningPage);
    expect(Object.values(homeAAfter.profiles)).toContainEqual(expect.objectContaining({
      serverIdentityId: params.homeB.serverIdentityId,
      source: 'qr',
    }));
    expect(homeAAfter.activeServerId).toBe(homeABefore.activeServerId);
    expect(homeAAfter.homeViewState).toEqual(homeABefore.homeViewState);
    expect(homeAAfter.activeProfile).toEqual(homeABefore.activeProfile);
    for (const [key, value] of Object.entries(homeABefore.credentialsByKey)) {
      expect(homeAAfter.credentialsByKey[key]).toBe(value);
    }

    await expect.poll(() => enrollmentRequests.map((url) => url.pathname), { timeout: 30_000 })
      .toEqual(expect.arrayContaining([...REQUIRED_ENROLLMENT_PATHS]));
    expect(enrollmentRequests.map((url) => url.pathname)).not.toContain('/v1/auth/pairing/consume');
    for (const requestUrl of enrollmentRequests) expect(requestUrl.origin).toBe(params.homeB.server.baseUrl);
  } finally {
    await homeBContext?.close().catch(() => {});
    await homeAContext?.close().catch(() => {});
  }
}

test.describe('ui e2e: direct Home QR enrollment through production callers', () => {
  test.describe.configure({ mode: 'serial' });
  const suiteDir = run.testDir('auth-pairing-add-phone-suite');

  let homeAServer: StartedServer | null = null;
  let plainHomeBServer: StartedServer | null = null;
  let e2eeHomeBServer: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let homeA: HomeFixture | null = null;
  let plainHomeB: HomeFixture | null = null;
  let e2eeHomeB: HomeFixture | null = null;

  test.beforeAll(async () => {
    const uiEnv = { ...process.env, CI: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: storageScope };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiEnv) + 240_000);
    await mkdir(suiteDir, { recursive: true });

    homeAServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'home-a')),
      dbProvider: 'sqlite',
      extraEnv: { HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1' },
    });
    plainHomeBServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'home-b-plain')),
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
      },
    });
    e2eeHomeBServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'home-b-e2ee')),
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'required',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'e2ee',
      },
    });

    const [homeAAuth, plainAuth, e2eeAuth, homeAIdentity, plainIdentity, e2eeIdentity] = await Promise.all([
      createTestAuth(homeAServer.baseUrl),
      createTestAuth(plainHomeBServer.baseUrl),
      createTestAuth(e2eeHomeBServer.baseUrl),
      resolveCanonicalServerIdForUi(homeAServer.baseUrl),
      resolveCanonicalServerIdForUi(plainHomeBServer.baseUrl),
      resolveCanonicalServerIdForUi(e2eeHomeBServer.baseUrl),
    ]);
    homeA = { server: homeAServer, auth: homeAAuth, serverIdentityId: homeAIdentity, credentialKind: 'dataKey' };
    plainHomeB = { server: plainHomeBServer, auth: plainAuth, serverIdentityId: plainIdentity, credentialKind: 'tokenOnly' };
    e2eeHomeB = { server: e2eeHomeBServer, auth: e2eeAuth, serverIdentityId: e2eeIdentity, credentialKind: 'dataKey' };

    ui = await startUiWeb({
      testDir: suiteDir,
      env: { ...uiEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: homeAServer.baseUrl },
      // The package prebuild has its own repository gate. This opt-in is only
      // for focused UI evidence when an unrelated workspace package is red.
      skipWorkspacePrebuild: process.env.HAPPIER_E2E_SKIP_UI_WORKSPACE_PREBUILD === '1',
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    await ui?.stop().catch(() => {});
    await e2eeHomeBServer?.stop().catch(() => {});
    await plainHomeBServer?.stop().catch(() => {});
    await homeAServer?.stop().catch(() => {});
  });

  test('enrolls plain Home B as tokenOnly while Home A remains focused and grouped', async ({ browser }) => {
    test.setTimeout(540_000);
    if (!uiBaseUrl || !homeA || !plainHomeB) throw new Error('missing composed Home fixtures');
    await runEnrollmentScenario({ browser, uiBaseUrl, homeA, homeB: plainHomeB });
  });

  test('enrolls E2EE Home B as dataKey without legacy collapse while Home A remains focused', async ({ browser }) => {
    test.setTimeout(540_000);
    if (!uiBaseUrl || !homeA || !e2eeHomeB) throw new Error('missing composed Home fixtures');
    await runEnrollmentScenario({ browser, uiBaseUrl, homeA, homeB: e2eeHomeB });
  });
});
