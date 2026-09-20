import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Imported from their own testkit modules rather than the `@/dev/testkit`
 * barrel. The barrel re-exports `fixtures/agentCatalogFixtures`, whose
 * production projection reaches `@/sync/runtime/orchestration/connectionManager`
 * and, through it, `@/sync/http/client` and the reachability fetch. Evaluating
 * that graph on this file's first import binds the real transports and freezes
 * the applied active Home to the built-in default *before*
 * `installHomeGovernanceBoundaries` can install either boundary, so every Home
 * request leaves the harness and the screen never settles. This is the same
 * rule the harness states for its own late imports.
 */
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import {
    homeAccountRowFixture,
    homeGovernanceProjectionFixture,
} from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
} from '@/dev/testkit/harness/homeGovernanceHarness';
import { collectRenderedTestIds } from '@/dev/testkit/render/collectRenderedTestIds';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modalState = vi.hoisted(() => ({
    confirmResult: true,
    alerts: [] as Array<{ title: string; body: string }>,
}));
const routerBack = vi.hoisted(() => vi.fn());
const announceAccessibilityMessage = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/accessibility/announceAccessibilityMessage', () => ({
    announceAccessibilityMessage,
}));

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: vi.fn(), back: routerBack }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
    // The modal is a platform presentation boundary; the confirmation decision
    // it returns is what this surface is being tested against.
    modal: async () => ({
        Modal: {
            confirm: async () => modalState.confirmResult,
            alertAsync: async (title: string, body: string) => {
                modalState.alerts.push({ title, body });
            },
        },
    }),
});

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const GOVERNANCE_PATH = '/v1/home/governance/get';
const LIST_PATH = '/v1/home/accounts/list';
const DISABLE_PATH = '/v1/home/accounts/disable';
const DELETE_PATH = '/v1/home/accounts/delete';

/**
 * The answer the Home actually returns from the disable intent: its declared
 * Action output is the updated `HomeAccountRowV1`, so a body that is not one is
 * a refusal rather than a completed mutation.
 */
function disabledAccountRow() {
    return homeAccountRowFixture('ada', {
        status: 'suspended',
        mutationCapabilities: {
            setRole: {
                member: { status: 'unavailable', reason: 'target_inactive' },
                admin: { status: 'unavailable', reason: 'target_inactive' },
                owner: { status: 'unavailable', reason: 'target_inactive' },
            },
            disable: { status: 'unavailable', reason: 'target_not_active' },
            reenable: { status: 'available' },
            delete: { status: 'available' },
        },
    });
}

async function renderAccount(serverId: string, accountId = 'ada') {
    const { HomeAdministrationAccountScreen } = await import('./HomeAdministrationAccountScreen');
    const { resetHomeGovernanceEngineForTests } = await import('@/sync/engine/home/governance/homeGovernanceEngine');
    resetHomeGovernanceEngineForTests();
    const screen = await renderScreen(
        <HomeAdministrationAccountScreen serverId={serverId} accountId={accountId} />,
    );
    await vi.waitFor(() => {
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-account-status');
    });
    return screen;
}

async function renderAccountLookup(serverId: string, accountId = 'ada') {
    const { HomeAdministrationAccountScreen } = await import('./HomeAdministrationAccountScreen');
    const { resetHomeGovernanceEngineForTests } = await import('@/sync/engine/home/governance/homeGovernanceEngine');
    resetHomeGovernanceEngineForTests();
    return renderScreen(
        <HomeAdministrationAccountScreen serverId={serverId} accountId={accountId} />,
    );
}

async function addAdministeredHome(options?: Readonly<{
    projection?: Parameters<typeof homeGovernanceProjectionFixture>[0];
    rows?: readonly ReturnType<typeof homeAccountRowFixture>[];
}>): Promise<string> {
    const home = await harness.addHome({
        name: 'Home A',
        serverUrl: 'https://home-a.example',
        accountId: 'account-admin',
    });
    harness.answer(home, GOVERNANCE_PATH, {
        body: homeGovernanceProjectionFixture(options?.projection),
    });
    harness.answer(home, LIST_PATH, {
        body: {
            items: options?.rows ?? [homeAccountRowFixture('ada')],
            nextCursor: null,
        },
    });
    return home;
}

beforeEach(async () => {
    const { resetHomeGovernanceSnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceSnapshots'
    );
    resetHomeGovernanceSnapshotsForTests();
    const { resetServerFeaturesClientForTests } = await import(
        '@/sync/api/capabilities/serverFeaturesClient'
    );
    resetServerFeaturesClientForTests();
    await harness.reset();
    modalState.confirmResult = true;
    modalState.alerts = [];
    routerBack.mockReset();
    announceAccessibilityMessage.mockReset();
});

