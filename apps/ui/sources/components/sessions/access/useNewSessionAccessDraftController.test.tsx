import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import type { SessionInitialAccessDraftV1 } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { reconcileSessionAccessDraftForHome } from '@/sync/domains/session/access/sessionAccessDraftReconciliation';

import { useNewSessionAccessDraftController } from './useNewSessionAccessDraftController';
import { useNewSessionAccessDraft, type NewSessionAccessDraftState } from './useNewSessionAccessDraft';
import type { SessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import type { SessionAccessCandidateRowModel } from './sessionAccessEditorTypes';

vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());

// Directory sources are the network boundary; the draft owner below stays real.
const runTeamActionMock = vi.hoisted(() => vi.fn(async () => ({
    kind: 'failed' as const,
    failure: { kind: 'unreachable' as const, retryable: true, code: null },
})));
vi.mock('@/sync/ops/teams/teamActionClient', () => ({
    runTeamAction: runTeamActionMock,
}));
vi.mock('@/sync/api/session/sessionAccessLegacyAdapter', () => ({ searchSessionAccessAccounts: vi.fn(async () => []) }));
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeResolution: (serverId: string | null) => serverId
        ? { kind: 'bound', scope: { serverId, accountId: 'creator' } }
        : { kind: 'unbound' },
}));
vi.mock('@/hooks/session/useSessionCollaborationAvailability', () => ({
    useSessionCollaborationAvailability: () => 'full_collaboration',
}));
// This suite exercises the real draft/currentness and editor-controller
// owners. Keep their presentation leaf inert so unrelated Markdown/plugin
// renderer graphs are not part of this owner-level test.
vi.mock('./SessionAccessEditor', () => ({ SessionAccessEditor: 'SessionAccessEditor' }));

const scope = { serverId: 'home-one', accountId: 'creator' };

describe('reconcileSessionAccessDraftForHome', () => {
    const access: SessionInitialAccessDraftV1 = {
        grants: [{ subject: { kind: 'account', accountId: 'alice' }, accessLevel: 'view', canApprovePermissions: false }],
    };

    it('keeps the draft while the target Home is unchanged', () => {
        expect(reconcileSessionAccessDraftForHome({ access, previousServerId: 'home-one', nextServerId: 'home-one' }))
            .toEqual({ access, removedCount: 0, changed: false });
    });

    it('drops Home-local principals the new Home cannot address and reports the change', () => {
        expect(reconcileSessionAccessDraftForHome({ access, previousServerId: 'home-one', nextServerId: 'home-two' }))
            .toEqual({ access: null, removedCount: 1, changed: true });
    });
});

type Controller = ReturnType<typeof useNewSessionAccessDraftController>;

function Probe(props: Readonly<{
    initial: SessionInitialAccessDraftV1 | null;
    initialPrimaryTeamId?: string | null;
    homeReconciled?: boolean;
    availability: SessionCollaborationAvailability;
    onReady: (controller: Controller, access: SessionInitialAccessDraftV1 | null, primaryTeamId: string | null) => void;
}>) {
    const [access, setAccess] = React.useState(props.initial);
    const [primaryTeamId, setPrimaryTeamId] = React.useState<string | null>(props.initialPrimaryTeamId ?? null);
    const controller = useNewSessionAccessDraftController({
        scope, access, primaryTeamId, availability: props.availability,
        homeReconciled: props.homeReconciled === true,
        onChange: setAccess, onPrimaryTeamIdChange: setPrimaryTeamId,
    });
    props.onReady(controller, access, primaryTeamId);
    return null;
}

