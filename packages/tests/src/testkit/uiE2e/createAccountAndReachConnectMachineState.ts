import { expect, type Page } from '@playwright/test';

export type CreateAccountAndReachConnectMachineStatePage = Pick<Page, 'getByTestId'> & Partial<Pick<Page, 'evaluate' | 'getByRole'>>;
type TestIdLocator = ReturnType<Page['getByTestId']>;

const PRE_AUTH_PROGRESS_CTA_TEST_IDS = [
  'brand-hero-get-started',
] as const;

const CREATE_ACCOUNT_CTA_TEST_IDS = [
  'welcome-primary-start',
  'welcome-create-account',
] as const;

async function isVisible(locator: TestIdLocator): Promise<boolean> {
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function dismissFirstLaunchOnboardingIfVisible(
  page: CreateAccountAndReachConnectMachineStatePage,
): Promise<boolean> {
  const skip = page.getByTestId('onboarding-wizard-skip');
  if (await isVisible(skip)) {
    await skip.click();
    return true;
  }
  // The desktop tour uses an accessible Skip button without the wizard test id.
  // It is a presentation-only first-launch overlay and must not block the
  // account/home state this helper is trying to reach.
  if (page.getByRole) {
    const roleSkip = page.getByRole('button', { name: /^Skip$/ });
    if (await isVisible(roleSkip)) {
      await roleSkip.click();
      return true;
    }
  }
  return false;
}

async function clickCreateAccountButton(createButton: TestIdLocator | null): Promise<void> {
  if (!createButton) {
    throw new Error('Expected a visible create-account button before account creation');
  }
  await createButton.click();
}

async function trySwitchToSessionsTab(params: Readonly<{
  page: CreateAccountAndReachConnectMachineStatePage;
  switchedRef: { current: boolean };
}>): Promise<boolean> {
  if (params.switchedRef.current) {
    return false;
  }

  const sessionsTab = params.page.getByTestId('tabbar-tab-sessions');
  if (!(await isVisible(sessionsTab))) {
    return false;
  }

  try {
    await sessionsTab.click();
    params.switchedRef.current = true;
    return true;
  } catch {
    return false;
  }
}

async function hasPersistedAuthCredentials(page: CreateAccountAndReachConnectMachineStatePage): Promise<boolean> {
    if (!page.evaluate) return true;

    try {
        const result = await page.evaluate(() => {
            if (typeof window === 'undefined' || !window.localStorage) return true;

            const validCredentialKeys: string[] = [];
            let activeServerId: string | null = null;

            for (let index = 0; index < window.localStorage.length; index += 1) {
                const key = window.localStorage.key(index);
                if (!key) continue;
                const raw = window.localStorage.getItem(key);
                if (!raw) continue;

                if (key.includes('server-state-v1')) {
                    try {
                        const parsed = JSON.parse(raw) as {
                            activeServerId?: unknown;
                        };
                        const candidateActiveServerId = typeof parsed?.activeServerId === 'string'
                            ? parsed.activeServerId.trim()
                            : '';
                        if (candidateActiveServerId) {
                            activeServerId = candidateActiveServerId;
                        }
                    } catch {
                        // ignore malformed server state
                    }
                    continue;
                }

                if (key !== 'auth_credentials' && !key.startsWith('auth_credentials__srv_')) continue;

                try {
                    const parsed = JSON.parse(raw) as {
                        token?: unknown;
                        secret?: unknown;
                        encryption?: { publicKey?: unknown; machineKey?: unknown } | null;
                    };
                    const hasToken = typeof parsed?.token === 'string' && parsed.token.trim().length > 0;
                    const hasLegacySecret = typeof parsed?.secret === 'string' && parsed.secret.trim().length > 0;
                    const hasEncryption =
                        typeof parsed?.encryption?.publicKey === 'string'
                        && parsed.encryption.publicKey.trim().length > 0
                        && typeof parsed?.encryption?.machineKey === 'string'
                        && parsed.encryption.machineKey.trim().length > 0;
                    if (hasToken && (hasLegacySecret || hasEncryption)) {
                        validCredentialKeys.push(key);
                    }
                } catch {
                    continue;
                }
            }

            if (validCredentialKeys.length === 0) return false;
            if (!activeServerId) return true;

            const expectedKeyFragment = `auth_credentials__srv_${activeServerId.toLowerCase()}`;
            return validCredentialKeys.some((key) => key.toLowerCase().includes(expectedKeyFragment));
        });

        return typeof result === 'boolean' ? result : true;
    } catch {
        return true;
  }
}

async function isAuthenticatedSessionHomeVisible(page: CreateAccountAndReachConnectMachineStatePage): Promise<boolean> {
  const connectMachine = page.getByTestId('session-getting-started-kind-connect_machine');
  if (await isVisible(connectMachine)) return true;

  const startDaemon = page.getByTestId('session-getting-started-kind-start_daemon');
  if (await isVisible(startDaemon)) return true;

  const createSession = page.getByTestId('session-getting-started-kind-create_session');
  if (await isVisible(createSession)) return true;

  const selectSession = page.getByTestId('session-getting-started-kind-select_session');
  if (await isVisible(selectSession)) return true;

  const openSetup = page.getByTestId('sessions-empty-state-open-setup');
  if (await isVisible(openSetup)) return true;

  const startNewSession = page.getByTestId('tabbar-start-new-session');
  if (await isVisible(startNewSession)) return true;

  return false;
}

async function hasDurableAuthenticatedSessionHomeVisible(
  page: CreateAccountAndReachConnectMachineStatePage,
): Promise<boolean> {
  const createSession = page.getByTestId('session-getting-started-kind-create_session');
  if (await isVisible(createSession)) return true;

  const selectSession = page.getByTestId('session-getting-started-kind-select_session');
  if (await isVisible(selectSession)) return true;

  const startNewSession = page.getByTestId('tabbar-start-new-session');
  if (await isVisible(startNewSession)) return true;

  return false;
}

async function findVisibleCreateAccountButton(params: Readonly<{
  page: CreateAccountAndReachConnectMachineStatePage;
  useFirstCreateButton?: boolean | undefined;
}>): Promise<ReturnType<Page['getByTestId']> | null> {
  for (const testId of CREATE_ACCOUNT_CTA_TEST_IDS) {
    const locator = params.page.getByTestId(testId);
    const candidate = params.useFirstCreateButton === true ? locator.first() : locator;
    if (await isVisible(candidate)) return candidate;
  }
  return null;
}

async function clickPreAuthProgressButtonIfPresent(
  page: CreateAccountAndReachConnectMachineStatePage,
): Promise<boolean> {
  for (const testId of PRE_AUTH_PROGRESS_CTA_TEST_IDS) {
    const locator = page.getByTestId(testId);
    if (!(await isVisible(locator))) continue;
    await locator.click();
    return true;
  }
  return false;
}

async function navigateToMachineAddDraft(page: CreateAccountAndReachConnectMachineStatePage): Promise<void> {
  if (!page.evaluate) {
    throw new Error('createAccountAndReachMachineAddDraftState requires page.evaluate to navigate to /settings/machines/add?path=thisComputer');
  }
  await page.evaluate(() => {
    window.history.pushState({}, '', '/settings/machines/add?path=thisComputer');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

export async function discardMachineAddDraftIfVisible(params: Readonly<{
  page: CreateAccountAndReachConnectMachineStatePage;
}>): Promise<void> {
  const machineDraft = params.page.getByTestId('settings.machines.draft.form');
  if ((await machineDraft.count()) === 0) {
    return;
  }

  const discard = params.page.getByTestId('settings.machines.draft.discard');
  await expect.poll(async () => await discard.count(), { timeout: 60_000 }).toBe(1);
  await discard.click();
  await expect.poll(async () => await machineDraft.count(), { timeout: 120_000 }).toBe(0);
}

export async function createAccountAndReachConnectMachineState(params: Readonly<{
  page: CreateAccountAndReachConnectMachineStatePage;
  useFirstCreateButton?: boolean | undefined;
  requirePersistedAuthCredentials?: boolean | undefined;
}>): Promise<void> {
  const machineDraft = params.page.getByTestId('settings.machines.draft.form');
  const switchedToSessionsTabRef = { current: false };
  let initialCreateButton: TestIdLocator | null = null;

  let initialState: 'create-account' | 'authenticated-home' | 'machine-draft' | null = null;
  await expect
    .poll(async () => {
      if (await dismissFirstLaunchOnboardingIfVisible(params.page)) {
        initialState = null;
        return false;
      }
      if (await clickPreAuthProgressButtonIfPresent(params.page)) {
        initialState = null;
        return false;
      }
      const createButton = await findVisibleCreateAccountButton(params);
      if (createButton) {
        initialCreateButton = createButton;
        initialState = 'create-account';
        return true;
      }
      if (await isAuthenticatedSessionHomeVisible(params.page)) {
        initialState = 'authenticated-home';
        return true;
      }
      if (await isVisible(machineDraft)) {
        initialState = 'machine-draft';
        return true;
      }
      if (await trySwitchToSessionsTab({ page: params.page, switchedRef: switchedToSessionsTabRef })) {
        initialState = null;
        return false;
      }
      initialState = null;
      return false;
    }, { timeout: 60_000 })
    .toBe(true);

  if (initialState === 'create-account') {
    await clickCreateAccountButton(initialCreateButton);
  }

  await expect
    .poll(async () => {
      if (await clickPreAuthProgressButtonIfPresent(params.page)) return false;
      const createAccountVisible = (await findVisibleCreateAccountButton(params)) !== null;
      if (await isVisible(machineDraft)) return true;
      if (createAccountVisible) return false;
      if (await trySwitchToSessionsTab({ page: params.page, switchedRef: switchedToSessionsTabRef })) {
        return false;
      }
      return isAuthenticatedSessionHomeVisible(params.page);
    }, { timeout: 120_000 })
    .toBe(true);

  const hadMachineDraft = await isVisible(machineDraft);
  await discardMachineAddDraftIfVisible({ page: params.page });
  if (hadMachineDraft && params.page.evaluate) {
    // Discard returns to Machines, not Home. This helper promises session entry.
    await params.page.evaluate(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }
  const requirePersistedAuthCredentials = params.requirePersistedAuthCredentials !== false;

  await expect.poll(async () => {
    if ((await findVisibleCreateAccountButton(params)) !== null) return 0;
    if (!(await isAuthenticatedSessionHomeVisible(params.page))) return 0;
    if (!requirePersistedAuthCredentials) return 1;
    if (await hasDurableAuthenticatedSessionHomeVisible(params.page)) return 1;
    return (await hasPersistedAuthCredentials(params.page)) ? 1 : 0;
  }, { timeout: 120_000 }).toBe(1);
}

export async function createAccountAndReachMachineAddDraftState(params: Readonly<{
  page: CreateAccountAndReachConnectMachineStatePage;
  useFirstCreateButton?: boolean | undefined;
}>): Promise<void> {
  await createAccountAndReachConnectMachineState(params);
  await navigateToMachineAddDraft(params.page);
  await expect.poll(async () => await params.page.getByTestId('settings.machines.draft.form').count(), { timeout: 120_000 }).toBe(1);
}
