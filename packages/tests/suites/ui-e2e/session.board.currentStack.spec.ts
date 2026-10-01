import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureQaUiUrlHasHmrDisabled,
  withQaUiBase,
} from '../../../../scripts/qa/resolveQaUiUrl.mjs';
import {
  attestCurrentManagedStackSourcePluginGeneration,
  deleteCurrentManagedStackSession,
  resolveCurrentManagedStackPluginUiContext,
  type CurrentManagedStackPluginUiContext,
} from '../../src/testkit/pluginPlatform/currentManagedStackPluginUiQa';
import {
  applyTrustedLocalPluginFixture,
  uninstallTrustedLocalPluginFixture,
} from '../../src/testkit/externalSessionLiveLifecycleFixture';
import { createSession } from '../../src/testkit/sessions';
import {
  gotoDomContentLoadedWithRetries,
  waitForAuthenticatedRouteUi,
} from '../../src/testkit/uiE2e/pageNavigation';
import { installAuthBootstrapStorageSnapshot } from '../../src/testkit/uiE2e/readLegacyAuthSecretFromLocalStorage';

const enabled = process.env.HAPPIER_E2E_SESSION_BOARD_CURRENT_STACK === '1';
const expectedFeatureState = process.env.HAPPIER_E2E_SESSION_BOARD_EXPECTED_STATE;
const BOARD_HEADER_OVERFLOW_TEST_ID = 'dropdown-option-header_openBoard';
const COMPANION_HEADER_OVERFLOW_TEST_ID = 'dropdown-option-header_openCompanion';
const widgetJourneyEnabled = process.env.HAPPIER_E2E_SESSION_BOARD_WIDGET === '1';
const PUBLIC_AUTHORING_PLUGIN_ID = 'examples.public-sdk-review-assistant';
const PUBLIC_AUTHORING_WIDGET_LOCAL_ID = 'review-status-widget';
function publicAuthoringPluginRoot(): string {
  return resolve(join(dirname(fileURLToPath(import.meta.url)), '../../../..', 'packages/plugin-sdk/examples/public-authoring'));
}

function currentAccountAccessToken(context: CurrentManagedStackPluginUiContext): string {
  const raw = JSON.parse(context.authStorage.localStorage.auth_credentials) as { token?: unknown };
  if (typeof raw.token !== 'string' || raw.token.trim() === '') {
    throw new Error('session_board_current_stack_account_access_token_missing');
  }
  return raw.token;
}

async function createDisposablePlainSession(context: CurrentManagedStackPluginUiContext): Promise<string> {
  const created = await createSession(
    context.serverUrl,
    currentAccountAccessToken(context),
    { dataEncryptionKeyBase64: null, timeoutMs: 30_000 },
  );
  return created.sessionId;
}

function sessionUrl(context: CurrentManagedStackPluginUiContext, sessionId: string): string {
  return ensureQaUiUrlHasHmrDisabled(withQaUiBase(context.uiUrl, `/session/${sessionId}`));
}

async function visitSession(params: Readonly<{
  page: Page;
  context: CurrentManagedStackPluginUiContext;
  sessionId: string;
}>): Promise<void> {
  const targetUrl = sessionUrl(params.context, params.sessionId);
  await gotoDomContentLoadedWithRetries(params.page, targetUrl, 180_000);
  await waitForAuthenticatedRouteUi({
    page: params.page,
    expectedPathname: `/session/${params.sessionId}`,
    requiredTestIds: ['session-composer-input'],
    targetUrl,
    timeoutMs: 180_000,
  });
}

async function openBoard(page: Page): Promise<void> {
  const alreadyOpen = page.getByTestId('session-board-pane-surface');
  if (await alreadyOpen.isVisible().catch(() => false)) return;

  const direct = page.getByTestId('session-header-board-button');
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByTestId('session-header-action-menu-trigger').click();
    await page.getByTestId(BOARD_HEADER_OVERFLOW_TEST_ID).click();
  }
  await expect(alreadyOpen).toBeVisible({ timeout: 120_000 });
}