describe('useNewSessionAccessDraftController', () => {
    it('surfaces a Home-change reconciliation instead of silently dropping access choices', async () => {
        let latest: Controller | null = null;
        await renderScreen(<Probe initial={null} availability="full_collaboration" homeReconciled
            onReady={(controller) => { latest = controller; }} />);

        expect(latest!.model.notice).toMatchObject({
            reason: { code: 'session_access_home_reconciled' },
        });
    });

    it('edits only the synchronized creation draft and removes a draft row without acknowledgement', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'acme', name: 'Acme',
                policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = null;
        // Read through a typed accessor so the assertions keep the draft's real
        // union instead of the `null` its initializer narrows to.
        const readDraft = (): SessionInitialAccessDraftV1 | null => draft;
        await renderScreen(<Probe initial={null} availability="full_collaboration" onReady={(controller, access) => { latest = controller; draft = access; }} />);

        await act(async () => { latest!.actions.addPrincipal({ kind: 'account', accountId: 'alice' }); });
        expect(draft).toEqual({
            grants: [{ subject: { kind: 'account', accountId: 'alice' }, accessLevel: 'view', canApprovePermissions: false }],
        });
        expect(latest!.model.grants).toHaveLength(1);
        expect(latest!.model.accessMode).toBe('editable');

        await vi.waitFor(() => expect(latest!.model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'acme' }),
        ])));
        await act(async () => { latest!.actions.setContext('acme'); });
        expect(latest!.model.context?.primaryTeamId).toBe('acme');

        await act(async () => { latest!.actions.setAccessLevel({ kind: 'account', accountId: 'alice' }, 'admin'); });
        expect(readDraft()?.grants[0]?.accessLevel).toBe('admin');

        await act(async () => { latest!.actions.setPermissionDelegation({ kind: 'account', accountId: 'alice' }, true); });
        expect(readDraft()?.grants[0]?.canApprovePermissions).toBe(true);

        // Selecting View clears delegation through the same draft projection.
        await act(async () => { latest!.actions.setAccessLevel({ kind: 'account', accountId: 'alice' }, 'view'); });
        expect(readDraft()?.grants[0]).toEqual({
            subject: { kind: 'account', accountId: 'alice' }, accessLevel: 'view', canApprovePermissions: false,
        });

        // A draft row is local, so removal is immediate rather than two-step.
        await act(async () => { latest!.actions.requestRemove({ kind: 'account', accountId: 'alice' }); });
        expect(draft).toBeNull();
        expect(latest!.model.grants).toHaveLength(0);
    });

    it('refuses to author access on a Home without the collaboration vertical and explains why', async () => {
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = null;
        const seeded: SessionInitialAccessDraftV1 = {
            grants: [{ subject: { kind: 'team', teamId: 'acme' }, accessLevel: 'view', canApprovePermissions: false }],
        };
        await renderScreen(<Probe initial={seeded} availability="direct_only" onReady={(controller, access) => { latest = controller; draft = access; }} />);

        expect(latest!.model.accessMode).toBe('read_only');
        expect(latest!.model.notice?.message).toBeTruthy();
        expect(latest!.model.directory.sections).toHaveLength(0);

        await act(async () => { latest!.actions.addPrincipal({ kind: 'account', accountId: 'alice' }); });
        expect(draft).toEqual(seeded);

        await act(async () => { latest!.actions.clearAccess(); });
        expect(draft).toBeNull();
        expect(latest!.model.context?.primaryTeamId).toBeNull();
    });

    it('discovers Groups from member Teams that are not already present in the access draft', async () => {
        runTeamActionMock
            .mockResolvedValueOnce({
                kind: 'succeeded', value: { items: [{
                    id: 'team-new', name: 'New Team',
                    policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
                }], nextCursor: null },
            } as never)
            .mockResolvedValueOnce({
                kind: 'succeeded',
                value: { items: [{ id: 'group-new', teamId: 'team-new', name: 'New Group' }], nextCursor: null },
            } as never);
        let latest: Controller | null = null;
        await renderScreen(<Probe
            initial={null}
            availability="full_collaboration"
            onReady={(controller) => { latest = controller; }}
        />);
        const groups = latest!.model.directory.sections.find((section) => section.kind === 'group');
        expect(groups).toBeDefined();
        let candidates: readonly SessionAccessCandidateRowModel[] = [];
        await act(async () => {
            candidates = await groups!.resolveCandidates!('', new AbortController().signal);
        });
        expect(candidates.map((candidate) => candidate.principal.ref)).toEqual([
            { kind: 'group', teamId: 'team-new', groupId: 'group-new' },
        ]);
    });

    it('offers an ungranted Team and applies its required floor only after reviewed confirmation', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-required', name: 'Required Team',
                policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'team_admins_only' },
            }], nextCursor: null },
        } as never);
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = null;
        await renderScreen(<Probe initial={null} availability="full_collaboration" onReady={(controller, access) => {
            latest = controller;
            draft = access;
        }} />);

        await vi.waitFor(() => expect(latest!.model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-required', label: 'Required Team' }),
        ])));
        await act(async () => { latest!.actions.setContext('team-required'); });
        expect(latest!.model.context?.confirmation?.consequences).toHaveLength(2);
        expect(latest!.model.context?.primaryTeamId).toBeNull();
        expect(draft).toBeNull();

        await act(async () => { latest!.actions.confirmContext(); });
        expect(latest!.model.context?.primaryTeamId).toBe('team-required');
        expect(draft).toEqual({ grants: [{
            subject: { kind: 'team', teamId: 'team-required' },
            accessLevel: 'edit',
            canApprovePermissions: false,
        }] });
    });

    it('derives the required Team floor for a restored context, not only an in-editor change', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-required', name: 'Required Team',
                policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = null;
        // A restored draft carries the Team context without ever passing through
        // the in-editor context change that used to be the only seed.
        await renderScreen(<Probe initial={null} initialPrimaryTeamId="team-required" availability="full_collaboration"
            onReady={(controller, access) => { latest = controller; draft = access; }} />);

        await vi.waitFor(() => expect(latest!.model.grants).toHaveLength(1));
        expect(draft).toEqual({ grants: [{
            subject: { kind: 'team', teamId: 'team-required' }, accessLevel: 'edit', canApprovePermissions: false,
        }] });
        expect(latest!.model.grants[0]).toMatchObject({
            requiredByTeamPolicy: true, removal: { kind: 'blocked' },
        });
    });

    it('raises a Team-credential visibility grant to the required Edit floor instead of locking View', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-required', name: 'Required Team',
                policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        const credentialSeeded: SessionInitialAccessDraftV1 = { grants: [{
            subject: { kind: 'team', teamId: 'team-required' }, accessLevel: 'view', canApprovePermissions: false,
        }] };
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = credentialSeeded;
        await renderScreen(<Probe initial={credentialSeeded} initialPrimaryTeamId="team-required" availability="full_collaboration"
            onReady={(controller, access) => { latest = controller; draft = access; }} />);

        await vi.waitFor(() => expect(draft?.grants[0]?.accessLevel).toBe('edit'));
        expect(latest!.model.grants[0]).toMatchObject({ requiredByTeamPolicy: true });
        expect(latest!.model.grants[0]?.level.value).toBe('edit');
    });

    it('does not revive a removed team_default row when the same draft is restored', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-default', name: 'Default Team',
                policy: { sessionCreationPolicy: 'team_default', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = null;
        await renderScreen(<Probe initial={null} initialPrimaryTeamId="team-default" availability="full_collaboration"
            onReady={(controller, access) => { latest = controller; draft = access; }} />);

        await vi.waitFor(() => expect(latest!.model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-default' }),
        ])));
        expect(draft).toBeNull();
        expect(latest!.model.grants).toHaveLength(0);
    });

    it('proposes Edit access for a team_default context but preserves an explicit private override', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-default', name: 'Default Team',
                policy: { sessionCreationPolicy: 'team_default', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        let latest: Controller | null = null;
        let draft: SessionInitialAccessDraftV1 | null = null;
        let primaryTeamId: string | null = null;
        await renderScreen(<Probe initial={null} availability="full_collaboration" onReady={(controller, access, teamId) => {
            latest = controller;
            draft = access;
            primaryTeamId = teamId;
        }} />);

        await vi.waitFor(() => expect(latest!.model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-default', label: 'Default Team' }),
        ])));
        await act(async () => { latest!.actions.setContext('team-default'); });

        expect(primaryTeamId).toBe('team-default');
        expect(draft).toEqual({ grants: [{
            subject: { kind: 'team', teamId: 'team-default' },
            accessLevel: 'edit',
            canApprovePermissions: false,
        }] });
        expect(latest!.model.grants[0]?.removal.kind).toBe('allowed');

        await act(async () => { latest!.actions.requestRemove({ kind: 'team', teamId: 'team-default' }); });
        expect(draft).toBeNull();
        expect(primaryTeamId).toBe('team-default');
        expect(latest!.model.context?.primaryTeamId).toBe('team-default');
    });

    it('keeps Team context choices on the canonical Team cursor as more candidates load', async () => {
        runTeamActionMock
            .mockResolvedValueOnce({
                kind: 'succeeded', value: { items: [{
                    id: 'team-first', name: 'First Team',
                    policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
                }], nextCursor: 'team-page-two' },
            } as never)
            .mockResolvedValueOnce({
                kind: 'succeeded', value: { items: [{
                    id: 'team-second', name: 'Second Team',
                    policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
                }], nextCursor: null },
            } as never);
        let latest: Controller | null = null;
        await renderScreen(<Probe initial={null} availability="full_collaboration" onReady={(controller) => { latest = controller; }} />);
        await vi.waitFor(() => expect(latest!.model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-first' }),
        ])));

        await act(async () => { latest!.actions.loadMore('team'); });
        await vi.waitFor(() => expect(latest!.model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-second' }),
        ])));
        expect(runTeamActionMock.mock.calls.at(-1)?.[0].input).toMatchObject({ cursor: 'team-page-two' });
    });

    it('surfaces a blocked draft choice instead of leaving its explanation control inert', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-required', name: 'Required Team',
                policy: { sessionCreationPolicy: 'team_required', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        const seeded: SessionInitialAccessDraftV1 = { grants: [{
            subject: { kind: 'team', teamId: 'team-required' }, accessLevel: 'edit', canApprovePermissions: false,
        }] };
        let latest: Controller | null = null;
        await renderScreen(<Probe initial={seeded} initialPrimaryTeamId="team-required" availability="full_collaboration"
            onReady={(controller) => { latest = controller; }} />);
        await vi.waitFor(() => expect(latest!.model.context?.options[0]?.blockedReason).toBeDefined());

        const reason = latest!.model.context!.options[0]!.blockedReason!;
        act(() => { latest!.actions.explain(reason); });

        expect(latest!.model.notice).toMatchObject({ message: reason.message, reason });
    });
});

