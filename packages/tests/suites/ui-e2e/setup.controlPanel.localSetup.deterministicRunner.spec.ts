import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { installFakeTauriDesktopBridge, navigateSpa } from '../../src/testkit/uiE2e/fakeTauriDesktop';
import {
    createAccountAndReachMachineAddDraftState,
    gotoCommittedWithRetries,
    normalizeLoopbackBaseUrl,
} from '../../src/testkit/uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';

const run = createRunDirs({ runLabel: 'ui-e2e' });

test.describe('ui e2e: setup control panel flow (deterministic runner)', () => {
    test.describe.configure({ mode: 'serial' });

    const suiteDir = run.testDir('setup-control-panel-deterministic-runner-suite');

    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let uiBaseUrl: string | null = null;

    const uiWebEnv = {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: '',
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
        EXPO_PUBLIC_SYSTEM_TASKS_RUNNER_MODE: 'dev',
        HAPPIER_E2E_UI_WEB_MODE: 'metro',
    };

    test.beforeAll(async () => {
        test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
        await mkdir(suiteDir, { recursive: true });

        server = await startServerLight({
            testDir: suiteDir,
            dbProvider: 'sqlite',
            extraEnv: {
                // UI web E2E create-account can be blocked by content-keys binding; keep this suite focused on setup surfaces.
                HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
            },
        });

        ui = await startUiWeb({
            testDir: suiteDir,
            env: {
                ...uiWebEnv,
                EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
            },
        });

        uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    });

    test.afterAll(async () => {
        test.setTimeout(120_000);
        await ui?.stop().catch(() => {});
        await server?.stop().catch(() => {});
    });

    test('runs local machine setup from the collection draft and shows its task progress', async ({ page }) => {
        test.setTimeout(420_000);
        if (!uiBaseUrl) throw new Error('missing ui base url');

        await page.setViewportSize({ width: 1440, height: 900 });

        await gotoCommittedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
        await waitForInitialAppUi({ page, timeoutMs: 180_000 });
        // Avoid making the app "desktop" at initial load, which can activate desktop-only runtimes.
        // Instead, load the web app normally first, then switch setup routes into desktop mode
        // by toggling isDesktopHost() for subsequent renders without a full-page reload.
        await installFakeTauriDesktopBridge(page);
        await createAccountAndReachMachineAddDraftState({ page });

        const start = page.getByTestId('settings.machines.draft.form.pane.start');
        await expect(start).toBeEnabled({ timeout: 120_000 });
        await start.click();
        for (const stage of ['confirmRelay', 'resolveBackgroundService', 'registerComputer', 'enableBackgroundService', 'verifyReady']) {
            await expect(page.getByTestId(`settings.machines.draft.form.pane.steps-row-setup.thisComputer.stage.${stage}`))
                .toHaveCount(1, { timeout: 120_000 });
        }
    });

    test('shows the host relay checklist with satisfied rows in desktop mode', async ({ page }) => {
        test.setTimeout(420_000);
        if (!uiBaseUrl) throw new Error('missing ui base url');

        await page.setViewportSize({ width: 1440, height: 900 });

        await page.addInitScript(() => {
            (window as typeof window & {
                __HAPPIER_DEV_SYSTEM_TASK_SCENARIOS__?: Record<string, unknown>;
            }).__HAPPIER_DEV_SYSTEM_TASK_SCENARIOS__ = {
                'relay.runtime.status.v1': 'ready',
            };
        });

        await gotoCommittedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 180_000);
        await waitForInitialAppUi({ page, timeoutMs: 180_000 });
        await installFakeTauriDesktopBridge(page);
        await createAccountAndReachMachineAddDraftState({ page });
        await navigateSpa(page, '/settings/server/add?path=server_home');

        await expect(page.getByTestId('settings.homes.draft.form.serverHome.thisComputer')).toBeVisible({ timeout: 120_000 });
        await expect(page.getByTestId('settings.homes.draft.form.serverHome.thisComputer-checklist-row-installRelayRuntime')).toBeVisible({ timeout: 120_000 });
        await expect(page.getByTestId('settings.homes.draft.form.serverHome.thisComputer-checklist-row-startRelayRuntime')).toBeVisible({ timeout: 120_000 });
        await expect(page.getByTestId('settings.homes.draft.form.serverHome.thisComputer-checklist-row-enableSecureAccess')).toHaveCount(0);
    });
});
