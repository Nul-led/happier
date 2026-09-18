import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    homeAccountPickerRowFixture,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    teamCapabilitiesFixture,
    teamGroupFixture,
    teamInvitationRowFixture,
    teamMembershipFixture,
    teamSummaryFixture,
} from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

/**
 * The last mile of a deferred Team journey.
 *
 * An explicit UI-approval requirement turns a Team mutation into a durable
 * approval request instead of an immediate answer. These cases are about what
 * the *initiating surface* then owes the person: that the wait is visible and
 * the control is withheld rather than silently doing nothing, and that when the
 * approval executes the journey continues at the Home's own result — the Team
 * or Group it created, the membership whose history was to be prepared, the
 * bearer that was minted — instead of degrading into "something changed".
 *
 * The approval binding itself is owned and proven elsewhere: the shared
 * continuation owner's suites already pin exact Artifact/Action/Home/Account/
 * input fencing, once-only delivery, scope-change custody release and typed
 * failure codes. So the operation clients are replaced here with exactly what
 * the real front door throws, and the Artifact — a stored-content boundary — is
 * replaced the way every other approval suite replaces it. Everything between,
 * including the real `useActionApprovalContinuation`, stays live.
 *
 * Invitation creation and reissue are the deliberate exception. They mint a raw
 * bearer, so they are declared live-only custody: the invocation waits, the
 * link returns to it alone, and the durable Artifact keeps only the safe
 * projection. Their case therefore proves the opposite property — that no
 * continuation is registered and the surface's own lifetime owns the wait.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerReplace = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
const routerBack = vi.hoisted(() => vi.fn());

const approvalArtifactState = vi.hoisted(() => ({
    value: {
        artifact: null as null | Readonly<Record<string, unknown> & { id: string }>,
        isLoading: false,
        error: null as boolean | null,
        invalidArtifact: false,
    },
    /**
     * Every artifact id the binding actually asked for.
     *
     * The settled decision only reaches a surface if the binding is reading the
     * exact Artifact the deferral registered; without this, a registration that
     * bound the wrong id is indistinguishable from an approval that never
     * settled, and both read as a surface that waits forever.
     */
    requested: [] as (string | null)[],
    listeners: new Set<() => void>(),
}));

/** Armed per case; unarmed operations keep their real implementation. */
const deferrals = vi.hoisted(() => ({
    createTeam: null as null | ((params: never) => Promise<never>),
    createTeamGroup: null as null | ((params: never) => Promise<never>),
    addTeamMember: null as null | ((params: never) => Promise<never>),
    createTeamInvitation: null as null | ((params: never) => Promise<never>),
    calls: { createTeam: 0, createTeamGroup: 0, addTeamMember: 0, createTeamInvitation: 0 },
}));

vi.mock('@/components/approvals/useApprovalArtifact', () => ({
    useApprovalArtifact: (input: Readonly<{ artifactId: string | null }>) => {
        const held = React.useSyncExternalStore(
            (listener) => {
                approvalArtifactState.listeners.add(listener);
                return () => approvalArtifactState.listeners.delete(listener);
            },
            () => approvalArtifactState.value,
            () => approvalArtifactState.value,
        );
        approvalArtifactState.requested.push(input.artifactId);
        return {
            ...held,
            artifact: held.artifact?.id === input.artifactId ? held.artifact : null,
            homeUnavailable: false,
            refresh: async () => {},
        };
    },
}));

vi.mock('@/sync/ops/teams/teamOperations', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/sync/ops/teams/teamOperations')>();
    return {
        ...original,
        createTeam: (params: never) => {
            deferrals.calls.createTeam += 1;
            return deferrals.createTeam ? deferrals.createTeam(params) : original.createTeam(params);
        },
    };
});

vi.mock('@/sync/ops/teams/teamGroupOperations', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/sync/ops/teams/teamGroupOperations')>();
    return {
        ...original,
        createTeamGroup: (params: never) => {
            deferrals.calls.createTeamGroup += 1;
            return deferrals.createTeamGroup
                ? deferrals.createTeamGroup(params)
                : original.createTeamGroup(params);
        },
    };
});