async function openMobileBoard(page: Page): Promise<void> {
  const direct = page.getByTestId('session-cockpit-tab-board');
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByTestId('session-cockpit-tab-more').click();
    await page.getByTestId('session-cockpit-more-item:board').click();
  }
  await expect(page.getByTestId('session-board-screen')).toBeVisible({ timeout: 120_000 });
}

async function openMobileCompanion(page: Page): Promise<void> {
  const alreadyOpen = page.getByTestId('session-companion-screen');
  if (await alreadyOpen.isVisible().catch(() => false)) return;

  const direct = page.getByTestId('session-header-companion');
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.getByTestId('session-header-action-menu-trigger').click();
    await page.getByTestId(COMPANION_HEADER_OVERFLOW_TEST_ID).click();
  }
  await expect(alreadyOpen).toBeVisible({ timeout: 120_000 });
}

function noteBodyInput(page: Page) {
  return page.getByTestId('session-board-note-editor-body').locator('textarea').first();
}

async function replaceHostedHtmlEditorSource(page: Page, html: string): Promise<void> {
  const source = page.getByTestId('session-board-hosted-html-editor-source');
  await expect(source).toBeVisible();
  const textarea = source.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(html);
}

async function beginEditingItem(page: Page, itemId: string): Promise<void> {
  await openItemMenu(page, itemId);
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('session-board-note-editor')).toBeVisible({ timeout: 60_000 });
}

/** The mounted Board's item titles, in the shared layout's current order. */
async function boardItemTitles(page: Page): Promise<string[]> {
  return await page
    .getByTestId('session-board-pane-surface')
    .locator('[data-testid^="session-board-item-"][data-testid$="-title"]')
    .allTextContents();
}

async function chooseBoardAddIntent(page: Page, intent: 'note' | 'interactiveView' | 'fromPlugins'): Promise<void> {
  await page.getByTestId('session-board-pane-surface-add-trigger').click();
  await page.getByTestId(`add-${intent}`).click();
}

async function createNote(page: Page, params: Readonly<{ title: string; body: string }>): Promise<string> {
  await chooseBoardAddIntent(page, 'note');
  await expect(page.getByTestId('session-board-note-editor')).toBeVisible();
  await page.getByTestId('session-board-note-editor-title').fill(params.title);
  const body = noteBodyInput(page);
  // The last character is typed rather than filled: a Save that reads a stale
  // debounced draft loses exactly this keystroke and nothing else.
  await body.fill(params.body.slice(0, -1));
  await body.pressSequentially(params.body.slice(-1), { delay: 0 });
  await page.getByTestId('session-board-note-editor-save').click();

  const itemTitle = page
    .locator('[data-testid^="session-board-item-"][data-testid$="-title"]', { hasText: params.title })
    .first();
  await expect(itemTitle).toBeVisible({ timeout: 120_000 });
  const titleTestId = await itemTitle.getAttribute('data-testid');
  const itemId = titleTestId?.slice('session-board-item-'.length, -'-title'.length);
  expect(itemId).toBeTruthy();
  return itemId!;
}

async function openItemMenu(page: Page, itemId: string): Promise<void> {
  await page.getByTestId(`session-board-item-${itemId}-actions`).click();
}

async function boardItemWidthPx(page: Page, itemId: string): Promise<number> {
  const box = await page.getByTestId(`session-board-item-${itemId}`).boundingBox();
  return box?.width ?? 0;
}

/**
 * Whether this mounted Board actually has columns to show a semantic width in.
 *
 * `sessionBoardGridLayout` linearizes the whole grid below two readable columns
 * (`SESSION_BOARD_MIN_ITEM_WIDTH_PX` 240 twice plus the 12px gutter), and there
 * every width renders full-bleed by design. Measuring the real container keeps
 * the width comparison below an assertion about the grid rather than about the
 * pane geometry this run happened to get.
 */
async function boardGridHasColumns(page: Page): Promise<boolean> {
  const box = await page.getByTestId('session-board-pane-surface-scroll').boundingBox();
  return (box?.width ?? 0) >= 240 * 2 + 12;
}

