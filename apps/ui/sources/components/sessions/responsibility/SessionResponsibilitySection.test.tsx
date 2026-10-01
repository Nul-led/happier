import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { act } from 'react-test-renderer';
import { t } from '@/text';
import { ModalProvider } from '@/modal';

vi.mock('@legendapp/list/react-native', async () => {
    const { createCapturingLegendListMock } = await import('@/dev/testkit');
    return { LegendList: createCapturingLegendListMock({ renderItems: true, renderItemLimit: 20 }).module.LegendList };
});

const selectionListProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/components/ui/selectionList', async () => {
    const actual = await vi.importActual<typeof import('@/components/ui/selectionList')>('@/components/ui/selectionList');
    return {
        ...actual,
        SelectionList: (props: React.ComponentProps<typeof actual.SelectionList>) => {
            selectionListProps.current = props;
            return React.createElement(actual.SelectionList, props);
        },
    };
});

// The platform screen-reader live region is a genuine OS/DOM boundary.
const announceAccessibilityMessage = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/accessibility/announceAccessibilityMessage', () => ({
    announceAccessibilityMessage: (message: string) => announceAccessibilityMessage(message),
}));

// Navigation is the router boundary.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({
    useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

const responsibilityApi = vi.hoisted(() => ({
    setSessionResponsibleAccount: vi.fn(),
    listSessionResponsibilityCandidates: vi.fn(),
    readSessionResponsibleAccount: vi.fn(),
}));
const collaborationAvailability = vi.hoisted(() => ({ value: 'available' as string }));
vi.mock('@/hooks/session/useSessionCollaborationAvailability', async () => {
    const actual = await vi.importActual<typeof import('@/hooks/session/useSessionCollaborationAvailability')>('@/hooks/session/useSessionCollaborationAvailability');
    return {
        ...actual,
        useSessionCollaborationAvailability: () => collaborationAvailability.value,
    };
});
const storeState = vi.hoisted(() => ({
    session: null as Record<string, unknown> | null,
    applied: [] as (string | null)[],
    scopedSessionHookCalls: 0,
}));

vi.mock('@/sync/api/session/apiSessionResponsibility', async () => {
    const actual = await vi.importActual<typeof import('@/sync/api/session/apiSessionResponsibility')>(
        '@/sync/api/session/apiSessionResponsibility',
    );
    return {
        ...actual,
        setSessionResponsibleAccount: responsibilityApi.setSessionResponsibleAccount,
        listSessionResponsibilityCandidates: responsibilityApi.listSessionResponsibilityCandidates,
        readSessionResponsibleAccount: responsibilityApi.readSessionResponsibleAccount,
    };
});
vi.mock('@/sync/sync', () => ({
    sync: { getCredentials: () => ({ token: 'test-token', secret: new Uint8Array() }) },
}));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
    useSession: () => storeState.session,
    useSessionListRenderableWithServerScope: () => {
        storeState.scopedSessionHookCalls += 1;
        return storeState.session;
    },
    storage: {
        getState: () => ({
            sessionLocalStateScope: { serverId: 'home-1', accountId: 'account-owner' },
            applySessionResponsibleAccount: (_sessionId: string, value: string | null, _scope: unknown, summary?: { accountId: string; firstName: string | null; lastName: string | null; username: string | null; avatarUrl: string | null } | null) => {
                storeState.applied.push(value);
                storeState.session = { ...(storeState.session ?? {}), responsibleAccountId: value, ...(summary !== undefined ? { responsibleAccount: summary } : {}) };
            },
        }),
    },
    });
});

const scope = { serverId: 'home-1', accountId: 'account-owner' };

import { SessionResponsibilitySection } from './SessionResponsibilitySection';
import { SessionResponsibilityPicker } from './SessionResponsibilityPicker';
import { useSessionResponsibilityController } from './useSessionResponsibilityController';
import { useSessionResponsibilityPickerHost } from './useSessionResponsibilityPickerHost';

function summary(accountId: string, firstName: string | null, username: string | null) {
    return { kind: 'account' as const, accountId, firstName, lastName: null, username, avatarUrl: null };
}

function profile(firstName: string | null, username: string | null) {
    return { firstName, lastName: null, username, avatarUrl: null };
}