vi.mock('@/sync/ops/teams/teamMemberOperations', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/sync/ops/teams/teamMemberOperations')>();
    return {
        ...original,
        addTeamMember: (params: never) => {
            deferrals.calls.addTeamMember += 1;
            return deferrals.addTeamMember ? deferrals.addTeamMember(params) : original.addTeamMember(params);
        },
    };
});

vi.mock('@/sync/ops/teams/teamInvitationOperations', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/sync/ops/teams/teamInvitationOperations')>();
    return {
        ...original,
        createTeamInvitation: (params: never) => {
            deferrals.calls.createTeamInvitation += 1;
            return deferrals.createTeamInvitation
                ? deferrals.createTeamInvitation(params)
                : original.createTeamInvitation(params);
        },
    };
});

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: routerPush, replace: routerReplace, back: routerBack }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

// The clipboard and share sheet are genuine platform boundaries reached by the
// invitation link delivery; everything below them stays real.
const setClipboardStringSafeMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/utils/ui/clipboard', () => ({ setClipboardStringSafe: setClipboardStringSafeMock }));
vi.mock('@/utils/ui/shareText', () => ({
    isTextSharingAvailable: () => true,
    shareTextSafe: vi.fn(async () => 'shared' as const),
}));

vi.mock('@/utils/files/nativePickImages', () => ({ nativePickImages: vi.fn() }));
vi.mock('expo-file-system', () => ({
    File: class {
        async bytes(): Promise<Uint8Array> { return new Uint8Array(); }
    },
}));

// App-bundled plugin bytes are an unrelated generated build boundary. The
// synchronized test target intentionally has no generated inventory, so keep
// that boundary inert while these Team approval journeys exercise their real
// continuation and screen owners.
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => Object.freeze({
        kind: 'appExact' as const,
        readFile: async () => null,
    }),
    createBundledPluginUiAppExactArtifactSourceFromInventory: () => Object.freeze({
        kind: 'appExact' as const,
        readFile: async () => null,
    }),
}));
vi.mock('@/sync/domains/plugins/availability/reader', () => ({
    createPluginAccountAvailabilityReader: vi.fn(),
    createPluginAccountAvailabilityReaderStore: () => Object.freeze({
        replace: () => null,
        clear: () => null,
        subscribe: () => () => undefined,
        bind: vi.fn(),
    }),
    projectPluginAccountAvailabilityMaterializationIdentity: vi.fn(),
}));

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const TEAM_GET_PATH = '/v1/teams/get';
const ELIGIBILITY_PATH = '/v1/home/governance/eligibility/get';
const ACCOUNT_SEARCH_PATH = '/v1/home/accounts/search';
const INVITATIONS_LIST_PATH = '/v1/teams/invitations/list';

const ARTIFACT_ID = 'approval-team-journey';

/**
 * Exactly what the shared front door throws once it has deferred this intent:
 * the real pending error, carrying a continuation built from the caller's own
 * handlers. The Artifact/Action/Home/Account/input fencing inside a real
 * continuation is owned by `teamActionClient` and proven by its own suite, so
 * only the delivery is reproduced here.
 */
function pendingApproval<TAnswer>(answer: TAnswer) {
    return async (params: Readonly<{
        onApprovalSucceeded?: (value: TAnswer) => void | Promise<void>;
        onApprovalFailed?: (code: string) => void;
    }>): Promise<never> => {
        const { TeamActionApprovalPendingError } = await import('@/sync/ops/teams/teamActionClient');
        throw new TeamActionApprovalPendingError(ARTIFACT_ID, {
            artifactId: ARTIFACT_ID,
            onExecuted: async () => {
                await params.onApprovalSucceeded?.(answer);
                return 'consumed' as const;
            },
            onTerminal: (status) => params.onApprovalFailed?.(`approval_${status}`),
        });
    };
}

/**
 * The decision the approval host would have committed, in the artifact shape the
 * binding actually reads.
 *
 * It is the whole `DecryptedArtifact` rather than the three fields the hook
 * happens to dereference: a partial stand-in would let a reader that checks
 * decryption or versioning silently treat the settled approval as unreadable,
 * which reads as "still waiting" instead of as a broken fixture.
 */
