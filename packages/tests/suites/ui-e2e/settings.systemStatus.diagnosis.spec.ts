import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { approveTerminalConnect } from '../../src/testkit/uiE2e/approveTerminalConnect';
import { acknowledgeTerminalConnectSuccessIfPresent } from '../../src/testkit/uiE2e/acknowledgeTerminalConnectSuccessIfPresent';
import { startCliAuthLoginForTerminalConnect, type StartedCliTerminalConnect } from '../../src/testkit/uiE2e/cliTerminalConnect';
import {
  createAccountAndReachConnectMachineState,
  gotoDomContentLoadedWithRetries,
  normalizeLoopbackBaseUrl,
  waitForAuthenticatedHomeUi,
} from '../../src/testkit/uiE2e/pageNavigation';

const run = createRunDirs({ runLabel: 'ui-e2e' });

function resolveServerLightSqliteDbPath(params: { suiteDir: string }): string {
  return resolve(join(params.suiteDir, 'server-light-data', 'happier-server-light.sqlite'));
}

function readLatestMachineIdFromServerLightDb(params: { suiteDir: string }): string {
  const dbPath = resolveServerLightSqliteDbPath({ suiteDir: params.suiteDir });
  const raw = execFileSync('sqlite3', ['-json', dbPath, 'select id from Machine order by createdAt desc limit 1;'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(raw) as Array<{ id?: unknown }>;
  const id = parsed?.[0]?.id;
  if (typeof id === 'string' && id.trim().length > 0) {
    return id.trim();
  }
  throw new Error(`Failed to read machine id from server light sqlite db: ${dbPath}`);
}

async function waitForLatestMachineId(params: { suiteDir: string; timeoutMs?: number }): Promise<string> {
  const timeoutMs = params.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return readLatestMachineIdFromServerLightDb({ suiteDir: params.suiteDir });
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  return readLatestMachineIdFromServerLightDb({ suiteDir: params.suiteDir });
}

function readMachineActiveFromServerLightDb(params: { suiteDir: string; machineId: string }): boolean | null {
  const dbPath = resolveServerLightSqliteDbPath({ suiteDir: params.suiteDir });
  try {
    const query = `select active from Machine where id = '${params.machineId.replaceAll("'", "''")}' limit 1;`;
    const raw = execFileSync('sqlite3', ['-json', dbPath, query], { encoding: 'utf8' });
    const parsed = JSON.parse(raw) as Array<{ active?: unknown }>;
    const active = parsed?.[0]?.active;
    if (active === 1 || active === true) return true;
    if (active === 0 || active === false) return false;
    return null;
  } catch {
    return null;
  }
}

test.describe('ui e2e: System Status + Diagnosis screens', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('system-status-diagnosis-suite');

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;

  test.beforeAll(async () => {
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
    await mkdir(suiteDir, { recursive: true });

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
      },
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
      },
    });

    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('navigates to System Status and runs Diagnosis without a daemon', async ({ page }) => {
    test.setTimeout(240_000);
    if (!uiBaseUrl) throw new Error('missing ui base url');

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDomContentLoadedWithRetries(page, uiBaseUrl);

    await createAccountAndReachConnectMachineState({ page });

    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/system-status`);
    await expect(page.getByTestId('system-status-screen')).toHaveCount(1, { timeout: 60_000 });
    await page.getByTestId('system-status-run-diagnosis').click();

    await expect(page.getByTestId('diagnosis-screen')).toHaveCount(1, { timeout: 60_000 });
    await page.getByTestId('diagnosis-run-button').click();

    await expect(page.getByTestId('diagnosis-finding-machine_none_online')).toHaveCount(1, { timeout: 60_000 });
  });

  test('shows runtime inventory in System Status and Machine Details for a connected daemon machine', async ({ page }) => {
    test.setTimeout(420_000);
    if (!uiBaseUrl) throw new Error('missing ui base url');
    if (!server) throw new Error('missing server fixture');

    const testDir = resolve(join(suiteDir, 't2-runtime-inventory'));
    await mkdir(testDir, { recursive: true });
    const cliHomeDir = resolve(join(testDir, 'cli-home'));

    let cliLogin: StartedCliTerminalConnect | null = null;
    let daemon: StartedDaemon | null = null;

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
      await createAccountAndReachConnectMachineState({ page });

      cliLogin = await startCliAuthLoginForTerminalConnect({
        testDir,
        cliHomeDir,
        serverUrl: server.baseUrl,
        webappUrl: uiBaseUrl,
        env: {
          ...process.env,
          CI: '1',
          HAPPIER_DISABLE_CAFFEINATE: '1',
          HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
          HAPPIER_VARIANT: 'dev',
        },
      });

      await page.goto(cliLogin.connectUrl, { waitUntil: 'domcontentloaded' });
      await approveTerminalConnect({ page });
      await cliLogin.waitForSuccess();
      await acknowledgeTerminalConnectSuccessIfPresent(page);

      daemon = await startTestDaemon({
        testDir,
        happyHomeDir: cliHomeDir,
        env: {
          ...process.env,
          CI: '1',
          HAPPIER_HOME_DIR: cliHomeDir,
          HAPPIER_SERVER_URL: server.baseUrl,
          HAPPIER_WEBAPP_URL: uiBaseUrl,
          HAPPIER_DISABLE_CAFFEINATE: '1',
          HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
          HAPPIER_VARIANT: 'dev',
          HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
          HAPPIER_E2E_FAKE_CLAUDE_LOG: resolve(join(testDir, 'fake-claude.jsonl')),
          HAPPIER_E2E_FAKE_CLAUDE_SESSION_ID: `system-status-diagnosis-fake-claude-session-${run.runId}`,
          HAPPIER_E2E_FAKE_CLAUDE_INVOCATION_ID: `system-status-diagnosis-fake-claude-invocation-${run.runId}`,
        },
      });

      const machineId = await waitForLatestMachineId({ suiteDir, timeoutMs: 120_000 });
      await expect.poll(
        async () => readMachineActiveFromServerLightDb({ suiteDir, machineId }),
        { timeout: 180_000 },
      ).toBe(true);

      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/`);
      await waitForAuthenticatedHomeUi({ page, timeoutMs: 180_000 });

      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/system-status`);
      await expect(page.getByTestId('system-status-screen')).toHaveCount(1, { timeout: 60_000 });
      await expect(page.getByTestId('machine-runtime-inventory-summary')).toHaveCount(1, { timeout: 120_000 });
      await expect(page.getByTestId('machine-runtime-inventory-repair-summary')).toHaveCount(1, { timeout: 120_000 });

      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/machine/${encodeURIComponent(machineId)}`);
      await expect(page.getByTestId('machine-runtime-inventory-summary')).toHaveCount(1, { timeout: 120_000 });
      await expect(page.getByTestId('machine-runtime-inventory-repair-summary')).toHaveCount(1, { timeout: 120_000 });
      await expect(page.getByTestId('machine-runtime-inventory-cli')).toHaveCount(1, { timeout: 120_000 });
      await expect(page.getByTestId('machine-runtime-inventory-daemon')).toHaveCount(1, { timeout: 120_000 });
    } finally {
      await daemon?.stop().catch(() => {});
      await cliLogin?.stop().catch(() => {});
    }
  });

  test('keeps Connection details usable with keyboard, constrained layouts, color schemes, and reduced motion', async ({ page }) => {
    test.setTimeout(240_000);
    if (!uiBaseUrl) throw new Error('missing ui base url');

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
    await createAccountAndReachConnectMachineState({ page });
    await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/`);
    await waitForAuthenticatedHomeUi({ page, timeoutMs: 180_000 });

    const trigger = page.getByRole('button', {
      name: /, (Connected|Reconnecting|Unavailable|Sign in again)$/,
      expanded: false,
    }).first();
    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');

    const popover = page.getByTestId('connection-popover-content');
    await expect(page.getByText('Connection', { exact: true })).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => popover.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    const disclosure = page.getByRole('button', { name: 'Details', expanded: false });
    await disclosure.focus();
    await page.keyboard.press('Space');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    await expect(page.getByText('Connection Details', { exact: true })).toBeVisible();
    await expect(page.getByText('Canonical address', { exact: true })).toBeVisible();
    await expect(page.getByText('Home identity', { exact: true })).toBeVisible();
    const copyDiagnostics = page.getByRole('button', { name: /^(Copy diagnostics|Diagnostics copied)$/ });
    await expect(copyDiagnostics).toBeVisible();

    // A 320 CSS-pixel viewport exercises the same responsive reflow width as a
    // 640 device-pixel window at 200% browser zoom. Long identity/URL values
    // must stay inside the existing popover while its scroll owner keeps the
    // final action reachable.
    await page.setViewportSize({ width: 320, height: 480 });
    await expect.poll(async () => {
      const box = await popover.boundingBox();
      return box ? { left: Math.round(box.x), right: Math.round(box.x + box.width) } : null;
    }).toEqual(expect.objectContaining({ left: expect.any(Number), right: expect.any(Number) }));
    const horizontalBounds = await popover.boundingBox();
    expect(horizontalBounds).not.toBeNull();
    expect(horizontalBounds!.x).toBeGreaterThanOrEqual(0);
    expect(horizontalBounds!.x + horizontalBounds!.width).toBeLessThanOrEqual(320);

    await copyDiagnostics.scrollIntoViewIfNeeded();
    await expect(copyDiagnostics).toBeVisible();
    const copyBounds = await copyDiagnostics.boundingBox();
    expect(copyBounds).not.toBeNull();
    expect(copyBounds!.y).toBeGreaterThanOrEqual(0);
    expect(copyBounds!.y + copyBounds!.height).toBeLessThanOrEqual(480);

    const diagnosticsText = await popover.innerText();
    expect(diagnosticsText).not.toMatch(/authorization:\s*bearer|password\s*[:=]|[?&](?:token|key|secret)=/i);

    await copyDiagnostics.click();
    await expect(page.getByRole('button', { name: 'Diagnostics copied' })).toBeVisible();

    await test.info().attach('connection-details-dark-reduced-narrow', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await page.setViewportSize({ width: 640, height: 320 });
    await expect(popover).toBeVisible();
    await copyDiagnostics.scrollIntoViewIfNeeded();
    await expect(copyDiagnostics).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await disclosure.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('Connection Details', { exact: true })).toBeVisible();
    await test.info().attach('connection-details-light', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
});