function ResponsibilityPickerHarness(
    props: Omit<React.ComponentProps<typeof SessionResponsibilityPicker>, 'controller'>,
) {
    const controller = useSessionResponsibilityController(props.sessionId, props.scope);
    return <SessionResponsibilityPicker {...props} controller={controller} />;
}

/**
 * The Collaboration surface's own wiring of the one controller and one picker
 * host, reduced to the row and the compact step. The surface test owns the
 * proof that the real surface swaps its body for that step; this harness only
 * keeps the row's own contracts reachable.
 */
function MountedResponsibilitySection(props: Readonly<{
    sessionId: string;
    scope: typeof scope;
    actingAccountId: string | null;
    testID?: string;
    onController?: (controller: ReturnType<typeof useSessionResponsibilityController>) => void;
}>) {
    const controller = useSessionResponsibilityController(props.sessionId, props.scope);
    props.onController?.(controller);
    const pickerHost = useSessionResponsibilityPickerHost({
        sessionId: props.sessionId,
        scope: props.scope,
        actingAccountId: props.actingAccountId,
        controller,
        editable: controller.availability === 'editable',
        available: controller.availability === 'editable' || controller.availability === 'read_only',
    });
    return (
        <>
            <SessionResponsibilitySection
                controller={controller}
                pickerHost={pickerHost}
                {...(props.testID === undefined ? {} : { testID: props.testID })}
            />
            {pickerHost.compactStep}
        </>
    );
}