function AccessDraftProbe(props: Readonly<{
    serverId: string;
    sourceRevision: number;
    sourceAccess: SessionInitialAccessDraftV1 | null;
    sourcePrimaryTeamId: string | null;
    sourceAccessConflict?: boolean;
    sourcePrimaryTeamConflict?: boolean;
    useScreenHost?: boolean;
    onReady: (state: NewSessionAccessDraftState) => void;
}>) {
    const state = useNewSessionAccessDraft({
        targetServerId: props.serverId,
        initialAccess: props.sourceAccess,
        initialPrimaryTeamId: props.sourcePrimaryTeamId,
        sourceRevision: props.sourceRevision,
        sourceAccessConflict: props.sourceAccessConflict ?? false,
        sourcePrimaryTeamConflict: props.sourcePrimaryTeamConflict ?? false,
        useScreenHost: props.useScreenHost ?? false,
    });
    props.onReady(state);
    return null;
}

function accessDraftEditor(state: NewSessionAccessDraftState, requestClose: () => void = () => {}) {
    const content = state.chip?.popoverContent;
    // The popover is supplied in the host's render form so Escape reaches the editor.
    if (typeof content !== 'function') throw new Error('expected the New Session access popover render form');
    const element = content({ requestClose, maxHeight: 420 }) as React.ReactElement<{
        actions: ReturnType<typeof useNewSessionAccessDraftController>['actions'];
        model: ReturnType<typeof useNewSessionAccessDraftController>['model'];
        onRequestClose?: () => void;
    }> | undefined;
    if (!element) throw new Error('expected mounted New Session access editor');
    return element.props;
}