function installUiByteCapture(page: Page, uiUrl: string) {
  const responses: Array<Readonly<{ url: string; digest: string; byteSize: number }>> = [];
  const uiOrigin = new URL(uiUrl).origin;
  page.on('response', async (response) => {
    const contentType = response.headers()['content-type'] ?? '';
    if (response.status() !== 200 || response.request().resourceType() !== 'script') return;
    if (new URL(response.url()).origin !== uiOrigin) return;
    if (!/javascript|ecmascript/u.test(contentType)) return;
    try {
      const bytes = await response.body();
      responses.push(Object.freeze({
        url: response.url(),
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        byteSize: bytes.byteLength,
      }));
    } catch {
      // Superseded Expo requests can disappear. The journey requires at least
      // one adopted response below, so this cannot turn a missing load green.
    }
  });
  return responses;
}

async function attachLoadedRuntimeEvidence(params: Readonly<{
  testInfo: TestInfo;
  context: CurrentManagedStackPluginUiContext;
  uiResponses: readonly Readonly<{ url: string; digest: string; byteSize: number }>[];
}>): Promise<void> {
  expect(params.uiResponses.length).toBeGreaterThan(0);
  await params.testInfo.attach('session-board-current-stack-loaded-runtime.json', {
    body: Buffer.from(`${JSON.stringify({
      stackName: params.context.stackName,
      runtimeJsonPath: params.context.runtimeJsonPath,
      serverUrl: params.context.serverUrl,
      daemon: {
        pid: params.context.daemon.pid,
        runtimeId: params.context.daemon.runtimeId,
        runtimeEntrypoint: params.context.daemon.runtimeEntrypoint,
        distClosureFingerprint: params.context.daemon.distClosureFingerprint,
      },
      runtime: params.context.runtime,
      uiProducer: params.context.uiProducer,
      uiResponses: params.uiResponses,
    }, null, 2)}\n`, 'utf8'),
    contentType: 'application/json',
  });
}

/**
 * What this suite proves, and what it deliberately does not.
 *
 * It attaches to an already-running managed Stack and asserts the exact
 * generation named by `HAPPIER_E2E_SESSION_BOARD_EXPECTED_STATE`: the `off`
 * generation must expose no Board entry point at all, and the `enabled`
 * generation must complete the human Plain vertical — create, final keystroke,
 * reload, two-client CAS conflict, Companion with Session Summary, safe Undo,
 * responsive continuity/focus handoff, reorder, resize and confirmed removal.
 * A sibling enabled-generation journey creates caller-authored HTML through the
 * reachable Board control and drives its real browser frame and external-link
 * containment. The external-style plugin journey proves a Session-targeted
 * `widget` beyond the Board's native wrapper.
 *
 * Not covered here, with the live recipe that owns each:
 * - E2EE Board: needs an Account with encryption material and a Session created
 *   with its sealed DEK (`createSession({ dataEncryptionKeyBase64 })`); run the
 *   umbrella's Recipe 2 against an E2EE Stack generation rather than faking a
 *   key in this Plain harness.
 * - Agent authoring: the four `session.board.*` Actions are exercised against a
 *   real Agent turn by the umbrella's Recipe 1 step 2; this suite drives only
 *   the human callers of those same Actions.
 * - Installed `widget`: the fourth test below, which additionally needs
 *   `HAPPIER_E2E_SESSION_BOARD_WIDGET=1` and the daemon control token.
 */
