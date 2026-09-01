import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { reserveAvailablePort } from '../../src/testkit/network/reserveAvailablePort';
import {
  createAccountAndReachConnectMachineState,
  gotoDomContentLoadedWithPathFallback,
  gotoDomContentLoadedWithRetries,
  normalizeLoopbackBaseUrl,
} from '../../src/testkit/uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { secretBearingBrowserCapturePolicy } from '../../src/testkit/uiE2e/secretBearingBrowserCapture';
import { createSession, fetchSessionsV2 } from '../../src/testkit/sessions';

test.use(secretBearingBrowserCapturePolicy);

const run = createRunDirs({ runLabel: 'ui-e2e' });
const DIFF_SYNTAX_TOGGLE_ID = 'settings-feature-toggle-files.diffSyntaxHighlighting';

async function createAccountWithoutDaemon(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
}>): Promise<void> {
  await gotoDomContentLoadedWithPathFallback(params.page, `${params.uiBaseUrl}/`, '/', 120_000);
  await waitForInitialAppUi({ page: params.page, timeoutMs: 180_000 });
  await createAccountIfNeeded(params.page);
}

async function createAccountIfNeeded(page: Page): Promise<void> {
  const createAccountByTestId = page.getByTestId('welcome-create-account');
  if (await createAccountByTestId.count()) {
    await createAccountAndReachConnectMachineState({ page });
    return;
  }

  const createAccountByRole = page.getByRole('button', { name: 'Create account' });
  if (await createAccountByRole.count()) {
    await createAccountAndReachConnectMachineState({ page });
  }
}

function deriveServerIdFromUrl(serverUrl: string): string {
  const normalized = serverUrl.trim();
  const parsed = new URL(normalized);
  const port = parsed.port ? `-${parsed.port}` : '';
  const base = `${parsed.hostname.toLowerCase()}${port}`;
  return base.replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_') || 'custom';
}

/**
 * Collects the account access tokens the production UI persisted for its
 * authenticated Homes. Credential records live under `auth_credentials*` keys
 * whose exact spelling varies by server scope and storage-scope suffix, so the
 * scan accepts every key in that namespace and the caller disambiguates tokens
 * by probing each Home through its real HTTP boundary instead of replicating
 * the storage key derivation here.
 */
async function collectAuthTokensFromBrowserStorage(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const tokens = new Set<string>();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith('auth_credentials')) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? '') as { token?: unknown };
        if (typeof parsed.token === 'string' && parsed.token.trim()) tokens.add(parsed.token.trim());
      } catch {
        // Malformed or unrelated credential-shaped entry; keep scanning.
      }
    }
    return [...tokens];
  });
}

async function resolveServerAccountToken(page: Page, server: StartedServer): Promise<string> {
  const candidates = await collectAuthTokensFromBrowserStorage(page);
  for (const token of candidates) {
    try {
      await fetchSessionsV2(server.baseUrl, token, { limit: 1 });
      return token;
    } catch {
      // Token belongs to another Home or is not authenticated there.
    }
  }
  throw new Error(`no browser-stored account token authenticates against ${server.baseUrl}`);
}

async function listServerSessionIds(server: StartedServer, token: string): Promise<string[]> {
  return (await fetchSessionsV2(server.baseUrl, token, { limit: 50 })).sessions.map((session) => session.id);
}