function accessDraftActions(state: NewSessionAccessDraftState) {
    return accessDraftEditor(state).actions;
}

describe('useNewSessionAccessDraft repository currentness', () => {
    const alice: SessionInitialAccessDraftV1 = { grants: [{
        subject: { kind: 'account', accountId: 'alice' }, accessLevel: 'view', canApprovePermissions: false,
    }] };
    const bob: SessionInitialAccessDraftV1 = { grants: [{
        subject: { kind: 'account', accountId: 'bob' }, accessLevel: 'edit', canApprovePermissions: false,
    }] };

    it('adopts a newer synchronized access/team choice and exposes that same snapshot to the editor', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId="team-old" onReady={(state) => { latest = state; }} />);

        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={bob} sourcePrimaryTeamId="team-synced" onReady={(state) => { latest = state; }} />);

        expect(latest).toMatchObject({ access: bob, primaryTeamId: 'team-synced' });
    });

    it('does not overwrite a newer device edit when an unrelated repository revision arrives', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newer' });
        });
        const locallyEdited = latest!.access;

        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        expect(latest!.access).toEqual(locallyEdited);
        expect(latest!.access?.grants.map((grant) => grant.subject)).toContainEqual({
            kind: 'account', accountId: 'local-newer',
        });
    });

    it('stops treating a field as locally newer when the user returns it to the observed source value', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newer' });
        });
        await act(async () => {
            accessDraftActions(latest!).requestRemove({ kind: 'account', accountId: 'local-newer' });
        });
        expect(latest!.access).toEqual(alice);

        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={bob} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        expect(latest!.access).toEqual(bob);
    });

    it('tracks Team-context currentness independently from access currentness', async () => {
        runTeamActionMock.mockResolvedValue({
            kind: 'succeeded', value: { items: [{
                id: 'team-local', name: 'Local Team',
                policy: { sessionCreationPolicy: 'private_default', externalSharingPolicy: 'allowed' },
            }], nextCursor: null },
        } as never);
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);
        await vi.waitFor(() => expect(accessDraftEditor(latest!).model.context?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-local' }),
        ])));
        await act(async () => { accessDraftActions(latest!).setContext('team-local'); });
        expect(latest!.primaryTeamId).toBe('team-local');

        // An unrelated repository revision still carries the previous Team
        // context. It must not erase this newer device edit.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={bob} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);
        expect(latest!.access).toEqual(bob);
        expect(latest!.primaryTeamId).toBe('team-local');

        // Once its exact echo is observed, a later Use-synced choice may replace it.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={3}
            sourceAccess={bob} sourcePrimaryTeamId="team-local" onReady={(state) => { latest = state; }} />);
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={4}
            sourceAccess={bob} sourcePrimaryTeamId="team-synced" onReady={(state) => { latest = state; }} />);
        expect(latest!.primaryTeamId).toBe('team-synced');
    });

    it('does not let a stale Use-synced resolution overwrite a newer access edit on this device', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newer' });
        });
        const persistedFirst = latest!.access;
        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newest' });
        });
        const deviceEdited = latest!.access;
        expect(deviceEdited).not.toEqual(persistedFirst);

        // The repository persisted the first edit and flagged a same-field
        // conflict. The editor observes it without losing the newer device edit.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={persistedFirst} sourcePrimaryTeamId={null} sourceAccessConflict
            onReady={(state) => { latest = state; }} />);
        expect(latest!.access).toEqual(deviceEdited);

        // Resolving the older conflict to its synchronized value must not
        // overwrite the edit made after that conflict snapshot was shown.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={3}
            sourceAccess={bob} sourcePrimaryTeamId={null}
            onReady={(state) => { latest = state; }} />);
        expect(latest!.access).toEqual(deviceEdited);
    });

    it('preserves a newer device edit when Keep-device resolves without changing the field value', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newer' });
        });
        const persistedFirst = latest!.access;
        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newest' });
        });
        const deviceEdited = latest!.access;

        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={persistedFirst} sourcePrimaryTeamId={null} sourceAccessConflict
            onReady={(state) => { latest = state; }} />);
        expect(latest!.access).toEqual(deviceEdited);

        // Keep-device re-mints the persisted value without changing it, so the
        // newer unpersisted device edit must survive instead of being replaced
        // by the older persisted echo.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={3}
            sourceAccess={persistedFirst} sourcePrimaryTeamId={null}
            onReady={(state) => { latest = state; }} />);
        expect(latest!.access).toEqual(deviceEdited);
    });

    it('does not let a stale Use-synced resolution overwrite a newer Team context on this device', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => { latest!.applyTeamCredentialPolicy('team-local', false); });
        await act(async () => { latest!.applyTeamCredentialPolicy('team-newer', false); });
        expect(latest!.primaryTeamId).toBe('team-newer');

        // The repository persisted the first context choice and flagged its
        // conflict; the newer device choice is preserved.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={alice} sourcePrimaryTeamId="team-local" sourcePrimaryTeamConflict
            onReady={(state) => { latest = state; }} />);
        expect(latest!.primaryTeamId).toBe('team-newer');
        expect(latest!.access).toEqual(alice);

        // The older conflict can be resolved, but it cannot replace the
        // subsequently selected context still held by this mounted editor.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={3}
            sourceAccess={alice} sourcePrimaryTeamId="team-synced"
            onReady={(state) => { latest = state; }} />);
        expect(latest!.primaryTeamId).toBe('team-newer');
        expect(latest!.access).toEqual(alice);
    });

    it('adds Team visibility for a Team credential without reducing an explicit stronger grant', async () => {
        const acmeAdmin: SessionInitialAccessDraftV1 = { grants: [{
            subject: { kind: 'team', teamId: 'acme' }, accessLevel: 'admin', canApprovePermissions: true,
        }] };
        let latest: NewSessionAccessDraftState | null = null;
        await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={acmeAdmin} sourcePrimaryTeamId="acme" onReady={(state) => { latest = state; }} />);

        // The credential only requires that the Team can see the Session. It is
        // not a level decision, so it must not silently reduce the audience the
        // creator already chose (and that a required Team policy may lock).
        await act(async () => { latest!.applyTeamCredentialPolicy('acme', true); });

        expect(latest!.primaryTeamId).toBe('acme');
        expect(latest!.access).toEqual(acmeAdmin);
    });

    it('hands the draft editor the popover host real close instead of a no-op', async () => {
        const requestClose = vi.fn();
        let latest: NewSessionAccessDraftState | null = null;
        await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        accessDraftEditor(latest!, requestClose).onRequestClose?.();
        expect(requestClose).toHaveBeenCalledTimes(1);
    });

    it('opens the same draft-backed editor in the compact screen host and preserves edits across close/reopen', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} useScreenHost
            onReady={(state) => { latest = state; }} />);

        const chip = latest!.chip!;
        expect(chip.onOpen).toBeTypeOf('function');
        await act(async () => { chip.onOpen?.(React.createRef()); });
        expect(latest!.screen?.content).toBeTruthy();

        const screenContent = latest!.screen!.content as React.ReactElement<{ children: React.ReactNode }>;
        const editor = React.Children.toArray(screenContent.props.children)[1] as React.ReactElement<{
            actions: ReturnType<typeof useNewSessionAccessDraftController>['actions'];
            presentation: string;
        }>;
        expect(editor.props.presentation).toBe('full');
        await act(async () => {
            editor.props.actions.addPrincipal({ kind: 'account', accountId: 'compact-added' });
        });

        await act(async () => { latest!.screen!.onRequestClose(); });
        expect(latest!.screen).toBeNull();
        await act(async () => { latest!.chip!.onOpen?.(React.createRef()); });
        expect(latest!.access?.grants.map((grant) => grant.subject)).toContainEqual({
            kind: 'account', accountId: 'compact-added',
        });
    });

    it('adds the safe default Team visibility grant when the Team has none yet', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => { latest!.applyTeamCredentialPolicy('acme', true); });

        expect(latest!.primaryTeamId).toBe('acme');
        expect(latest!.access?.grants).toEqual([
            ...alice.grants,
            { subject: { kind: 'team', teamId: 'acme' }, accessLevel: 'view', canApprovePermissions: false },
        ]);
    });

    it('keeps a newer access edit while adopting an unrelated synchronized Team context', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);

        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newer' });
        });
        const deviceEdited = latest!.access;

        // Only the Team context changed on the repository; the unrelated
        // access edit must survive while the context is adopted.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={alice} sourcePrimaryTeamId="team-synced"
            onReady={(state) => { latest = state; }} />);
        expect(latest!.access).toEqual(deviceEdited);
        expect(latest!.primaryTeamId).toBe('team-synced');
    });

    it('accepts its persisted echo, then adopts a later Use-synced result without reviving another Home', async () => {
        let latest: NewSessionAccessDraftState | null = null;
        const screen = await renderScreen(<AccessDraftProbe serverId="home-one" sourceRevision={1}
            sourceAccess={alice} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);
        await act(async () => {
            accessDraftActions(latest!).addPrincipal({ kind: 'account', accountId: 'local-newer' });
        });
        const locallyEdited = latest!.access;

        // The synchronized repository acknowledges this hook's exact local value.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={2}
            sourceAccess={locallyEdited} sourcePrimaryTeamId={null} onReady={(state) => { latest = state; }} />);
        // A later conflict resolution chooses the synchronized value.
        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={3}
            sourceAccess={bob} sourcePrimaryTeamId="team-synced" onReady={(state) => { latest = state; }} />);
        expect(latest).toMatchObject({ access: bob, primaryTeamId: 'team-synced' });

        await screen.update(<AccessDraftProbe serverId="home-two" sourceRevision={3}
            sourceAccess={bob} sourcePrimaryTeamId="team-synced" onReady={(state) => { latest = state; }} />);
        expect(latest).toMatchObject({ access: null, primaryTeamId: null });

        await screen.update(<AccessDraftProbe serverId="home-one" sourceRevision={3}
            sourceAccess={bob} sourcePrimaryTeamId="team-synced" onReady={(state) => { latest = state; }} />);
        expect(latest).toMatchObject({ access: null, primaryTeamId: null });
    });
});