describe('SessionResponsibilitySection', () => {
    beforeEach(() => {
        responsibilityApi.setSessionResponsibleAccount.mockReset();
        responsibilityApi.listSessionResponsibilityCandidates.mockReset();
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [],
            nextCursor: null,
        });
        responsibilityApi.readSessionResponsibleAccount.mockReset();
        collaborationAvailability.value = 'available';
        storeState.session = null;
        storeState.applied = [];
        storeState.scopedSessionHookCalls = 0;
        selectionListProps.current = null;
        announceAccessibilityMessage.mockClear();
    });

    it('reserves a stable section row while the scoped Session has no cached projection', async () => {
        storeState.session = null;
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );
        expect(screen.findByTestId('session-responsibility-loading')).not.toBeNull();
        expect(screen.findByTestId('session-responsibility-row')).toBeNull();
    });

    it('keeps one line saying the Home does not track responsibility, never collapsing or claiming "No one"', async () => {
        storeState.session = { id: 'session-1' };
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );
        expect(screen.findByTestId('session-responsibility-row')).toBeNull();
        expect(screen.findByTestId('session-responsibility-unsupported')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain('No one');
    });

    it('hides the section when Session sharing is unavailable on the Home, never claiming "No one"', async () => {
        collaborationAvailability.value = 'unavailable';
        storeState.session = { id: 'session-1', responsibleAccountId: null, access: { capabilities: { assignResponsibility: true } } };
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );
        expect(screen.findByTestId('session-responsibility-row')).toBeNull();
        expect(screen.getTextContent()).not.toContain('No one');
    });

    it('renders authoritative unassigned responsibility without an editable action for a read-only collaborator', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, accessLevel: 'view' };
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-viewer" />,
        );
        expect(screen.findByTestId('session-responsibility-value')!.props.children).toBe('No one');
        expect(responsibilityApi.listSessionResponsibilityCandidates).not.toHaveBeenCalled();
    });

    it('shows an explicit "No one" for an authoritative unassigned Session', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, access: { capabilities: { assignResponsibility: true } } };
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );
        expect(screen.findByTestId('session-responsibility-row')).toBeTruthy();
        expect(screen.findByTestId('session-responsibility-value')!.props.children).toBe('No one');
    });

    it('loads and selects an eligible person from the next candidate page', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates
            .mockResolvedValueOnce({ candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }], nextCursor: 'next-page' })
            .mockResolvedValueOnce({ candidates: [{ accountId: 'account-alice', profile: profile('Alice', 'alice') }], nextCursor: null });
        responsibilityApi.setSessionResponsibleAccount.mockResolvedValue({ changed: true, responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), autoFollowed: false });
        const resolved = vi.fn();
        const screen = await renderScreen(<ResponsibilityPickerHarness sessionId="session-1" scope={scope} actingAccountId="account-owner" onResolved={resolved} onClose={vi.fn()} />);
        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-picker.list:pagination:more')).not.toBeNull());
        await screen.pressByTestIdAsync('session-responsibility-picker.list:pagination:more');
        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-picker.list:root:option:session-responsibility:account:account-alice')).not.toBeNull());
        await screen.pressByTestIdAsync('session-responsibility-picker.list:root:option:session-responsibility:account:account-alice');
        await vi.waitFor(() => expect(resolved).toHaveBeenCalled());
        expect(storeState.applied).toEqual(['account-alice']);
    });

    it('announces a committed responsibility change and never the value already on screen', async () => {
        storeState.session = {
            id: 'session-1', responsibleAccountId: null, responsibleAccount: null,
            access: { capabilities: { assignResponsibility: true } },
        };
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );
        // Arriving on a Session that already has an assignee is not a change.
        expect(announceAccessibilityMessage).not.toHaveBeenCalled();

        storeState.session = {
            ...storeState.session,
            responsibleAccountId: 'account-bob',
            responsibleAccount: summary('account-bob', 'Bob', 'bob'),
        };
        await screen.update(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );

        // A quiet subtitle a screen reader has already passed must still reach it.
        await vi.waitFor(() => expect(announceAccessibilityMessage)
            .toHaveBeenCalledWith(t('session.responsibilityA11yReadOnly', { name: 'Bob' })));
    });

    it('keeps the opened production modal subscribed to candidate, projection, and capability updates', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        let resolveCandidates!: (value: {
            candidates: Array<{ accountId: string; profile: ReturnType<typeof profile> }>;
            nextCursor: null;
        }) => void;
        responsibilityApi.listSessionResponsibilityCandidates.mockReturnValue(new Promise((resolve) => {
            resolveCandidates = resolve;
        }));

        const screen = await renderScreen(
            <ModalProvider>
                <MountedResponsibilitySection
                    sessionId="session-1"
                    scope={scope}
                    actingAccountId="account-owner"
                />
            </ModalProvider>,
        );

        await screen.pressByTestIdAsync('session-responsibility-row');
        await vi.waitFor(() => {
            expect(responsibilityApi.listSessionResponsibilityCandidates).toHaveBeenCalledTimes(1);
            expect(screen.findByTestId('session-responsibility-picker')).not.toBeNull();
        });

        await act(async () => {
            resolveCandidates({
                candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
                nextCursor: null,
            });
            await Promise.resolve();
        });

        await vi.waitFor(() => {
            expect(screen.findByTestId(
                'session-responsibility-picker.list:root:option:session-responsibility:account:account-bob',
            )).not.toBeNull();
        });

        storeState.session = {
            ...storeState.session,
            responsibleAccountId: 'account-bob',
            responsibleAccount: summary('account-bob', 'Bob', 'bob'),
        };
        await screen.update(
            <ModalProvider>
                <MountedResponsibilitySection
                    sessionId="session-1"
                    scope={scope}
                    actingAccountId="account-owner"
                />
            </ModalProvider>,
        );
        await vi.waitFor(() => {
            expect(selectionListProps.current?.selectedOptionId)
                .toBe('session-responsibility:account:account-bob');
        });

        storeState.session = {
            ...storeState.session,
            access: { capabilities: { assignResponsibility: false } },
        };
        await screen.update(
            <ModalProvider>
                <MountedResponsibilitySection
                    sessionId="session-1"
                    scope={scope}
                    actingAccountId="account-owner"
                />
            </ModalProvider>,
        );
        await vi.waitFor(() => {
            expect(screen.findByTestId('session-responsibility-picker-error')?.props.children)
                .toBe(t('session.responsibilityAccessChanged'));
            expect(screen.findByTestId(
                'session-responsibility-picker.list:root:option:session-responsibility:account:account-bob',
            )).toBeNull();
        });
    });

    it('propagates pending and typed authentication failure into the opened production modal and clears identities', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        let rejectMutation!: (error: unknown) => void;
        responsibilityApi.setSessionResponsibleAccount.mockReturnValue(new Promise((_resolve, reject) => {
            rejectMutation = reject;
        }));

        const screen = await renderScreen(
            <ModalProvider>
                <MountedResponsibilitySection
                    sessionId="session-1"
                    scope={scope}
                    actingAccountId="account-owner"
                />
            </ModalProvider>,
        );
        await screen.pressByTestIdAsync('session-responsibility-row');
        const bobOptionId = 'session-responsibility-picker.list:root:option:session-responsibility:account:account-bob';
        await vi.waitFor(() => expect(screen.findByTestId(bobOptionId)).not.toBeNull());

        await screen.pressByTestIdAsync(bobOptionId);
        await vi.waitFor(() => expect(screen.findByTestId(bobOptionId)?.props.accessibilityState)
            .toMatchObject({ disabled: true }));

        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        await act(async () => {
            rejectMutation(new SessionResponsibilityError('session_access_authentication_unavailable'));
            await Promise.resolve();
        });
        await vi.waitFor(() => {
            expect(screen.findByTestId('session-responsibility-picker-error')?.props.children)
                .toBe(t('session.access.authenticationUnavailable'));
            expect(screen.findByTestId(bobOptionId)).toBeNull();
        });
    });

    it('offers Assign to me even when self is absent from candidate page one', async () => {
        // Revision-13: fixed canonical-self option never waits for page-one membership.
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        responsibilityApi.setSessionResponsibleAccount.mockResolvedValue({ changed: true, responsibleAccountId: 'account-owner', responsibleAccount: summary('account-owner', 'Owner', 'owner'), autoFollowed: false });
        const resolved = vi.fn();
        const screen = await renderScreen(<ResponsibilityPickerHarness sessionId="session-1" scope={scope} actingAccountId="account-owner" onResolved={resolved} onClose={vi.fn()} />);
        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-picker.list:root:option:session-responsibility:account:account-owner:self')).not.toBeNull());
        await screen.pressByTestIdAsync('session-responsibility-picker.list:root:option:session-responsibility:account:account-owner:self');
        await vi.waitFor(() => expect(resolved).toHaveBeenCalled());
        expect(responsibilityApi.setSessionResponsibleAccount).toHaveBeenCalledWith(
            scope,
            { sessionId: 'session-1', responsibleAccountId: 'account-owner' },
            expect.anything(),
        );
    });

    it('shares one controller between section and picker with no duplicate candidate owner', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        const { useSessionResponsibilityController: useController } = await import('./useSessionResponsibilityController');
        let shared: ReturnType<typeof useController> | null = null;
        function Host(props: Readonly<{ onReady: (c: ReturnType<typeof useController>) => void }>) {
            const c = useController('session-1', scope);
            props.onReady(c);
            return null;
        }
        await renderScreen(<Host onReady={(c) => { shared = c; }} />);
        expect(shared).not.toBeNull();
        const ownerHookCalls = storeState.scopedSessionHookCalls;
        const resolved = vi.fn();
        const screen = await renderScreen(
            <SessionResponsibilityPicker sessionId="session-1" scope={scope} actingAccountId="account-owner" controller={shared!} onResolved={resolved} onClose={vi.fn()} />,
        );
        expect(screen.findByTestId('session-responsibility-picker')).not.toBeNull();
        // The picker starts the shared controller's initial page; it does not
        // create a second scoped controller or duplicate the request.
        expect(responsibilityApi.listSessionResponsibilityCandidates).toHaveBeenCalledTimes(1);
        // Starting the shared controller's candidate request re-renders its
        // existing host once. A picker-owned controller would add another
        // hook invocation on top of that render.
        expect(storeState.scopedSessionHookCalls).toBe(ownerHookCalls + 1);
    });

    it('routes SelectionList close requests through the modal close owner', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, access: { capabilities: { assignResponsibility: true } } };
        const onClose = vi.fn();
        const screen = await renderScreen(
            <ResponsibilityPickerHarness
                sessionId="session-1"
                scope={scope}
                actingAccountId="account-owner"
                onResolved={vi.fn()}
                onClose={onClose}
            />,
        );

        const onRequestClose = selectionListProps.current?.onRequestClose;
        expect(onRequestClose).toEqual(expect.any(Function));
        (onRequestClose as () => void)();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resolves the assignee name from the canonical Session projection without loading candidates', async () => {
        // Revision-13: the safe current assignee remains visible independently of
        // candidate failure. Candidate query failure cannot erase the display.
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockRejectedValue(new Error('candidate transport failed'));
        const screen = await renderScreen(
            <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />,
        );
        await vi.waitFor(() => {
            expect(screen.findByTestId('session-responsibility-value')!.props.children).toBe('Alice');
        });
    });

    it('presents shared Team authentication remediation when candidate loading is unavailable', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.listSessionResponsibilityCandidates.mockRejectedValue(
            new SessionResponsibilityError('session_access_authentication_unavailable'),
        );
        const screen = await renderScreen(
            <ResponsibilityPickerHarness sessionId="session-1" scope={scope} actingAccountId="account-owner" onResolved={vi.fn()} onClose={vi.fn()} />,
        );

        await vi.waitFor(() => {
            expect(screen.findByTestId('session-responsibility-picker-error')?.props.children)
                .toBe(t('session.access.authenticationUnavailable'));
        });
    });
});