async function expectDiffSyntaxToggleChecked(page: Page, uiBaseUrl: string, checked: boolean): Promise<void> {
  await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/features?happier_hmr=0`, 180_000);
  const toggle = page.getByTestId(DIFF_SYNTAX_TOGGLE_ID);
  await expect(toggle).toHaveCount(1, { timeout: 60_000 });
  if (checked) {
    await expect(toggle).toBeChecked({ timeout: 60_000 });
  } else {
    await expect(toggle).not.toBeChecked({ timeout: 60_000 });
  }
}

test.describe('ui e2e: server/account scoped settings', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('settings-server-account-scope-suite');

  let primaryServer: StartedServer | null = null;
  let secondaryServer: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let secondaryServerPort: number | null = null;

  test.beforeAll(async () => {
    const uiWebEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-settings-scope-${run.runId}`,
    };

    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(suiteDir, { recursive: true });

    primaryServer = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
      },
    });

    secondaryServerPort = await reserveAvailablePort();
    secondaryServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'secondary-server')),
      dbProvider: 'sqlite',
      __portAllocator: async () => secondaryServerPort!,
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
      },
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...uiWebEnv,
        EXPO_PUBLIC_HAPPY_SERVER_URL: primaryServer.baseUrl,
      },
      skipWorkspacePrebuild: process.env.HAPPIER_E2E_SKIP_UI_WORKSPACE_PREBUILD === '1',
    });

    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await ui?.stop().catch(() => {});
    await secondaryServer?.stop().catch(() => {});
    await primaryServer?.stop().catch(() => {});
  });

  test('keeps two persisted Homes isolated through server-attributed sessions, group focus, one-Home offline, and reconnect', async ({ page }) => {
    test.setTimeout(720_000);
    if (!primaryServer || !secondaryServer || !secondaryServerPort || !uiBaseUrl) {
      throw new Error('missing server/ui fixtures');
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await createAccountWithoutDaemon({ page, uiBaseUrl });
    const primaryServerId = deriveServerIdFromUrl(primaryServer.baseUrl);

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/features?happier_hmr=0`, 180_000);
    const primaryToggle = page.getByTestId(DIFF_SYNTAX_TOGGLE_ID);
    await expect(primaryToggle).toHaveCount(1, { timeout: 60_000 });
    await expect(primaryToggle).toBeChecked({ timeout: 60_000 });
    await primaryToggle.click();
    await expect(primaryToggle).not.toBeChecked({ timeout: 60_000 });

    await gotoDomContentLoadedWithPathFallback(page, `${uiBaseUrl}/server`, '/server', 120_000);
    await page.getByTestId('server-settings-add-server-toggle').click();
    await page.getByTestId('server-settings-add-url-input').fill(secondaryServer.baseUrl);
    await page.getByTestId('server-settings-add-name-input').fill('Settings Scope B');
    await page.getByTestId('server-settings-add-confirm').click();
    const continueSwitch = page.getByRole('button', { name: 'Continue' });
    await expect(continueSwitch).toHaveCount(1, { timeout: 60_000 });
    await continueSwitch.click();
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    await createAccountIfNeeded(page);
    const secondaryServerId = deriveServerIdFromUrl(secondaryServer.baseUrl);

    await expectDiffSyntaxToggleChecked(page, uiBaseUrl, true);

    await gotoDomContentLoadedWithPathFallback(page, `${uiBaseUrl}/server`, '/server', 120_000);
    await expect(page.getByTestId(`saved-server-switch-${primaryServerId}`)).toHaveCount(1, { timeout: 60_000 });
    await page.getByTestId(`saved-server-switch-${primaryServerId}`).click();
    await expectDiffSyntaxToggleChecked(page, uiBaseUrl, false);

    await gotoDomContentLoadedWithPathFallback(page, `${uiBaseUrl}/server`, '/server', 120_000);
    await page.getByRole('button', { name: /Add Relay Group/ }).click();
    await page.getByPlaceholder('My Relay Group').fill('Home A + B');
    await page.getByRole('button', { name: /Settings Scope B/ }).click();
    await page.getByRole('button', { name: 'Save group' }).click();
    await expect(page.getByText('Home A + B', { exact: true })).toHaveCount(1, { timeout: 60_000 });

    // Seed one real session per Home through the canonical testkit HTTP boundary
    // (`POST /v1/sessions`), attributed to the account the production UI created
    // on that Home. Tokens come from the browser storage the UI itself wrote and
    // are disambiguated per Home by authenticating against each server.
    const primaryAccountToken = await resolveServerAccountToken(page, primaryServer);
    const secondaryAccountToken = await resolveServerAccountToken(page, secondaryServer);
    const primarySession = await createSession(primaryServer.baseUrl, primaryAccountToken);
    const secondarySession = await createSession(secondaryServer.baseUrl, secondaryAccountToken);

    // Server-side attribution: each Home owns exactly its own seeded session.
    expect(await listServerSessionIds(primaryServer, primaryAccountToken)).toEqual([primarySession.sessionId]);
    expect(await listServerSessionIds(secondaryServer, secondaryAccountToken)).toEqual([secondarySession.sessionId]);

    // UI projection: the focused A runtime projects A's row while the secondary
    // (non-focused) Home runtime projects B's row in the same session list.
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(page.getByTestId(`session-list-item-${primarySession.sessionId}`)).toHaveCount(1, { timeout: 120_000 });
    await expect(page.getByTestId(`session-list-item-${secondarySession.sessionId}`)).toHaveCount(1, { timeout: 120_000 });

    await secondaryServer.stop();
    secondaryServer = null;

    // A stays interactive with B offline: its session row remains visible and
    // its scoped setting remains writable.
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(page.getByTestId(`session-list-item-${primarySession.sessionId}`)).toHaveCount(1, { timeout: 120_000 });

    await expectDiffSyntaxToggleChecked(page, uiBaseUrl, false);
    const primaryToggleWhileSecondaryOffline = page.getByTestId(DIFF_SYNTAX_TOGGLE_ID);
    await primaryToggleWhileSecondaryOffline.click();
    await expect(primaryToggleWhileSecondaryOffline).toBeChecked({ timeout: 60_000 });

    secondaryServer = await startServerLight({
      testDir: resolve(join(suiteDir, 'secondary-server')),
      dbProvider: 'sqlite',
      dataDirMode: 'reuse-existing',
      __portAllocator: async () => secondaryServerPort!,
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
      },
    });

    await gotoDomContentLoadedWithPathFallback(page, `${uiBaseUrl}/server`, '/server', 120_000);
    await expect(page.getByTestId(`saved-server-row-${primaryServerId}`)).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId(`saved-server-row-${secondaryServerId}`)).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByText('Home A + B', { exact: true })).toHaveCount(1, { timeout: 60_000 });

    // Reconnect on the same URL/data re-projects each Home's session exactly
    // once: no duplicate rows in the list and no duplicated session rows on
    // either server.
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
    await expect(page.getByTestId(`session-list-item-${primarySession.sessionId}`)).toHaveCount(1, { timeout: 120_000 });
    await expect(page.getByTestId(`session-list-item-${secondarySession.sessionId}`)).toHaveCount(1, { timeout: 120_000 });
    expect(await listServerSessionIds(primaryServer, primaryAccountToken)).toEqual([primarySession.sessionId]);
    expect(await listServerSessionIds(secondaryServer, secondaryAccountToken)).toEqual([secondarySession.sessionId]);

    await gotoDomContentLoadedWithPathFallback(page, `${uiBaseUrl}/server`, '/server', 120_000);
    await page.getByTestId(`saved-server-switch-${secondaryServerId}`).click();
    await expectDiffSyntaxToggleChecked(page, uiBaseUrl, true);

    await gotoDomContentLoadedWithPathFallback(page, `${uiBaseUrl}/server`, '/server', 120_000);
    await page.getByTestId(`saved-server-switch-${primaryServerId}`).click();
    await expectDiffSyntaxToggleChecked(page, uiBaseUrl, true);
  });
});