async function settleArtifact(status: 'executed' | 'rejected'): Promise<void> {
    await act(async () => {
        approvalArtifactState.value = {
            artifact: {
                id: ARTIFACT_ID,
                title: null,
                header: { title: null, approvalStatus: status },
                body: '{}',
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                isDecrypted: true,
            },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        for (const listener of approvalArtifactState.listeners) listener();
        // The shared hook releases custody first, then invokes the result
        // continuation from the following effect. Keep that microtask inside
        // this act boundary so its navigation/error state is fully observed.
        await Promise.resolve();
    });
}

type Screen = Awaited<ReturnType<typeof renderScreen>>;

async function waitForTestId(screen: Screen, testID: string): Promise<void> {
    await vi.waitFor(() => {
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(testID);
    });
}

/**
 * Re-renders the surface after the Artifact settled outside React.
 *
 * The decision lands in durable approval state, not in this tree, so something
 * has to bring the surface back to read it. Re-passing the *same* element does
 * not: React compares the child element by identity and bails out of an
 * unchanged subtree, so the screen would never re-run the binding and the
 * journey would look stuck when it is only unrendered. Each call therefore
 * builds the element again.
 */
async function rerender(screen: Screen, build: () => React.ReactElement): Promise<void> {
    await screen.update(build());
}

async function addTeamHome(
    granted: Parameters<typeof teamCapabilitiesFixture>[0],
): Promise<string> {
    const serverId = await harness.addHome({
        name: 'Home A',
        serverUrl: 'https://home-a.example',
        accountId: 'account-ada',
        teamsEnabled: true,
    });
    await harness.selectHomes([serverId]);
    harness.answer(serverId, TEAM_GET_PATH, {
        body: teamSummaryFixture({ capabilities: teamCapabilitiesFixture(granted) }),
    });
    return serverId;
}

/**
 * The reset owners this suite drives, resolved once.
 *
 * They cannot be static imports: the installed boundaries are registered with
 * `vi.doMock`, so anything pulled in at module evaluation would bind the real
 * transport instead. Resolving them here keeps that one-time module-graph cost
 * — which is large enough to exceed the per-hook budget on a cold cache — out
 * of `beforeEach`, where it reads as a hung hook rather than as a slow import.
 */
let resetOwners!: Readonly<{
    resetTeamsSnapshotsForTests: () => void;
    resetTeamsDirectoryEngineForTests: () => void;
    resetTeamActionClientForTests: () => void;
    resetHomeGovernanceEligibilitySnapshotsForTests: () => void;
    resetHomeGovernanceEligibilityEngineForTests: () => void;
    resetHomeGovernanceSnapshotsForTests: () => void;
    resetHomeGovernanceEngineForTests: () => void;
    resetServerFeaturesClientForTests: () => void;
}>;

beforeAll(async () => {
    // Sequentially: these graphs overlap heavily, and resolving them together
    // makes the transform pipeline contend with itself rather than reuse what
    // the previous import already compiled.
    const teamsSnapshots = await import('@/sync/store/teams/teamsSnapshots');
    const teamsDirectoryEngine = await import('@/sync/engine/teams/teamsDirectoryEngine');
    const teamActionClient = await import('@/sync/ops/teams/teamActionClient');
    const eligibilitySnapshots = await import('@/sync/store/home/governance/homeGovernanceEligibilitySnapshots');
    const eligibilityEngine = await import('@/sync/engine/home/governance/homeGovernanceEligibilityEngine');
    const governanceSnapshots = await import('@/sync/store/home/governance/homeGovernanceSnapshots');
    const governanceEngine = await import('@/sync/engine/home/governance/homeGovernanceEngine');
    const serverFeaturesClient = await import('@/sync/api/capabilities/serverFeaturesClient');
    resetOwners = {
        resetTeamsSnapshotsForTests: teamsSnapshots.resetTeamsSnapshotsForTests,
        resetTeamsDirectoryEngineForTests: teamsDirectoryEngine.resetTeamsDirectoryEngineForTests,
        resetTeamActionClientForTests: teamActionClient.resetTeamActionClientForTests,
        resetHomeGovernanceEligibilitySnapshotsForTests:
            eligibilitySnapshots.resetHomeGovernanceEligibilitySnapshotsForTests,
        resetHomeGovernanceEligibilityEngineForTests:
            eligibilityEngine.resetHomeGovernanceEligibilityEngineForTests,
        resetHomeGovernanceSnapshotsForTests: governanceSnapshots.resetHomeGovernanceSnapshotsForTests,
        resetHomeGovernanceEngineForTests: governanceEngine.resetHomeGovernanceEngineForTests,
        resetServerFeaturesClientForTests: serverFeaturesClient.resetServerFeaturesClientForTests,
    };
}, 300_000);

beforeEach(async () => {
    resetOwners.resetTeamsSnapshotsForTests();
    resetOwners.resetTeamsDirectoryEngineForTests();
    resetOwners.resetTeamActionClientForTests();
    resetOwners.resetHomeGovernanceEligibilitySnapshotsForTests();
    resetOwners.resetHomeGovernanceEligibilityEngineForTests();
    resetOwners.resetHomeGovernanceSnapshotsForTests();
    resetOwners.resetHomeGovernanceEngineForTests();
    resetOwners.resetServerFeaturesClientForTests();
    await harness.reset();
    await harness.selectHomes([]);
    routerReplace.mockReset();
    routerPush.mockReset();
    routerBack.mockReset();
    approvalArtifactState.value = { artifact: null, isLoading: false, error: null, invalidArtifact: false };
    approvalArtifactState.requested = [];
    setClipboardStringSafeMock.mockClear();
    deferrals.createTeam = null;
    deferrals.createTeamGroup = null;
    deferrals.addTeamMember = null;
    deferrals.createTeamInvitation = null;
    deferrals.calls = { createTeam: 0, createTeamGroup: 0, addTeamMember: 0, createTeamInvitation: 0 };
});

afterEach(() => {
    standardCleanup();
});

describe('deferred Group creation', () => {
    it('shows the wait, withholds the control, then opens the Group the approval produced', async () => {
        deferrals.createTeamGroup = pendingApproval(
            teamGroupFixture({ id: 'group-new', name: 'Design', memberCount: 0 }),
        ) as never;
        const serverId = await addTeamHome({ manageGroups: true });
        const { TeamGroupCreateScreen } = await import('./groups/TeamGroupCreateScreen');
        const build = () => <TeamGroupCreateScreen serverId={serverId} teamId="team-1" />;
        const screen = await renderScreen(build());
        await waitForTestId(screen, 'team-group-create-name');
        act(() => screen.changeTextByTestId('team-group-create-name', 'Design'));
        await screen.pressByTestIdAsync('team-group-create-submit');

        // The deferral is visible and the control is withheld, so the same
        // creation cannot be asked for a second time while it is undecided.
        await waitForTestId(screen, 'team-approval');
        expect(screen.findByTestId('team-group-create-submit')?.props.disabled).toBe(true);
        expect(routerReplace).not.toHaveBeenCalled();

        await settleArtifact('executed');
        await rerender(screen, build);

        await vi.waitFor(() => {
            expect(routerReplace).toHaveBeenCalledWith(
                `/settings/teams/${serverId}/team-1/groups/group-new`,
            );
        });
        // The Home created the Group when the approval was granted.
        expect(deferrals.calls.createTeamGroup).toBe(1);
    });
});

describe('deferred Team admission', () => {
    async function renderMemberAdd(serverId: string) {
        const { TeamMemberAddScreen } = await import('./members/TeamMemberAddScreen');
        const build = () => <TeamMemberAddScreen serverId={serverId} teamId="team-1" />;
        const screen = await renderScreen(build());
        await waitForTestId(screen, 'team-member-add-search');
        act(() => screen.changeTextByTestId('team-member-add-search', 'Grace'));
        await waitForTestId(screen, 'team-member-add-candidate:account-grace');
        act(() => screen.pressByTestId('team-member-add-candidate:account-grace'));
        return { screen, build };
    }

    it('continues the history journey at the membership an approved admission answered with', async () => {
        deferrals.addTeamMember = pendingApproval(teamMembershipFixture({
            id: 'membership-grace',
            accountId: 'account-grace',
            historyAccess: 'all_existing',
        })) as never;
        const serverId = await addTeamHome({ manageMembers: true });
        harness.answer(serverId, ACCOUNT_SEARCH_PATH, {
            body: { accounts: [homeAccountPickerRowFixture('account-grace', 'Grace')] },
        });
        const { screen, build } = await renderMemberAdd(serverId);

        await waitForTestId(screen, 'team-member-add-history:all_existing');
        act(() => screen.pressByTestId('team-member-add-history:all_existing'));
        await screen.pressByTestIdAsync('team-member-add-submit');

        await waitForTestId(screen, 'team-approval');
        expect(routerReplace).not.toHaveBeenCalled();
        expect(routerBack).not.toHaveBeenCalled();
        // The deferral bound this exact Artifact, so the decision below is the
        // one this surface is waiting on rather than an unrelated request.
        expect(approvalArtifactState.requested).toContain(ARTIFACT_ID);

        await settleArtifact('executed');
        await rerender(screen, build);

        // Including existing history is an instruction, and the membership it
        // is prepared at exists only in the Home's answer.
        await vi.waitFor(() => {
            expect(routerReplace).toHaveBeenCalledWith(
                `/settings/teams/${serverId}/team-1/members/membership-grace?prepareHistory=1`,
            );
        });
        expect(deferrals.calls.addTeamMember).toBe(1);
    });

    it('reports a refused admission instead of navigating as though it happened', async () => {
        deferrals.addTeamMember = pendingApproval(teamMembershipFixture({
            id: 'membership-grace',
            accountId: 'account-grace',
        })) as never;
        const serverId = await addTeamHome({ manageMembers: true });
        harness.answer(serverId, ACCOUNT_SEARCH_PATH, {
            body: { accounts: [homeAccountPickerRowFixture('account-grace', 'Grace')] },
        });
        const { screen, build } = await renderMemberAdd(serverId);
        await screen.pressByTestIdAsync('team-member-add-submit');
        await waitForTestId(screen, 'team-approval');

        await settleArtifact('rejected');
        await rerender(screen, build);

        await vi.waitFor(() => {
            expect(screen.getTextContent()).toContain('teams.errors.forbidden');
        });
        expect(routerReplace).not.toHaveBeenCalled();
        expect(routerBack).not.toHaveBeenCalled();
        expect(deferrals.calls.addTeamMember).toBe(1);
    });
});

describe('live-only invitation custody', () => {
    /**
     * Creation carries a raw bearer, so it is the one Lane 01 journey that must
     * NOT hand its result to a durable continuation. The invocation itself
     * waits, and the surface's mount lifetime is what can cancel that wait — so
     * leaving the screen ends the request instead of leaving a link to be
     * delivered to nobody.
     */
    it('aborts the original live waiter when its initiating surface unmounts', async () => {
        let observedSignal: AbortSignal | null = null;
        let waiterSettled = false;
        deferrals.createTeamInvitation = (async (params: Readonly<{ signal?: AbortSignal }>) => {
            observedSignal = params.signal ?? null;
            try {
                await new Promise<never>((_resolve, reject) => {
                    const signal = params.signal;
                    if (!signal) return;
                    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                    if (signal.aborted) abort();
                    else signal.addEventListener('abort', abort, { once: true });
                });
            } finally {
                waiterSettled = true;
            }
        }) as never;

        const serverId = await addTeamHome({ manageInvitations: true });
        harness.answer(serverId, INVITATIONS_LIST_PATH, {
            body: { items: [], nextCursor: null, emailDelivery: 'unavailable', linkDelivery: 'available' },
        });
        const { TeamInvitationCreateScreen } = await import('./invitations/TeamInvitationCreateScreen');
        const screen = await renderScreen(<TeamInvitationCreateScreen serverId={serverId} teamId="team-1" />);
        await waitForTestId(screen, 'team-invite-submit');

        // The row deliberately starts a void-owned async submission. Keeping an
        // async `act` open around the waiter would overlap the unmount's `act`
        // and could suppress the cleanup this test is meant to observe.
        act(() => screen.pressByTestId('team-invite-submit'));
        await vi.waitFor(() => expect(observedSignal).not.toBeNull());

        await act(async () => screen.tree.unmount());

        expect(observedSignal!.aborted).toBe(true);
        await vi.waitFor(() => expect(waiterSettled).toBe(true));
        expect(deferrals.calls.createTeamInvitation).toBe(1);
    });

    it('binds a bearer-minting creation to the surface lifetime and reveals nothing while it waits', async () => {
        const joinUrl = `https://home-a.example/join/${'a'.repeat(43)}`;
        let observedSignal: AbortSignal | null = null;
        let releaseCreate = (): void => {};
        const decided = new Promise<void>((resolve) => { releaseCreate = resolve; });
        deferrals.createTeamInvitation = (async (params: Readonly<{ signal?: AbortSignal }>) => {
            observedSignal = params.signal ?? null;
            await decided;
            return { kind: 'succeeded' as const, value: { invitation: teamInvitationRowFixture(), joinUrl } };
        }) as never;

        const serverId = await addTeamHome({ manageInvitations: true });
        harness.answer(serverId, INVITATIONS_LIST_PATH, {
            body: { items: [], nextCursor: null, emailDelivery: 'unavailable', linkDelivery: 'available' },
        });
        const { TeamInvitationCreateScreen } = await import('./invitations/TeamInvitationCreateScreen');
        const screen = await renderScreen(<TeamInvitationCreateScreen serverId={serverId} teamId="team-1" />);
        await waitForTestId(screen, 'team-invite-submit');
        // The pending invocation is the custody under test. The row owns it as
        // a void async action, so do not hold an async React `act` open across
        // its whole lifetime; doing so would overlap the later unmount cleanup.
        act(() => screen.pressByTestId('team-invite-submit'));

        await vi.waitFor(() => expect(observedSignal).not.toBeNull());
        // Custody is the live call, not a durable registration, and nothing is
        // revealed while the approval is undecided. The bearer is never rendered
        // as text, so its absence is asserted at the controls that hand it over —
        // a text check would pass even on a fully revealed link.
        expect(observedSignal!.aborted).toBe(false);
        const waitingIds = collectRenderedTestIds(screen.tree.toJSON());
        expect(waitingIds).not.toContain('team-approval');
        expect(waitingIds).not.toContain('team-invite-copy-link');
        expect(waitingIds).not.toContain('team-invite-share-link');
        expect(waitingIds).not.toContain('team-invite-qr');
        expect(setClipboardStringSafeMock).not.toHaveBeenCalled();

        await act(async () => {
            releaseCreate();
            await decided;
        });

        // The one confined delivery reaches the invoking surface, and it is the
        // same presentation an immediate creation gets — the exact minted link,
        // copyable, and asked for exactly once.
        await waitForTestId(screen, 'team-invite-copy-link');
        await screen.pressByTestIdAsync('team-invite-copy-link');
        // The exact minted bearer, handed over once: a link rebuilt locally or a
        // second dispatch would both be invisible to a testID-only assertion.
        expect(setClipboardStringSafeMock).toHaveBeenCalledWith(joinUrl);
        expect(deferrals.calls.createTeamInvitation).toBe(1);

        // Leaving the surface cancels the wait rather than stranding a bearer.
        await act(async () => {
            screen.tree.unmount();
        });
        expect(observedSignal!.aborted).toBe(true);
    });
});

describe('deferred Team creation', () => {
    it('opens the Team the approval produced rather than re-asking for one', async () => {
        deferrals.createTeam = pendingApproval(
            teamSummaryFixture({ id: 'team-new', name: 'Design' }),
        ) as never;
        const serverId = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
            teamsEnabled: true,
        });
        await harness.selectHomes([serverId]);
        harness.answer(serverId, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });

        const { TeamCreateScreen } = await import('./TeamCreateScreen');
        const build = () => <TeamCreateScreen />;
        const screen = await renderScreen(build());
        await waitForTestId(screen, 'teams-create-name');
        act(() => screen.changeTextByTestId('teams-create-name', 'Design'));
        await screen.pressByTestIdAsync('teams-create-submit');

        // A Team being created has no Team shell to host its approval, so this
        // screen owns one: the wait is visible and the form is withheld rather
        // than silently creating a second Team.
        await waitForTestId(screen, 'teams-create-approval');
        expect(screen.findByTestId('teams-create-submit')?.props.disabled).toBe(true);
        expect(routerReplace).not.toHaveBeenCalled();

        await settleArtifact('executed');
        await rerender(screen, build);

        await vi.waitFor(() => {
            expect(routerReplace).toHaveBeenCalledWith(
                `/settings/teams/${serverId}/team-new`,
            );
        });
        expect(deferrals.calls.createTeam).toBe(1);
    });
});