test.describe('current managed Stack Session Board', () => {
  test.skip(!enabled, 'Set HAPPIER_E2E_SESSION_BOARD_CURRENT_STACK=1 to attach to an already-running managed Stack.');
  test.skip(
    expectedFeatureState !== 'off' && expectedFeatureState !== 'enabled',
    'Set HAPPIER_E2E_SESSION_BOARD_EXPECTED_STATE=off or enabled for the exact Stack generation under test.',
  );
  test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 });

  let context: CurrentManagedStackPluginUiContext;
  let sessionId: string | null = null;

  test.beforeAll(async () => {
    context = await resolveCurrentManagedStackPluginUiContext();
    sessionId = await createDisposablePlainSession(context);
  });

  test.afterAll(async () => {
    if (sessionId) await deleteCurrentManagedStackSession(context, sessionId);
  });

  test.beforeEach(async ({ page }) => {
    await installAuthBootstrapStorageSnapshot(page, context.authStorage);
  });

  test('keeps every Board entry point absent when the exact Home feature is off', async ({ page }, testInfo) => {
    test.skip(expectedFeatureState !== 'off', 'This assertion belongs to the default-off Stack generation.');
    const uiResponses = installUiByteCapture(page, context.uiUrl);
    await page.setViewportSize({ width: 1440, height: 900 });
    await visitSession({ page, context, sessionId: sessionId! });

    await expect(page.getByTestId('session-header-board-button')).toHaveCount(0);
    await expect(page.getByTestId('right-sidebar-tab:board')).toHaveCount(0);
    await page.getByTestId('session-header-action-menu-trigger').click();
    await expect(page.getByTestId(BOARD_HEADER_OVERFLOW_TEST_ID)).toHaveCount(0);
    await expect(page.getByTestId('session-board-pane')).toHaveCount(0);

    // The same exact-Home feature decision owns the mobile catalog. A hidden
    // desktop button with a still-routable Cockpit row would only half-close the
    // feature and let a retained mobile destination reach a live Board.
    await page.setViewportSize({ width: 390, height: 844 });
    await visitSession({ page, context, sessionId: sessionId! });
    await expect(page.getByTestId('session-cockpit-tab-board')).toHaveCount(0);
    const more = page.getByTestId('session-cockpit-tab-more');
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      await expect(page.getByTestId('session-cockpit-more-item:board')).toHaveCount(0);
    }
    await attachLoadedRuntimeEvidence({ testInfo, context, uiResponses });
  });

  test('composes Board persistence, CAS recovery, Companion locality, responsive continuity, and removal', async ({ page, browser }, testInfo) => {
    test.skip(expectedFeatureState !== 'enabled', 'This journey belongs to the feature-enabled Stack generation.');
    const uiResponses = installUiByteCapture(page, context.uiUrl);
    const title = `Lane 08 note ${Date.now()}`;
    const initialBodyPrefix = 'The final byte must be included';
    const initialBody = `${initialBodyPrefix}.`;
    const firstEdit = `${initialBody}\nwriter one`;
    const conflictingEdit = `${initialBody}\nwriter two wins after review`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await visitSession({ page, context, sessionId: sessionId! });
    await openBoard(page);
    await expect(page.getByTestId('session-board-pane-surface-empty')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('session-board-pane-surface-views-view-overview')).toBeVisible();

    const itemId = await createNote(page, { title, body: initialBody });
    await expect(page.getByTestId(`session-board-item-${itemId}-body`)).toContainText(initialBody);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAuthenticatedRouteUi({
      page,
      expectedPathname: `/session/${sessionId}`,
      requiredTestIds: ['session-composer-input'],
      targetUrl: sessionUrl(context, sessionId!),
      timeoutMs: 180_000,
    });
    await openBoard(page);
    await expect(page.getByTestId(`session-board-item-${itemId}-body`)).toContainText(initialBody);

    const second = await browser.newPage();
    try {
      await installAuthBootstrapStorageSnapshot(second, context.authStorage);
      await second.setViewportSize({ width: 1440, height: 900 });
      await visitSession({ page: second, context, sessionId: sessionId! });
      await openBoard(second);
      await beginEditingItem(page, itemId!);
      await beginEditingItem(second, itemId!);

      await noteBodyInput(page).fill(firstEdit);
      await page.getByTestId('session-board-note-editor-save').click();
      await expect(page.getByTestId('session-board-note-editor')).toHaveCount(0, { timeout: 120_000 });

      await noteBodyInput(second).fill(conflictingEdit);
      await second.getByTestId('session-board-note-editor-save').click();
      await expect(second.getByTestId('session-board-note-editor-notice')).toBeVisible({ timeout: 120_000 });
      await second.getByTestId('session-board-note-editor-review-latest').click();
      await expect(second.getByTestId('session-board-note-editor-review')).toBeVisible();
      await second.getByTestId('session-board-note-editor-save').click();
      await expect(second.getByTestId('session-board-note-editor')).toHaveCount(0, { timeout: 120_000 });
      await expect(second.getByTestId(`session-board-item-${itemId}-body`)).toContainText('writer two wins after review');

      // The first mounted client must converge through the ordinary Session
      // change transport while it stays open. Reload below separately proves
      // persistence; it cannot stand in for delivery to an active viewer.
      await expect(page.getByTestId(`session-board-item-${itemId}-body`))
        .toContainText('writer two wins after review', { timeout: 120_000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAuthenticatedRouteUi({
        page,
        expectedPathname: `/session/${sessionId}`,
        requiredTestIds: ['session-composer-input'],
        targetUrl: sessionUrl(context, sessionId!),
        timeoutMs: 180_000,
      });
      await openBoard(page);
      await expect(page.getByTestId(`session-board-item-${itemId}-body`)).toContainText('writer two wins after review');

      await openItemMenu(page, itemId!);
      await page.getByTestId('add-to-companion').click();
      await expect(page.getByTestId('session-companion-reserved-rail')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`session-companion-widget-${itemId}`)).toBeVisible();
      await expect(second.getByTestId('session-companion-reserved-rail')).toHaveCount(0);
      await expect(second.getByTestId('session-header-companion')).toHaveCount(0);

      // The first-party Session Summary joins the same viewer-local Companion
      // before any collapse/reopen: it is a Companion row, not a second host.
      await page.getByTestId('session-companion-menu').click();
      await page.getByTestId('add-summary').click();
      await expect(page.getByTestId('session-companion-content-summary')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`session-companion-widget-${itemId}`)).toBeVisible();
      // Inspecting Summary stays personal: the other client gains no Companion.
      await expect(second.getByTestId('session-companion-content-summary')).toHaveCount(0);
      await expect(second.getByTestId('session-companion-reserved-rail')).toHaveCount(0);

      await page.getByTestId('session-companion-menu').click();
      await page.getByTestId('collapse').click();
      await expect(page.getByTestId('session-companion-reserved-rail')).toHaveCount(0);
      await page.getByTestId('session-header-companion').click();
      await expect(page.getByTestId('session-companion-reserved-rail')).toBeVisible();
      // Reopening restores the viewer's own selection, Summary included.
      await expect(page.getByTestId('session-companion-content-summary')).toBeVisible();
      await expect(page.getByTestId(`session-companion-widget-${itemId}`)).toBeVisible();
      await expect(second.getByTestId('session-companion-reserved-rail')).toHaveCount(0);

      await page.getByTestId('session-companion-menu').click();
      await page.getByTestId('hide').click();
      await expect(page.getByTestId('session-companion-reserved-rail')).toHaveCount(0);
      await expect(page.getByTestId('current-session-presentation-notice-undo')).toBeVisible();
      await page.getByTestId('current-session-presentation-notice-undo').click();
      await expect(page.getByTestId('session-companion-reserved-rail')).toBeVisible();
      await expect(page.getByTestId(`session-board-item-${itemId}-body`)).toContainText('writer two wins after review');
      await expect(second.getByTestId('session-companion-reserved-rail')).toHaveCount(0);
    } finally {
      await second.close();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await openMobileCompanion(page);
    await page.getByTestId(`session-companion-content-item-widget:${itemId}-actions`).click();
    await page.getByTestId('open-board').click();
    await expect(page.getByTestId('session-board-screen')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('session-board-pane-surface-focused')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId(`session-board-item-${itemId}-body`)).toContainText('writer two wins after review');
    await page.getByTestId('session-board-pane-surface-focused-back').click();
    await expect(page.getByTestId('session-board-pane-surface-focused')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await visitSession({ page, context, sessionId: sessionId! });
    await openBoard(page);
    await expect(page.getByTestId(`session-board-item-${itemId}-body`)).toContainText('writer two wins after review');

    // Organizing the shared Board: a second item makes order observable, and
    // reorder/resize must survive a reload because both live in the shared
    // layout record rather than in this viewer's DOM.
    const secondTitle = `Lane 08 second note ${Date.now()}`;
    const secondItemId = await createNote(page, { title: secondTitle, body: 'Organized beside the first note.' });
    await expect.poll(async () => await boardItemTitles(page), { timeout: 120_000 })
      .toEqual(expect.arrayContaining([title, secondTitle]));
    const orderBeforeMove = await boardItemTitles(page);
    expect(orderBeforeMove).toHaveLength(2);

    // Move the second note to the opposite end, whichever end it landed on.
    const movesTowardStart = orderBeforeMove[1] === secondTitle;
    await openItemMenu(page, secondItemId);
    await page.getByTestId(movesTowardStart ? 'move-before' : 'move-after').click();
    const expectedOrder = movesTowardStart ? [secondTitle, title] : [title, secondTitle];
    await expect.poll(async () => await boardItemTitles(page), { timeout: 120_000 }).toEqual(expectedOrder);

    // Two different semantic widths, so the grid itself is the assertion rather
    // than one card's absolute pixels.
    const gridHasColumns = await boardGridHasColumns(page);
    await openItemMenu(page, itemId!);
    await page.getByTestId('resize-compact').click();
    await openItemMenu(page, secondItemId);
    await page.getByTestId('resize-full').click();
    const widthDelta = async () => (
      await boardItemWidthPx(page, secondItemId) - await boardItemWidthPx(page, itemId!)
    );
    if (gridHasColumns) {
      await expect.poll(widthDelta, { timeout: 120_000 }).toBeGreaterThan(0);
    }
    // Whether or not this pane has columns, a resize that failed would leave the
    // card in a typed failure state instead of rendering its content.
    await expect(page.getByTestId(`session-board-item-${itemId}-state`)).toHaveCount(0);
    await expect(page.getByTestId(`session-board-item-${secondItemId}-state`)).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAuthenticatedRouteUi({
      page,
      expectedPathname: `/session/${sessionId}`,
      requiredTestIds: ['session-composer-input'],
      targetUrl: sessionUrl(context, sessionId!),
      timeoutMs: 180_000,
    });
    await openBoard(page);
    // Order and semantic size are shared layout, so both survive the reload.
    await expect.poll(async () => await boardItemTitles(page), { timeout: 120_000 }).toEqual(expectedOrder);
    if (gridHasColumns) {
      await expect.poll(widthDelta, { timeout: 120_000 }).toBeGreaterThan(0);
    }

    // Destructive removal asks exactly once, and Cancel writes nothing: the item
    // survives and focus returns to the mounted Board view rather than the body.
    await openItemMenu(page, secondItemId);
    await page.getByTestId('remove').click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByTestId('web-modal-cancel').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId(`session-board-item-${secondItemId}-title`)).toBeVisible();
    await expect(page.getByTestId('session-board-pane-surface-views-view-overview')).toBeFocused();

    await openItemMenu(page, secondItemId);
    await page.getByTestId('remove').click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByTestId('web-modal-confirm').click();
    await expect(page.getByTestId(`session-board-item-${secondItemId}`)).toHaveCount(0, { timeout: 120_000 });

    await openItemMenu(page, itemId!);
    await page.getByTestId('remove').click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByTestId('web-modal-confirm')).toHaveCount(1);
    await page.getByTestId('web-modal-confirm').click();
    await expect(page.getByTestId(`session-board-item-${itemId}`)).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId('session-board-pane-surface-empty')).toBeVisible();

    await attachLoadedRuntimeEvidence({ testInfo, context, uiResponses });
  });

  test('creates, remounts, and contains a caller-authored interactive view through the real hosted frame', async ({ page }, testInfo) => {
    test.skip(expectedFeatureState !== 'enabled', 'This journey belongs to the feature-enabled Stack generation.');
    const uiResponses = installUiByteCapture(page, context.uiUrl);
    const hostedSessionId = await createDisposablePlainSession(context);
    const title = `Lane 08 interactive view ${Date.now()}`;
    const allowedUrl = 'https://example.test/lane08-hosted-html';
    const html = [
      '<main>',
      `<a href="${allowedUrl}">Open allowed documentation</a>`,
      '<a href="javascript:alert(\'denied\')">Reject unsafe navigation</a>',
      '</main>',
    ].join('');
    await page.context().route('https://example.test/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<main>External destination</main>' });
    });

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await visitSession({ page, context, sessionId: hostedSessionId });
      await openBoard(page);
      await chooseBoardAddIntent(page, 'interactiveView');
      await expect(page.getByTestId('session-board-hosted-html-editor')).toBeVisible();
      await page.getByTestId('session-board-hosted-html-editor-title').fill(title);
      await replaceHostedHtmlEditorSource(page, html);
      await page.getByTestId('session-board-hosted-html-editor-save').click();

      const itemTitle = page
        .locator('[data-testid^="session-board-item-"][data-testid$="-title"]', { hasText: title })
        .first();
      await expect(itemTitle).toBeVisible({ timeout: 120_000 });
      const titleTestId = await itemTitle.getAttribute('data-testid');
      const itemId = titleTestId?.slice('session-board-item-'.length, -'-title'.length);
      expect(itemId).toBeTruthy();

      const frame = page.frameLocator(`[data-testid="session-board-item-${itemId}-hosted-html"]`);
      await expect(frame.getByText('Open allowed documentation')).toBeVisible();
      const popupPromise = page.context().waitForEvent('page');
      await frame.getByText('Open allowed documentation').click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(allowedUrl);
      await popup.close();

      const openPageCount = page.context().pages().length;
      await frame.getByText('Reject unsafe navigation').click();
      expect(page.context().pages()).toHaveLength(openPageCount);
      await expect(page).toHaveURL(sessionUrl(context, hostedSessionId));
      await expect(frame.getByText('Open allowed documentation')).toBeVisible();

      // A reload retires the old frame lifetime and reconstructs the same
      // persisted record through the canonical Board/System Record readers.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAuthenticatedRouteUi({
        page,
        expectedPathname: `/session/${hostedSessionId}`,
        requiredTestIds: ['session-composer-input'],
        targetUrl: sessionUrl(context, hostedSessionId),
        timeoutMs: 180_000,
      });
      await openBoard(page);
      await expect(page.frameLocator(`[data-testid="session-board-item-${itemId}-hosted-html"]`)
        .getByText('Open allowed documentation')).toBeVisible({ timeout: 120_000 });

      await openItemMenu(page, itemId!);
      await page.getByTestId('remove').click();
      await page.getByTestId('web-modal-confirm').click();
      await expect(page.getByTestId(`session-board-item-${itemId}`)).toHaveCount(0, { timeout: 120_000 });
    } finally {
      await deleteCurrentManagedStackSession(context, hostedSessionId).catch(() => {});
    }
    await attachLoadedRuntimeEvidence({ testInfo, context, uiResponses });
  });

  test('places the real public-authoring external-style widget and retains it through uninstall/reinstall tombstone', async ({ page }, testInfo) => {
    test.skip(expectedFeatureState !== 'enabled', 'This journey belongs to the feature-enabled Stack generation.');
    test.skip(!widgetJourneyEnabled, 'Set HAPPIER_E2E_SESSION_BOARD_WIDGET=1 to exercise the installed widget journey on the managed Stack.');
    const uiResponses = installUiByteCapture(page, context.uiUrl);
    const pluginRoot = publicAuthoringPluginRoot();
    await applyTrustedLocalPluginFixture({
      daemonPort: context.daemon.port,
      controlToken: context.daemon.controlToken,
      pluginRoot,
      pluginId: PUBLIC_AUTHORING_PLUGIN_ID,
      interactionId: `board-widget-${Date.now()}`,
    });
    const installed = await attestCurrentManagedStackSourcePluginGeneration({ context, pluginId: PUBLIC_AUTHORING_PLUGIN_ID });
    expect(installed.appliedGeneration).toBe(installed.desiredGeneration);
    const widgetSessionId = await createDisposablePlainSession(context);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await visitSession({ page, context, sessionId: widgetSessionId });
      await openBoard(page);
      await chooseBoardAddIntent(page, 'fromPlugins');
      await expect(page.getByTestId('session-board-pane-widget-picker')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId(`session-board-pane-widget-picker-candidate-${PUBLIC_AUTHORING_PLUGIN_ID}-${PUBLIC_AUTHORING_WIDGET_LOCAL_ID}`).click();
      const widgetTitle = page.locator('[data-testid^="session-board-item-"][data-testid$="-title"]', { hasText: 'Review status' }).first();
      await expect(widgetTitle).toBeVisible({ timeout: 120_000 });
      const widgetTitleTestId = await widgetTitle.getAttribute('data-testid');
      const widgetItemId = widgetTitleTestId?.slice('session-board-item-'.length, -'-title'.length);
      expect(widgetItemId).toBeTruthy();
      await expect(page.getByTestId(`session-board-item-${widgetItemId}-provenance`)).toContainText('Review Assistant');
      // This control is rendered inside the external-style plugin, beyond the
      // Board's native title/provenance chrome. It appears only after the real
      // widget receives a Session target and reaches its Session-scoped
      // resource runtime; a missing target renders "needs a Session" instead.
      await expect(page.getByText('Refresh status').first()).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText('Review status needs a Session')).toHaveCount(0);
      await openItemMenu(page, widgetItemId!);
      await page.getByTestId('add-to-companion').click();
      await expect(page.getByTestId('session-companion-reserved-rail')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`session-companion-widget-${widgetItemId}`)).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await openMobileBoard(page);
      await expect(page.locator('[data-testid^="session-board-item-"][data-testid$="-title"]', { hasText: 'Review status' }).first()).toBeVisible({ timeout: 120_000 });
      await page.setViewportSize({ width: 1440, height: 900 });
      await visitSession({ page, context, sessionId: widgetSessionId });
      await openBoard(page);
      await uninstallTrustedLocalPluginFixture({
        daemonPort: context.daemon.port,
        controlToken: context.daemon.controlToken,
        pluginId: PUBLIC_AUTHORING_PLUGIN_ID,
      });
      await expect(page.getByTestId(`session-board-item-${widgetItemId}-title`)).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId(`session-board-item-${widgetItemId}-state`)).toBeVisible({ timeout: 120_000 });
      await applyTrustedLocalPluginFixture({
        daemonPort: context.daemon.port,
        controlToken: context.daemon.controlToken,
        pluginRoot,
        pluginId: PUBLIC_AUTHORING_PLUGIN_ID,
        interactionId: `board-widget-reinstall-${Date.now()}`,
      });
      const reinstalled = await attestCurrentManagedStackSourcePluginGeneration({ context, pluginId: PUBLIC_AUTHORING_PLUGIN_ID });
      expect(reinstalled.appliedGeneration).toBe(reinstalled.desiredGeneration);
      await expect(page.getByTestId(`session-board-item-${widgetItemId}-provenance`)).toContainText('Review Assistant', { timeout: 120_000 });
      await openItemMenu(page, widgetItemId!);
      await page.getByTestId('remove').click();
      await page.getByTestId('web-modal-confirm').click();
      await expect(page.getByTestId(`session-board-item-${widgetItemId}`)).toHaveCount(0, { timeout: 120_000 });
    } finally {
      await deleteCurrentManagedStackSession(context, widgetSessionId).catch(() => {});
      await uninstallTrustedLocalPluginFixture({
        daemonPort: context.daemon.port,
        controlToken: context.daemon.controlToken,
        pluginId: PUBLIC_AUTHORING_PLUGIN_ID,
      }).catch(() => {});
    }
    await attachLoadedRuntimeEvidence({ testInfo, context, uiResponses });
  });
});