afterEach(() => {
    standardCleanup();
});

describe('HomeAdministrationAccountScreen', () => {
    it('announces one completed Account mutation through the shared accessibility owner', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, DISABLE_PATH, { body: disabledAccountRow() });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-disable');

        await vi.waitFor(() => {
            expect(announceAccessibilityMessage).toHaveBeenCalledOnce();
        });
        expect(announceAccessibilityMessage).toHaveBeenLastCalledWith(
            'homeGovernance.disable. common.success',
        );
    });

    it('shows only the administered Account sign-in email and usable Home method labels', async () => {
        const home = await addAdministeredHome({
            projection: {
                authenticationOptions: {
                    methods: [
                        { id: 'email_password', displayName: 'Email and password', actions: [] },
                        { id: 'managed-okta', displayName: 'Acme SSO', actions: [] },
                    ],
                    permittedAccountModes: ['e2ee'],
                    recommendedProvisioningMode: 'e2ee',
                    signInService: { deploymentMode: null, canDisable: false },
                },
            },
            rows: [homeAccountRowFixture('ada', {
                authentication: {
                    signInEmail: 'ada@example.test',
                    usableMethodIds: ['email_password', 'managed-okta'],
                },
            })],
        });

        const screen = await renderAccount(home);

        expect(screen.getTextContent()).toContain('ada@example.test');
        expect(screen.getTextContent()).toContain('Email and password, Acme SSO');
    });

    it('shows an explicit empty state when the Account has no sign-in email or usable method', async () => {
        const home = await addAdministeredHome();

        const screen = await renderAccount(home);

        expect(screen.getTextContent()).toContain('settingsAccount.nativePassword.signInEmailNotSet');
        expect(screen.getTextContent()).toContain('settingsAccount.nativePassword.notEligible');
    });

    it('never exposes raw or unavailable authentication method identifiers', async () => {
        const home = await addAdministeredHome({
            projection: {
                authenticationOptions: {
                    methods: [
                        { id: 'managed-okta', displayName: 'Acme SSO', actions: [] },
                        { id: 'internal-unlabelled', actions: [] },
                    ],
                    permittedAccountModes: ['e2ee'],
                    recommendedProvisioningMode: 'e2ee',
                    signInService: { deploymentMode: null, canDisable: false },
                },
            },
            rows: [homeAccountRowFixture('ada', {
                authentication: {
                    signInEmail: null,
                    usableMethodIds: ['managed-okta', 'internal-unlabelled', 'unavailable-secret-method'],
                },
            })],
        });

        const screen = await renderAccount(home);

        expect(screen.getTextContent()).toContain('Acme SSO');
        expect(screen.getTextContent()).not.toContain('internal-unlabelled');
        expect(screen.getTextContent()).not.toContain('unavailable-secret-method');
    });

    it('shows a failed roster read with retry instead of claiming the account is absent', async () => {
        const home = await addAdministeredHome({ rows: [] });
        harness.answer(home, LIST_PATH, {
            status: 503,
            body: { error: 'temporarily_unavailable' },
        });

        const screen = await renderAccountLookup(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-account-roster-error');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-account-unavailable');

        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('ada')], nextCursor: null },
        });
        await screen.pressByTestIdAsync('home-account-roster-retry');
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-account-status');
        });
    });

    it('shows an unsupported roster operation instead of claiming the account is absent', async () => {
        const home = await addAdministeredHome({ rows: [] });
        harness.answer(home, LIST_PATH, {
            status: 404,
            body: { error: 'not_found' },
        });

        const screen = await renderAccountLookup(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-account-roster-unsupported');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-account-unavailable');
    });

    it('shows not found only after the Home successfully exhausts its roster', async () => {
        const home = await addAdministeredHome({ rows: [] });

        const screen = await renderAccountLookup(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-account-unavailable');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-account-roster-error');
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-account-roster-unsupported');
    });

    it('disables an account through the exact Home after an explicit confirmation', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, DISABLE_PATH, { body: disabledAccountRow() });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-disable');

        await vi.waitFor(() => {
            expect(harness.requestsFor(DISABLE_PATH)).toHaveLength(1);
        });
        const [request] = harness.requestsFor(DISABLE_PATH);
        expect(request?.serverId).toBe(home);
        expect(request?.input).toEqual({ accountId: 'ada' });
    });

    it('exposes the exact pending lifecycle action as busy and prevents a duplicate submission', async () => {
        const home = await addAdministeredHome();
        let finishDisable: (() => void) | null = null;
        const disableResponse = new Promise<void>((resolve) => { finishDisable = resolve; });
        harness.answer(home, DISABLE_PATH, { body: disabledAccountRow(), respondAfter: disableResponse });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-disable');

        await vi.waitFor(() => expect(harness.requestsFor(DISABLE_PATH)).toHaveLength(1));
        const pending = screen.findByTestId('home-account-disable');
        expect(pending?.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
        // The canonical Item primitive removes activation while busy, so the
        // same pointer/touch target cannot submit a second request.
        expect(pending?.props.onPress ?? pending?.props.onClick).toBeUndefined();
        expect(harness.requestsFor(DISABLE_PATH)).toHaveLength(1);

        await act(async () => {
            finishDisable?.();
            await disableResponse;
        });
        await vi.waitFor(() => {
            const settled = screen.findByTestId('home-account-disable');
            expect(settled?.props.accessibilityState?.busy).not.toBe(true);
            expect(settled?.props.onPress ?? settled?.props.onClick).toBeTypeOf('function');
        });
    });

    it('sends the change to the Home being administered, not the focused one', async () => {
        const administered = await addAdministeredHome();
        // A second Home becomes the focused one after the administration screen
        // was opened for the first. The shared executor falls back to the
        // focused Home when an intent names none, so this is what proves the
        // screen supplies its own Home rather than inheriting that fallback.
        const focused = await harness.addHome({
            name: 'Home B',
            serverUrl: 'https://home-b.example',
            accountId: 'account-other',
        });
        harness.answer(focused, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });
        harness.answer(focused, DISABLE_PATH, { body: disabledAccountRow() });
        harness.answer(administered, DISABLE_PATH, { body: disabledAccountRow() });

        const screen = await renderAccount(administered);
        await screen.pressByTestIdAsync('home-account-disable');

        await vi.waitFor(() => {
            expect(harness.requestsFor(DISABLE_PATH)).toHaveLength(1);
        });
        expect(harness.requestsFor(DISABLE_PATH)[0]?.serverId).toBe(administered);
        expect(harness.requestsFor(DISABLE_PATH)[0]?.serverUrl).toBe('https://home-a.example');
    });

    it('changes nothing when the destructive confirmation is declined', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, DISABLE_PATH, { body: disabledAccountRow() });
        modalState.confirmResult = false;

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-disable');

        expect(harness.requestsFor(DISABLE_PATH)).toHaveLength(0);
    });

    it('offers Re-enable only for the reversible hold, never for a retired account', async () => {
        const held = await addAdministeredHome({
            rows: [homeAccountRowFixture('ada', {
                status: 'suspended',
                mutationCapabilities: {
                    setRole: {
                        member: { status: 'unavailable', reason: 'target_inactive' },
                        admin: { status: 'unavailable', reason: 'target_inactive' },
                        owner: { status: 'unavailable', reason: 'target_inactive' },
                    },
                    disable: { status: 'unavailable', reason: 'target_not_active' },
                    reenable: { status: 'available' },
                    delete: { status: 'available' },
                },
            })],
        });
        const screen = await renderAccount(held);
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-account-enable');

        await harness.reset();
        const retired = await addAdministeredHome({
            rows: [homeAccountRowFixture('ada', {
                status: 'disabled',
                mutationCapabilities: {
                    setRole: {
                        member: { status: 'unavailable', reason: 'target_inactive' },
                        admin: { status: 'unavailable', reason: 'target_inactive' },
                        owner: { status: 'unavailable', reason: 'target_inactive' },
                    },
                    disable: { status: 'unavailable', reason: 'target_retired' },
                    reenable: { status: 'unavailable', reason: 'target_retired' },
                    delete: { status: 'available' },
                },
            })],
        });
        const retiredScreen = await renderAccount(retired);
        expect(collectRenderedTestIds(retiredScreen.tree.toJSON())).not.toContain('home-account-enable');
        expect(collectRenderedTestIds(retiredScreen.tree.toJSON())).toContain('home-account-delete');
    });

    it('reports an unfinished deletion as unfinished and keeps the screen open', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, DELETE_PATH, { body: { status: 'disabled_pending_completion' } });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-delete');

        await vi.waitFor(() => {
            expect(modalState.alerts).toHaveLength(1);
            expect(harness.requestsFor(LIST_PATH)).toHaveLength(2);
        });
        // Never reported as a completed deletion, and the account's own screen
        // stays open so an authorized owner can retry from it.
        expect(routerBack).not.toHaveBeenCalled();
    });

    it('leaves the account screen once a deletion actually completed', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, DELETE_PATH, { body: { status: 'deleted' } });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-delete');

        await vi.waitFor(() => {
            expect(routerBack).toHaveBeenCalled();
        });
    });

    it('never claims nothing changed when a dispatched mutation lost its answer', async () => {
        const home = await addAdministeredHome();
        // The Home received the disable request and then stopped answering. The
        // transport preserves that uncertainty all the way to this surface, so
        // the administrator must not be told the account is untouched: a second
        // press would be a second non-idempotent governance mutation.
        harness.answer(home, DISABLE_PATH, { dispatchThenFail: true });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-disable');

        await vi.waitFor(() => {
            expect(modalState.alerts).toHaveLength(1);
        });
        const alert = modalState.alerts[0]!;
        expect(`${alert.title} ${alert.body}`).toContain('errorOutcomeUnknown');
        expect(`${alert.title} ${alert.body}`).not.toContain('errorGeneric');
        // The roster is re-read so the person can see what the Home actually holds.
        await vi.waitFor(() => {
            expect(harness.requestsFor(LIST_PATH).length).toBeGreaterThan(1);
        });
    });

    it('carries the Home typed refusal back instead of a generic failure', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, DISABLE_PATH, {
            status: 409,
            body: { error: 'home_owner_transfer_required' },
        });

        const screen = await renderAccount(home);
        await screen.pressByTestIdAsync('home-account-disable');

        await vi.waitFor(() => {
            expect(modalState.alerts).toHaveLength(1);
            expect(harness.requestsFor(LIST_PATH)).toHaveLength(2);
        });
        // The Home's own typed code reached the surface through the real status
        // classification, so the administrator is told what actually blocked it.
        expect(modalState.alerts[0]?.body).toContain('errorOwnerTransferRequired');
    });

    it('explains the last active owner instead of offering a demotion that would strand the Home', async () => {
        const home = await addAdministeredHome({
            projection: { activeOwnerCount: 1 },
            rows: [homeAccountRowFixture('ada', {
                homeRole: 'owner',
                mutationCapabilities: {
                    setRole: {
                        member: { status: 'unavailable', reason: 'last_active_owner' },
                        admin: { status: 'unavailable', reason: 'last_active_owner' },
                        owner: { status: 'unavailable', reason: 'unchanged' },
                    },
                    disable: { status: 'unavailable', reason: 'last_active_owner' },
                    reenable: { status: 'unavailable', reason: 'target_not_suspended' },
                    delete: { status: 'unavailable', reason: 'last_active_owner' },
                },
            })],
        });

        const screen = await renderAccount(home);
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        // The role chooser is withheld, the reason is stated, and the roles that
        // remain visible are never a locally invented ladder.
        expect(ids).not.toContain('home-account-role:member');
        expect(screen.getTextContent()).toContain('homeGovernance.reasonLastActiveOwner');
    });

    it('offers the roles the viewer may actually assign, and no others', async () => {
        const home = await addAdministeredHome({
            projection: {
                viewer: { accountId: 'account-admin', homeRole: 'admin', status: 'active' },
            },
            rows: [homeAccountRowFixture('ada', {
                mutationCapabilities: {
                    setRole: {
                        member: { status: 'unavailable', reason: 'unchanged' },
                        admin: { status: 'available' },
                        owner: { status: 'unavailable', reason: 'not_authorized' },
                    },
                    disable: { status: 'available' },
                    reenable: { status: 'unavailable', reason: 'target_not_suspended' },
                    delete: { status: 'unavailable', reason: 'not_authorized' },
                },
            })],
        });

        const screen = await renderAccount(home);
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).toContain('home-account-role:member');
        expect(ids).toContain('home-account-role:admin');
        // An admin may not create or remove Home owners.
        expect(ids).not.toContain('home-account-role:owner');
    });

    it('renders a server-projected Team ownership blocker without issuing deletion', async () => {
        const home = await addAdministeredHome({
            rows: [homeAccountRowFixture('ada', {
                mutationCapabilities: {
                    setRole: {
                        member: { status: 'unavailable', reason: 'unchanged' },
                        admin: { status: 'available' },
                        owner: { status: 'available' },
                    },
                    disable: { status: 'available' },
                    reenable: { status: 'unavailable', reason: 'target_not_suspended' },
                    delete: { status: 'unavailable', reason: 'team_owner_transfer_required' },
                },
            })],
        });

        const screen = await renderAccount(home);
        const deleteControl = screen.findByTestId('home-account-delete')!;
        expect(deleteControl.props['aria-disabled'] === true
            || deleteControl.props.accessibilityState?.disabled === true).toBe(true);
        expect(screen.getTextContent()).toContain('homeGovernance.errorTeamOwnerTransferRequired');
        expect(harness.requestsFor(DELETE_PATH)).toHaveLength(0);
    });
});
