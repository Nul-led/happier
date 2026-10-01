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
import { canonicalizeServerUrlForUiWeb, scopedUiStorageId } from '../../src/testkit/uiE2e/uiWebStorageContract';
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
type ServerProfileDiagnostic = Readonly<{
  id: string | null;
  serverIdentityId: string | null;
  source: string | null;
}>;

/**
 * Diagnostics from this journey may never carry pairing material. Redact the QR invite payload,
 * any legacy secret parameter, and whole `happier*://pair` deep links before an entry is retained.
 */
function redactPairingSecrets(entry: string): string {
  return entry
    .replace(/happier[a-z0-9+.-]*:\/\/pair\S*/gi, '<redacted-pairing-deep-link>')
    .replace(/([?&](?:payload|secret|qrSecretBase64Url)=)[^\s&"']+/gi, '$1<redacted>')
    .replace(/(["'](?:payload|secret|qrSecretBase64Url)["']\s*:\s*["'])[^"']*(["'])/gi, '$1<redacted>$2')
    .replace(/(authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s,"'}]+/gi, '$1<redacted>');
}

function collectBrowserDiagnostics(page: Page): () => string {
  const entries: string[] = [];
  const push = (entry: string) => entries.push(redactPairingSecrets(entry));
  page.on('console', (message) => push(`console.${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) push(`response: ${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return () => entries.slice(-80).join('\n') || 'No browser errors were captured.';
}

const PAIRING_FEATURE_ID = 'auth.pairing.desktopQrMobileScan';
const PAIRING_SURFACE_TIMEOUT_MS = 30_000;

/**
 * Early discriminating check on the composed surface: the QR block and the regenerate control are
 * the first elements that exist only once the pairing decision resolved `enabled` for the
 * authenticated Home. A loading (`unknown`) or unavailable (`disabled`) decision keeps them
 * unmounted, so fail fast with redacted diagnostics rather than waiting out the link-button budget.
 */
async function assertPairingSurfaceRendered(params: Readonly<{
  page: Page;
  browserDiagnostics: () => string;
}>): Promise<void> {
  const pairingSurface = params.page.locator('[data-testid="add-phone-qr"], [data-testid="add-phone-generate"]');
  try {
    await expect(pairingSurface.first()).toHaveCount(1, { timeout: PAIRING_SURFACE_TIMEOUT_MS });
  } catch (error) {
    throw new Error([
      `Home B rendered no add-phone pairing surface within ${PAIRING_SURFACE_TIMEOUT_MS}ms.`,
      `Expected the ${PAIRING_FEATURE_ID} decision to be enabled for the authenticated Home`,
      '(Home B must run with HAPPIER_FEATURE_AUTH_PAIRING__DESKTOP_QR_MOBILE_SCAN_ENABLED=1; the server gate fails closed).',
      'A still-loading or unavailable decision unmounts add-phone-qr, add-phone-generate and add-phone-show-link.',
      `Browser diagnostics (pairing material redacted):\n${params.browserDiagnostics()}`,
    ].join('\n'), { cause: error });
  }
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
const FORBIDDEN_DIRECT_QR_REPORTER = '__happierLane09ReportForbiddenDirectQrUi';

/**
 * Whole-lifecycle observation of the comparison-code / approval controls that the direct-QR
 * contract forbids. The observer is installed as an init script **before any app code runs on
 * the page**, and it reports each sighting to a Node-side sink through an exposed binding, so a
 * control that mounts and unmounts during initial pairing-link processing — before any
 * post-navigation `evaluate` could run, and across every later navigation — is still recorded.
 * Install this immediately after `newPage()` and before the first navigation.
 */
async function installForbiddenDirectQrUiObserver(page: Page): Promise<() => readonly string[]> {
  const seen = new Set<string>();
  await page.exposeFunction(FORBIDDEN_DIRECT_QR_REPORTER, (testId: string) => {
    seen.add(testId);
  });
  await page.addInitScript(({ reporter, testIds }) => {
    const reported = new Set<string>();
    const scan = () => {
      for (const testId of testIds) {
        if (reported.has(testId)) continue;
        if (!document.querySelector(`[data-testid="${testId}"]`)) continue;
        reported.add(testId);
        const report = Reflect.get(window, reporter) as ((id: string) => Promise<void>) | undefined;
        void report?.(testId);
      }
    };
    scan();
    // `document` exists before `documentElement` on a freshly created document, so observe the
    // document node itself to cover the very first render.
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  }, { reporter: FORBIDDEN_DIRECT_QR_REPORTER, testIds: FORBIDDEN_DIRECT_QR_UI_IDS });
  return () => [...seen].sort();
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
}>): Promise<() => string> {
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
  return browserDiagnostics;
}

async function readHomeState(page: Page): Promise<BrowserHomeState> {
  const serverStateStorageKey = `${scopedUiStorageId('server-profiles', storageScope)}:server-state-v1`;
  return await page.evaluate((storageKey) => {
    const credentialsByKey: Record<string, string> = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      if (key === 'auth_credentials' || key.includes('auth_credentials__srv_')) {
        credentialsByKey[key] = raw;
      }
    }
    const rawState = window.localStorage.getItem(storageKey);
    const state = rawState ? JSON.parse(rawState) as Record<string, unknown> : null;
    const sessionActiveServerId = window.sessionStorage.getItem('activeServerId');
    const servers = state?.servers && typeof state.servers === 'object' ? state.servers as Record<string, unknown> : {};
    const activeServerId = sessionActiveServerId?.trim()
      || (typeof state?.activeServerId === 'string' ? state.activeServerId : null);
    return {
      activeServerId,
      homeViewState: state?.homeViewState ?? null,
      activeProfile: activeServerId ? servers[activeServerId] ?? null : null,
      profiles: servers,
      credentialsByKey,
    };
  }, serverStateStorageKey);
}

async function readUnscopedServerProfileDiagnostics(page: Page): Promise<readonly ServerProfileDiagnostic[]> {
  return await page.evaluate(() => {
    const rawState = window.localStorage.getItem('server-profiles:server-state-v1');
    if (!rawState) return [];
    const state = JSON.parse(rawState) as { servers?: unknown };
    if (!state.servers || typeof state.servers !== 'object') return [];
    return Object.values(state.servers as Record<string, unknown>).map((candidate) => {
      const profile = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
      return {
        id: typeof profile.id === 'string' ? profile.id : null,
        serverIdentityId: typeof profile.serverIdentityId === 'string' ? profile.serverIdentityId : null,
        source: typeof profile.source === 'string' ? profile.source : null,
      };
    });
  });
}

function credentialStorageScopeFragment(serverIdentityId: string): string {
  return `auth_credentials__srv_${serverIdentityId.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_')}`;
}

async function readCredentialsForStableIdentity(page: Page, serverIdentityId: string): Promise<StoredCredentials> {
  const scope = credentialStorageScopeFragment(serverIdentityId);
  return await page.evaluate((scopeValue) => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.toLowerCase().includes(scopeValue)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (typeof value.token === 'string' && value.token.length > 0) return { storageKey: key, value };
    }
    throw new Error(`No credentials stored under scope ${scopeValue}`);
  }, scope);
}

function trackEnrollmentRequests(page: Page, sink: URL[]): void {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (TRACKED_ENROLLMENT_PATHS.has(url.pathname)) sink.push(url);
  });
}

async function openManualPairingLinkPrompt(page: Page): Promise<void> {
  const disclosure = page.getByTestId('restore-pairing-link-details');
  await expect(disclosure).toHaveCount(1, { timeout: 120_000 });
  await disclosure.click();
  const manualLinkButton = page.getByTestId('restore-enter-pairing-link');
  await expect(manualLinkButton).toHaveCount(1, { timeout: 30_000 });
  await manualLinkButton.click();
  await expect(page.getByTestId('web-prompt-input')).toHaveCount(1, { timeout: 30_000 });
}

/**
 * Produces Home's single-use V2 invite through the real trusted-device production caller
 * (authenticated Settings → add-phone pairing surface) and binds it to the exact Home
 * identity before any joining device consumes it.
 */
async function produceTrustedHomeQrInviteLink(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
  home: HomeFixture;
}>): Promise<string> {
  const browserDiagnostics = await openAuthenticatedPage({ page: params.page, uiBaseUrl: params.uiBaseUrl, home: params.home });
  await gotoDomContentLoadedWithRetries(params.page, `${params.uiBaseUrl}/settings`, 180_000);
  await expect(params.page.getByTestId('settings-add-your-phone-shortcut')).toHaveCount(1, { timeout: 120_000 });
  await params.page.getByTestId('settings-add-your-phone-shortcut').click();
  await expect(params.page).toHaveURL(/\/settings\/add-phone/, { timeout: 60_000 });
  await expect(params.page.getByTestId('add-phone-pairing-link')).toHaveCount(0);
  await assertPairingSurfaceRendered({ page: params.page, browserDiagnostics });
  const pairingLinkDisclosure = params.page.getByTestId('add-phone-pairing-link-details');
  try {
    await expect(pairingLinkDisclosure).toHaveCount(1, { timeout: 120_000 });
  } catch (error) {
    throw new Error([
      'Home B never produced a ready V2 pairing invite.',
      `Browser diagnostics (pairing material redacted):\n${browserDiagnostics()}`,
    ].join('\n'), { cause: error });
  }
  await pairingLinkDisclosure.click();
  const pairingLink = params.page.getByTestId('add-phone-pairing-link-value');
  await expect(pairingLink).toHaveCount(1, { timeout: 30_000 });
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
  const canonicalServerUrl = canonicalizeServerUrlForUiWeb(params.home.server.baseUrl);
  expect(invite).toMatchObject({
    v: 2,
    intent: 'home_device',
    home: { homeServerIdentityId: params.home.serverIdentityId, canonicalServerUrl },
  });
  expect(invite?.home.endpoints).toContainEqual({ kind: 'https', url: canonicalServerUrl });
  expect(Buffer.from(invite?.qrSecretBase64Url ?? '', 'base64url')).toHaveLength(32);
  return pairingLinkRaw;
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
    // Installed before the first navigation so the forbidden-control observation covers the whole
    // page lifecycle rather than a post-load suffix.
    const readJoiningForbiddenUi = await installForbiddenDirectQrUiObserver(joiningPage);
    const readTrustedForbiddenUi = await installForbiddenDirectQrUiObserver(trustedHomeBPage);
    await openAuthenticatedPage({ page: joiningPage, uiBaseUrl: params.uiBaseUrl, home: params.homeA, withVisibleGroup: true });
    await openAuthenticatedPage({ page: trustedHomeBPage, uiBaseUrl: params.uiBaseUrl, home: params.homeB });

    const homeABefore = await readHomeState(joiningPage);
    expect(homeABefore.activeServerId).not.toBeNull();
    expect(homeABefore.homeViewState).toMatchObject({ version: 1, groups: [{ id: 'home-a-visible' }] });

    const enrollmentRequests: URL[] = [];
    trackEnrollmentRequests(joiningPage, enrollmentRequests);
    trackEnrollmentRequests(trustedHomeBPage, enrollmentRequests);

    const pairingLinkRaw = await produceTrustedHomeQrInviteLink({ page: trustedHomeBPage, uiBaseUrl: params.uiBaseUrl, home: params.homeB });

    // Authenticated Add Home enters through the real production caller: the account
    // settings item pushes ADD_HOME_RESTORE_PATH (/restore?entryIntent=add_home). The
    // explicit add_home intent is load-bearing — a bare /restore parses as the Welcome
    // enter_home intent, whose contract is to open the scanned Home instead.
    await gotoDomContentLoadedWithRetries(joiningPage, `${params.uiBaseUrl}/settings/account`, 180_000);
    const addHomeItem = joiningPage.getByTestId('settings-account-add-home');
    await expect(addHomeItem).toHaveCount(1, { timeout: 120_000 });
    await addHomeItem.click();
    await expect(joiningPage).toHaveURL(/\/restore\?entryIntent=add_home/, { timeout: 60_000 });
    await openManualPairingLinkPrompt(joiningPage);
    await joiningPage.getByTestId('web-prompt-input').fill(pairingLinkRaw);
    await joiningPage.getByTestId('web-prompt-confirm').click();

    await expect(joiningPage.getByTestId('restore-scan-confirm-code')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-request-confirm-code')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-approve')).toHaveCount(0);
    await expect(trustedHomeBPage.getByTestId('add-phone-reject')).toHaveCount(0);
    await expect.poll(
      async () => await readCredentialsForStableIdentity(joiningPage, params.homeB.serverIdentityId).then(() => true).catch(() => false),
      { timeout: 120_000 },
    ).toBe(true);
    expect(readJoiningForbiddenUi()).toEqual([]);
    expect(readTrustedForbiddenUi()).toEqual([]);

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
    try {
      expect(Object.values(homeAAfter.profiles)).toContainEqual(expect.objectContaining({
        serverIdentityId: params.homeB.serverIdentityId,
        source: 'qr',
      }));
    } catch (error) {
      const summarize = (profiles: Readonly<Record<string, unknown>>): readonly ServerProfileDiagnostic[] => Object.values(profiles).map((candidate) => {
        const profile = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
        return {
          id: typeof profile.id === 'string' ? profile.id : null,
          serverIdentityId: typeof profile.serverIdentityId === 'string' ? profile.serverIdentityId : null,
          source: typeof profile.source === 'string' ? profile.source : null,
        };
      });
      throw new Error([
        'Home B was not observed in the canonical scoped server-profile state.',
        `Scoped profiles: ${JSON.stringify(summarize(homeAAfter.profiles))}`,
        `Unscoped profiles: ${JSON.stringify(await readUnscopedServerProfileDiagnostics(joiningPage))}`,
      ].join('\n'), { cause: error });
    }
    expect(homeAAfter.activeServerId).toBe(homeABefore.activeServerId);
    expect(homeAAfter.homeViewState).toEqual(homeABefore.homeViewState);
    expect(homeAAfter.activeProfile).toEqual(homeABefore.activeProfile);
    for (const [key, value] of Object.entries(homeABefore.credentialsByKey)) {
      expect(homeAAfter.credentialsByKey[key]).toBe(value);
    }

    await expect.poll(() => enrollmentRequests.map((url) => url.pathname), { timeout: 30_000 })
      .toEqual(expect.arrayContaining([...REQUIRED_ENROLLMENT_PATHS]));
    expect(enrollmentRequests.map((url) => url.pathname)).not.toContain('/v1/auth/pairing/consume');
    const canonicalHomeBUrl = canonicalizeServerUrlForUiWeb(params.homeB.server.baseUrl);
    for (const requestUrl of enrollmentRequests) expect(requestUrl.origin).toBe(canonicalHomeBUrl);
  } finally {
    await homeBContext?.close().catch(() => {});
    await homeAContext?.close().catch(() => {});
  }
}

/**
 * Welcome entry (J09-05/F-QR-01 enter_home direction): a fresh unauthenticated client with no
 * stored Home credential consumes a scanned Home B V2 invite. The headless browser uses the
 * restore scanner's real manual-entry fallback, which shares the production scan callback and
 * creates the same one-shot secret-free route handoff as a camera scan. Physical camera capture
 * and OS dispatch remain a separate live gate. The journey must end with the persisted focused
 * Home identity on B, not merely shell navigation.
 */
async function runWelcomeEntryScenario(params: Readonly<{
  browser: Browser;
  uiBaseUrl: string;
  /**
   * A Home this fresh client never adopted. It is the UI build's configured default endpoint,
   * which makes it the exact wrong-destination candidate, and it is the foreign authority that
   * must reject the Home B credential. Nothing here asserts that it was ever selected.
   */
  foreignHome: HomeFixture;
  homeB: HomeFixture;
}>): Promise<void> {
  let joiningContext: BrowserContext | null = null;
  let trustedContext: BrowserContext | null = null;
  try {
    joiningContext = await params.browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      hasTouch: true,
    });
    trustedContext = await params.browser.newContext({ viewport: { width: 1280, height: 844 } });
    await joiningContext.grantPermissions(['camera'], { origin: params.uiBaseUrl }).catch(() => {});

    const joiningPage = await joiningContext.newPage();
    const trustedHomeBPage = await trustedContext.newPage();
    const joiningDiagnostics = collectBrowserDiagnostics(joiningPage);
    // Installed before the scanner navigation: initial pairing-link processing can mount and
    // unmount a control before any post-load `evaluate` would exist, so the observer must run
    // ahead of app code on this page.
    const readJoiningForbiddenUi = await installForbiddenDirectQrUiObserver(joiningPage);

    const enrollmentRequests: URL[] = [];
    trackEnrollmentRequests(joiningPage, enrollmentRequests);
    trackEnrollmentRequests(trustedHomeBPage, enrollmentRequests);

    const pairingLinkRaw = await produceTrustedHomeQrInviteLink({ page: trustedHomeBPage, uiBaseUrl: params.uiBaseUrl, home: params.homeB });

    await gotoDomContentLoadedWithRetries(
      joiningPage,
      `${params.uiBaseUrl}/restore?entryIntent=enter_home`,
      180_000,
    );
    const pairingLinkDisclosure = joiningPage.getByTestId('restore-pairing-link-details');
    await expect(pairingLinkDisclosure).toHaveCount(1, { timeout: 120_000 });
    await pairingLinkDisclosure.click();
    await joiningPage.getByTestId('restore-enter-pairing-link').click();
    await expect(joiningPage.getByTestId('pairing-link-entry-form')).toHaveCount(1, { timeout: 30_000 });
    await joiningPage.getByTestId('restore-pairing-link-input').fill(pairingLinkRaw);
    await joiningPage.getByTestId('restore-pairing-link-submit').click();

    await expect(joiningPage).toHaveURL(/\/restore\?pairingHandoff=[A-Za-z0-9_-]+&entryIntent=enter_home/u, {
      timeout: 30_000,
    });
    const handoffRoute = new URL(joiningPage.url());
    expect(handoffRoute.searchParams.has('pairingHandoff')).toBe(true);
    expect(handoffRoute.searchParams.has('pairingLink')).toBe(false);
    expect(handoffRoute.searchParams.has('qrSecretBase64Url')).toBe(false);
    expect(joiningPage.url()).not.toContain(pairingLinkRaw);
    const pairingPayload = new URL(pairingLinkRaw).searchParams.get('payload') ?? '';
    const pairingInvite = parseHomeQrInviteV2Payload(pairingPayload, { nowMs: Date.now() });
    expect(pairingInvite).not.toBeNull();
    expect(joiningPage.url()).not.toContain(pairingInvite?.qrSecretBase64Url ?? 'missing-qr-secret');

    try {
      await expect.poll(
        async () => await readCredentialsForStableIdentity(joiningPage, params.homeB.serverIdentityId).then(() => true).catch(() => false),
        { timeout: 180_000 },
      ).toBe(true);
      expect(readJoiningForbiddenUi()).toEqual([]);

      // The B credential is stored under the exact scanned Home identity.
      const homeBCredentials = await readCredentialsForStableIdentity(joiningPage, params.homeB.serverIdentityId);
      expect(Object.keys(homeBCredentials.value).sort()).toEqual(['token']);

      // Same authority proof as the Add Home direction: the issued credential authenticates at
      // the scanned Home and is rejected by the foreign Home it was never issued for.
      const token = homeBCredentials.value.token;
      expect(typeof token).toBe('string');
      const profileAtHomeB = await fetch(`${params.homeB.server.baseUrl}/v1/account/profile`, {
        headers: { Authorization: `Bearer ${String(token)}` },
        signal: AbortSignal.timeout(15_000),
      });
      expect(profileAtHomeB.status).toBe(200);
      const sameTokenAtForeignHome = await fetch(`${params.foreignHome.server.baseUrl}/v1/account/profile`, {
        headers: { Authorization: `Bearer ${String(token)}` },
        signal: AbortSignal.timeout(15_000),
      });
      expect([401, 403]).toContain(sameTokenAtForeignHome.status);

      // Canonical browser selection truth, not router navigation: the tab-local
      // selection must resolve the persisted scanned Home B as the active profile.
      await expect.poll(
        async () => {
          const state = await readHomeState(joiningPage);
          const activeProfile = state.activeProfile as { serverIdentityId?: unknown } | null;
          return activeProfile?.serverIdentityId ?? null;
        },
        { timeout: 120_000 },
      ).toBe(params.homeB.serverIdentityId);
      const homeState = await readHomeState(joiningPage);
      const adoptedEntries = Object.entries(homeState.profiles).filter(([, profile]) => {
        const candidate = profile as { serverIdentityId?: unknown } | null;
        return candidate?.serverIdentityId === params.homeB.serverIdentityId;
      });
      expect(adoptedEntries).toHaveLength(1);
      const [bLocalId, adoptedProfile] = adoptedEntries[0] as [string, unknown];
      expect(adoptedProfile).toMatchObject({ serverIdentityId: params.homeB.serverIdentityId, source: 'qr' });
      expect(homeState.activeServerId).toBe(bLocalId);
      expect(homeState.activeProfile).toMatchObject({ serverIdentityId: params.homeB.serverIdentityId });

      // The authenticated shell opened focused on Home B. The joining page is
      // phone-sized, so accept the responsive header action as well as the
      // desktop sidebar action.
      await expect.poll(async () => {
        for (const testId of [
          'tabbar-start-new-session',
          'home-header-start-new-session',
          'sidebar-start-new-session',
        ] as const) {
          if (await joiningPage.getByTestId(testId).first().isVisible().catch(() => false)) return true;
        }
        return false;
      }, { timeout: 120_000 }).toBe(true);

      // Destination binding: every enrollment request — including the trusted completer's —
      // targeted Home B. The build's configured default endpoint received no enrollment
      // request and holds no credential on this fresh, never-adopted client.
      await expect.poll(() => enrollmentRequests.map((url) => url.pathname), { timeout: 30_000 })
        .toEqual(expect.arrayContaining([...REQUIRED_ENROLLMENT_PATHS]));
      expect(enrollmentRequests.map((url) => url.pathname)).not.toContain('/v1/auth/pairing/consume');
      const canonicalHomeBUrl = canonicalizeServerUrlForUiWeb(params.homeB.server.baseUrl);
      for (const requestUrl of enrollmentRequests) {
        expect(requestUrl.origin).toBe(canonicalHomeBUrl);
      }
      const foreignScopeFragment = credentialStorageScopeFragment(params.foreignHome.serverIdentityId);
      for (const key of Object.keys(homeState.credentialsByKey)) {
        expect(key.toLowerCase().includes(foreignScopeFragment)).toBe(false);
      }
    } catch (error) {
      const failureState = await readHomeState(joiningPage).catch(() => null);
      throw new Error([
        'Welcome enter_home journey did not reach the scanned Home B as the focused Home.',
        `Persisted state at failure: ${
          failureState
            ? JSON.stringify({
              activeServerId: failureState.activeServerId,
              profileIds: Object.keys(failureState.profiles),
              credentialStorageKeys: Object.keys(failureState.credentialsByKey),
            })
            : 'unavailable'
        }`,
        `Browser diagnostics (pairing material redacted):\n${joiningDiagnostics()}`,
      ].join('\n'), { cause: error });
    }
  } finally {
    await trustedContext?.close().catch(() => {});
    await joiningContext?.close().catch(() => {});
  }
}