// The assignment that awaits its default confirmation runs on the real approval
// lifecycle in `SessionResponsibilitySection.approval.test.tsx`.

describe('useSessionResponsibilityController', () => {
    beforeEach(() => {
        responsibilityApi.setSessionResponsibleAccount.mockReset();
        responsibilityApi.listSessionResponsibilityCandidates.mockReset();
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [],
            nextCursor: null,
        });
        responsibilityApi.readSessionResponsibleAccount.mockReset();
        collaborationAvailability.value = 'available';
        storeState.session = null;
        storeState.applied = [];
        storeState.scopedSessionHookCalls = 0;
    });

    function Probe(props: Readonly<{ onReady: (controller: ReturnType<typeof useSessionResponsibilityController>) => void }>) {
        const controller = useSessionResponsibilityController('session-1', scope);
        props.onReady(controller);
        return null;
    }

    it('never attributes a previous assignee summary to a newly projected account id', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        const screen = await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await vi.waitFor(() => expect(latest!.responsibleAccount?.accountId).toBe('account-alice'));

        // A legacy/id-only transition cannot safely name the new principal.
        // Keep the id authoritative, but never pair it with the previous name.
        storeState.session = { ...storeState.session, responsibleAccountId: 'account-bob', responsibleAccount: undefined };
        await screen.update(<Probe onReady={(controller) => { latest = controller; }} />);

        expect(latest!.responsibleAccountId).toBe('account-bob');
        expect(latest!.responsibleAccount).toBeNull();
    });

    it('applies the authoritative server value and never a locally guessed one', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.setSessionResponsibleAccount.mockResolvedValue({ changed: true, responsibleAccountId: 'account-bob', responsibleAccount: summary('account-bob', 'Bob', 'bob'), autoFollowed: false });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        let applied = false;
        await act(async () => { applied = await latest!.setResponsibleAccount('account-bob'); });
        expect(applied).toBe(true);
        expect(storeState.applied).toEqual(['account-bob']);
    });

    it('shows the localized assignment explanation only to a self-assignee whose committed transition auto-followed', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.setSessionResponsibleAccount.mockResolvedValue({
            changed: true,
            responsibleAccountId: 'account-owner',
            responsibleAccount: summary('account-owner', 'Owner', 'owner'),
            autoFollowed: true,
        });
        const screen = await renderScreen(
            <ModalProvider>
                <MountedResponsibilitySection sessionId="session-1" scope={scope} actingAccountId="account-owner" />
            </ModalProvider>,
        );
        await screen.pressByTestIdAsync('session-responsibility-row');
        await vi.waitFor(() => expect(screen.findByTestId('session-responsibility-picker')).not.toBeNull());
        await screen.pressByTestIdAsync('session-responsibility-picker.list:root:option:session-responsibility:account:account-owner:self');
        await vi.waitFor(() => {
            expect(screen.findByTestId('session-responsibility-auto-follow-explanation')?.props.children)
                .toBe(t('session.follow.assignedExplanation'));
        });
    });

    it('does not show another assignee\'s auto-Follow explanation to the assigning actor', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.setSessionResponsibleAccount.mockResolvedValue({
            changed: true,
            responsibleAccountId: 'account-bob',
            responsibleAccount: summary('account-bob', 'Bob', 'bob'),
            autoFollowed: true,
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        const screen = await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        await act(async () => {
            expect(await latest!.setResponsibleAccount('account-bob')).toBe(true);
        });

        expect(screen.findByTestId('session-responsibility-auto-follow-explanation')).toBeNull();
    });

    it('admits only one mutation while the accepted value remains visible', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        type MutationResponse = {
            changed: true;
            responsibleAccountId: string;
            responsibleAccount: ReturnType<typeof summary>;
            autoFollowed: false;
        };
        let resolveMutation!: (value: MutationResponse) => void;
        const response = new Promise<MutationResponse>((resolve) => {
            resolveMutation = resolve;
        });
        responsibilityApi.setSessionResponsibleAccount.mockReturnValue(response);
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        act(() => {
            first = latest!.setResponsibleAccount('account-bob');
            second = latest!.setResponsibleAccount('account-bob');
        });
        expect(responsibilityApi.setSessionResponsibleAccount).toHaveBeenCalledTimes(1);
        expect(await second).toBe(false);
        expect(storeState.session?.responsibleAccountId).toBe('account-alice');

        resolveMutation({
            changed: true,
            responsibleAccountId: 'account-bob',
            responsibleAccount: summary('account-bob', 'Bob', 'bob'),
            autoFollowed: false,
        });
        await act(async () => { expect(await first).toBe(true); });
    });

    it('keeps the last accepted value and surfaces the typed conflict when access changed', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.setSessionResponsibleAccount.mockRejectedValue(
            new SessionResponsibilityError('assignee-unavailable'),
        );
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        let applied = false;
        await act(async () => { applied = await latest!.setResponsibleAccount('account-bob'); });
        expect(applied).toBe(false);
        expect(storeState.applied).toEqual([]);
        expect(storeState.session?.responsibleAccountId).toBe('account-alice');
        await vi.waitFor(() => {
            expect(latest!.failure).toBe('assignee-unavailable');
        });
    });

    it('retains a canonical Team authentication failure without reconciling a rejected mutation', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.setSessionResponsibleAccount.mockRejectedValue(
            new SessionResponsibilityError('session_access_authentication_required'),
        );
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await act(async () => { await latest!.loadCandidates(); });
        expect(latest!.candidates.candidates).toHaveLength(1);

        await act(async () => { expect(await latest!.setResponsibleAccount('account-bob')).toBe(false); });

        expect(latest!.failure).toBe('session_access_authentication_required');
        expect(responsibilityApi.readSessionResponsibleAccount).not.toHaveBeenCalled();
        expect(storeState.applied).toEqual([]);
        expect(latest!.candidates.candidates).toEqual([]);
    });

    it('clears private candidates when assignment capability is lost while mounted', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        const screen = await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        await act(async () => { await latest!.loadCandidates(); });
        expect(latest!.candidates.candidates).toHaveLength(1);

        storeState.session = { ...storeState.session, access: { capabilities: { assignResponsibility: false } } };
        await screen.update(<Probe onReady={(controller) => { latest = controller; }} />);
        await vi.waitFor(() => {
            expect(latest!.availability).toBe('read_only');
            expect(latest!.candidates.candidates).toEqual([]);
        });
    });

    it('clears previously loaded candidate identities when Team authentication becomes unavailable', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValueOnce({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        await act(async () => { await latest!.loadCandidates(); });
        expect(latest!.candidates.candidates).toHaveLength(1);

        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.listSessionResponsibilityCandidates.mockRejectedValueOnce(
            new SessionResponsibilityError('session_access_authentication_unavailable'),
        );
        await act(async () => { await latest!.loadCandidates(); });

        expect(latest!.failure).toBe('session_access_authentication_unavailable');
        expect(latest!.candidates.candidates).toEqual([]);
    });

    it('stops offering assignment and drops disclosed candidates after a proven denial', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.setSessionResponsibleAccount.mockRejectedValue(
            new SessionResponsibilityError('forbidden'),
        );
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await act(async () => { await latest!.loadCandidates(); });
        expect(latest!.candidates.candidates).toHaveLength(1);

        await act(async () => { expect(await latest!.setResponsibleAccount('account-bob')).toBe(false); });

        await vi.waitFor(() => {
            expect(latest!.failure).toBe('forbidden');
            // The Home just proved this Account may not assign; the cached
            // projection is the stale answer, so the control closes.
            expect(latest!.availability).toBe('read_only');
            expect(latest!.candidates.candidates).toEqual([]);
        });
        // No candidate page is re-requested under a disclosure basis the Home refused.
        expect(responsibilityApi.listSessionResponsibilityCandidates).toHaveBeenCalledTimes(1);
        expect(responsibilityApi.readSessionResponsibleAccount).not.toHaveBeenCalled();
    });

    it('drops disclosed candidates when the candidate page itself is refused', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValueOnce({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await act(async () => { await latest!.loadCandidates(); });
        expect(latest!.candidates.candidates).toHaveLength(1);

        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.listSessionResponsibilityCandidates.mockRejectedValueOnce(
            new SessionResponsibilityError('forbidden'),
        );
        await act(async () => { await latest!.loadCandidates(); });

        await vi.waitFor(() => {
            expect(latest!.failure).toBe('forbidden');
            expect(latest!.candidates.candidates).toEqual([]);
            expect(latest!.availability).toBe('read_only');
        });
    });

    // The exact typed 404 is final loss of Session read: the Home proved the
    // disclosure basis is gone, exactly as a `forbidden` does.
    it('withdraws candidates and the control on a definitive not-found from a page or a mutation', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValue({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.setSessionResponsibleAccount.mockRejectedValue(new SessionResponsibilityError('not-found'));
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await act(async () => { await latest!.loadCandidates(); });
        expect(latest!.candidates.candidates).toHaveLength(1);

        await act(async () => { expect(await latest!.setResponsibleAccount('account-bob')).toBe(false); });
        await vi.waitFor(() => {
            expect(latest!.failure).toBe('not-found');
            expect(latest!.availability).toBe('read_only');
            expect(latest!.candidates.candidates).toEqual([]);
        });
        expect(responsibilityApi.readSessionResponsibleAccount).not.toHaveBeenCalled();
    });

    it('withdraws candidates when the candidate page answers a definitive not-found', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValueOnce({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await act(async () => { await latest!.loadCandidates(); });
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.listSessionResponsibilityCandidates.mockRejectedValueOnce(new SessionResponsibilityError('not-found'));
        await act(async () => { await latest!.loadCandidates({ query: 'b' }); });
        await vi.waitFor(() => {
            expect(latest!.candidates.candidates).toEqual([]);
            expect(latest!.availability).toBe('read_only');
        });
    });

    it('keeps last-good candidate rows for an unproven transport failure', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: null, responsibleAccount: null, access: { capabilities: { assignResponsibility: true } } };
        responsibilityApi.listSessionResponsibilityCandidates.mockResolvedValueOnce({
            candidates: [{ accountId: 'account-bob', profile: profile('Bob', 'bob') }],
            nextCursor: null,
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);
        await act(async () => { await latest!.loadCandidates(); });

        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.listSessionResponsibilityCandidates.mockRejectedValueOnce(
            new SessionResponsibilityError('unknown'),
        );
        await act(async () => { await latest!.loadCandidates(); });

        expect(latest!.candidates.candidates).toHaveLength(1);
        expect(latest!.candidates.failed).toBe(true);
        expect(latest!.availability).toBe('editable');
    });

    it('reconciles an unknown mutation outcome from the exact Home before retry', async () => {
        storeState.session = { id: 'session-1', responsibleAccountId: 'account-alice', responsibleAccount: summary('account-alice', 'Alice', 'alice'), access: { capabilities: { assignResponsibility: true } } };
        const { SessionResponsibilityError } = await import('@/sync/api/session/apiSessionResponsibility');
        responsibilityApi.setSessionResponsibleAccount.mockRejectedValue(
            new SessionResponsibilityError('unknown'),
        );
        responsibilityApi.readSessionResponsibleAccount.mockResolvedValue({
            responsibleAccountId: 'account-bob',
            responsibleAccount: summary('account-bob', 'Bob', 'bob'),
        });
        let latest: ReturnType<typeof useSessionResponsibilityController> | null = null;
        await renderScreen(<Probe onReady={(controller) => { latest = controller; }} />);

        await act(async () => { await latest!.setResponsibleAccount('account-bob'); });

        expect(responsibilityApi.readSessionResponsibleAccount).toHaveBeenCalledWith(
            scope,
            'session-1',
            expect.anything(),
        );
        expect(storeState.applied).toEqual(['account-bob']);
        await vi.waitFor(() => expect(latest!.failure).toBe('unknown'));
    });
});