/**
 * Released QR V1 compatibility is a refusal contract, not an enrollment fallback. Exercise the
 * immutable released producer output through authenticated Add Home's real manual-entry surface
 * and prove the composed browser neither contacts a pairing endpoint nor changes Home state.
 */
async function runReleasedV1UpdateRequiredScenario(params: Readonly<{
  browser: Browser;
  uiBaseUrl: string;
  homeA: HomeFixture;
}>): Promise<void> {
  const releasedV1Link =
    'happier-dev:///pair?v=1&pairId=pid123&secret=sec_abc&server=https%3A%2F%2Fstack.example.test%2Fpath%3Fx%3D1';
  const context = await params.browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const readForbiddenUi = await installForbiddenDirectQrUiObserver(page);
    await openAuthenticatedPage({ page, uiBaseUrl: params.uiBaseUrl, home: params.homeA, withVisibleGroup: true });
    const before = await readHomeState(page);
    const enrollmentRequests: URL[] = [];
    trackEnrollmentRequests(page, enrollmentRequests);

    await gotoDomContentLoadedWithRetries(page, `${params.uiBaseUrl}/settings/account`, 180_000);
    await page.getByTestId('settings-account-add-home').click();
    await expect(page).toHaveURL(/\/restore\?entryIntent=add_home/, { timeout: 60_000 });
    await openManualPairingLinkPrompt(page);
    await page.getByTestId('web-prompt-input').fill(releasedV1Link);
    await page.getByTestId('web-prompt-confirm').click();

    // The alert's stable button ids prove the typed update-required route rendered without
    // coupling this journey to translated copy. Cancel is deliberately inert.
    await expect(page.getByTestId('web-modal-button-0')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId('web-modal-button-1')).toHaveCount(1);
    await page.getByTestId('web-modal-button-1').click();
    await expect(page.getByTestId('web-modal-button-0')).toHaveCount(0);

    const after = await readHomeState(page);
    expect(after).toEqual(before);
    expect(enrollmentRequests).toEqual([]);
    expect(readForbiddenUi()).toEqual([]);
    expect(JSON.stringify(after)).not.toContain('pid123');
    expect(JSON.stringify(after)).not.toContain('sec_abc');
    expect(JSON.stringify(after)).not.toContain('stack.example.test');
  } finally {
    await context.close().catch(() => {});
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

  test.beforeAll(async ({ browser }) => {
    // Resolve the Playwright worker browser before starting three Homes or Metro,
    // so an incapable host fails without spending the full fixture-startup budget.
    void browser;
    const uiEnv = {
      ...process.env,
      CI: '1',
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: storageScope,
      HAPPIER_E2E_UI_WEB_MODE: process.env.HAPPIER_E2E_UI_WEB_MODE ?? 'metro',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiEnv) + 240_000);
    await mkdir(suiteDir, { recursive: true });

    homeAServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'home-a')),
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_PAIRING__DESKTOP_QR_MOBILE_SCAN_ENABLED: '1',
      },
    });
    plainHomeBServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'home-b-plain')),
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_PAIRING__DESKTOP_QR_MOBILE_SCAN_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
      },
    });
    e2eeHomeBServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'home-b-e2ee')),
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_PAIRING__DESKTOP_QR_MOBILE_SCAN_ENABLED: '1',
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

  test('opens a fresh unauthenticated scanned Home B focused (Welcome enter_home)', async ({ browser }) => {
    test.setTimeout(540_000);
    if (!uiBaseUrl || !homeA || !plainHomeB) throw new Error('missing composed Home fixtures');
    await runWelcomeEntryScenario({ browser, uiBaseUrl, foreignHome: homeA, homeB: plainHomeB });
  });

  test('refuses released QR V1 with update-required and zero enrollment side effects', async ({ browser }) => {
    test.setTimeout(540_000);
    if (!uiBaseUrl || !homeA) throw new Error('missing composed Home fixtures');
    await runReleasedV1UpdateRequiredScenario({ browser, uiBaseUrl, homeA });
  });
});
