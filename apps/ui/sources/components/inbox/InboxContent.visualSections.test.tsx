import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { buildServerScopedSessionKey } from '@/sync/domains/session/navigation/sessionNavigationOrder';

const routerPush = vi.hoisted(() => vi.fn());
const identityState = vi.hoisted(() => ({ display: 'agentLogo' as 'agentLogo' | 'none' }));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ View: 'View' });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/components/ui/selectionList/SelectionListSectionHeader', () => ({
    SelectionListSectionHeader: (props: Record<string, unknown>) => React.createElement(
        'SelectionListSectionHeader', props, props.rightAccessory as React.ReactNode,
    ),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement(
        'Item', props, props.leftElement as React.ReactNode, props.rightElement as React.ReactNode,
    ),
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown>) => React.createElement(
        'ItemGroup', props, props.title as React.ReactNode, props.children as React.ReactNode,
    ),
}));
vi.mock('@/components/ui/buttons/IconButton', () => ({ IconButton: 'IconButton' }));
vi.mock('@/components/ui/icons/Icon', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/components/ui/icons/Icon')>(),
    Icon: 'Icon',
}));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({ ActivitySpinner: 'ActivitySpinner' }));
vi.mock('@/components/ui/cards/UserCard', () => ({ UserCard: 'UserCard' }));
vi.mock('@/components/account/RecoveryKeyReminderBanner', () => ({ RecoveryKeyReminderBanner: 'RecoveryKeyReminderBanner' }));
vi.mock('@/components/inbox/cards/ApprovalInboxCard', () => ({ ApprovalInboxCard: 'ApprovalInboxCard' }));
vi.mock('@/components/inbox/sessionAttention/InboxSessionAttentionGroupCard', () => ({ InboxSessionAttentionGroupCard: 'InboxSessionAttentionGroupCard' }));
vi.mock('@/components/sessions/shell/SessionListIdentity', () => ({
    SessionListIdentity: 'SessionListIdentity',
    useSessionListIdentityDisplay: () => identityState.display,
}));
vi.mock('@/components/sessions/shell/resolveSessionListDensityViewState', () => ({
    SESSION_LIST_ROW_IDENTITY_METRICS: { compact: { slotSize: 30, agentLogoSize: 23 } },
}));
vi.mock('./InboxReadySessionRow', () => ({ InboxReadySessionRow: 'InboxReadySessionRow' }));
vi.mock('./actionOperations/ActionOperationLedger', () => ({ ActionOperationRows: 'ActionOperationRows' }));
vi.mock('./actionOperations/actionOperationPresentationRuntime', () => ({ openActionOperation: vi.fn() }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

function candidate(id: string, attentionState: string, reasons: readonly string[]) {
    return {
        sessionId: id,
        serverId: 'server-a',
        address: { serverId: 'server-a', sessionId: id },
        session: { id, serverId: 'server-a', active: false, presence: 'online', metadata: {} },
        title: `Session ${id}`,
        subtitle: `/workspace/${id}`,
        context: { contextLine: `Home · ${id}` },
        route: `/session/${id}`,
        attentionState,
        personalAttention: { reasons, presentation: 'full' },
    } as never;
}

function createModel(options: Readonly<{ failedHasPrompt?: boolean }> = {}) {
    const failed = candidate(
        'failed',
        'failed',
        options.failedHasPrompt ? ['failed', 'permission_required'] : ['failed'],
    );
    const actionable = candidate('actionable', 'action_required', ['pending_blocked']);
    const ready = candidate('ready', 'ready', ['unread']);
    const readyTarget = {
        key: buildServerScopedSessionKey('ready', 'server-a'),
        sessionId: 'ready',
        serverId: 'server-a',
        readState: 'unread',
    };
    return {
        source: {},
        openApprovals: [{ id: 'approval-1', header: {} }],
        friendRequests: [{ id: 'friend-1', username: 'friend' }],
        sessionPresentation: {
            sessionsNeedingAttention: [
                {
                    candidate: failed,
                    pendingPermissions: options.failedHasPrompt ? [{ id: 'permission-1' }] : [],
                    pendingUserActions: [],
                },
                { candidate: actionable, pendingPermissions: [], pendingUserActions: [] },
            ],
            readySessions: [ready],
            markAllReadTargets: [readyTarget],
        },
        targetBySessionAddress: new Map([[readyTarget.key, readyTarget]]),
        actionOperationEntries: [
            {
                reason: 'failed',
                operation: { serverId: 'server-a', snapshot: { operationId: 'op-failed' } },
            },
            {
                reason: 'status_unavailable',
                operation: { serverId: 'server-a', snapshot: { operationId: 'op-unavailable' } },
            },
        ],
        pendingReadKeys: new Set(),
        markAllPending: false,
        isLoading: false,
        hasPrimaryAttention: true,
        showCaughtUp: false,
        markRead: vi.fn(async () => {}),
        resolveActionOperation: vi.fn(),
    } as never;
}

describe('InboxContent visual sections', () => {
    beforeEach(() => {
        identityState.display = 'agentLogo';
        routerPush.mockClear();
    });

    it('renders grouped screen sections in attention order and scopes mark-all to the Ready header', async () => {
        const model = createModel();
        const { tree, pressByTestId } = await renderScreen(<InboxContent model={model} />);
        const sectionHeaders = tree.root.findAllByType('SelectionListSectionHeader');

        expect(sectionHeaders.map((node) => node.props.testID)).toEqual([
            'inbox.section.errors.header',
            'inbox.section.ready.header',
            'inbox.section.needs_attention.header',
            'inbox.section.friends.header',
        ]);
        expect(tree.root.findAllByType('ItemGroup' as never)).toHaveLength(4);
        expect(tree.root.findAllByType('ApprovalInboxCard')).toHaveLength(1);
        const errorOperationRows = tree.root.findByProps({ testID: 'inbox.section.errors' })
            .findAllByType('ActionOperationRows');
        const attentionOperationRows = tree.root.findByProps({ testID: 'inbox.section.needs_attention' })
            .findAllByType('ActionOperationRows');
        expect(errorOperationRows).toHaveLength(1);
        expect(errorOperationRows[0]?.props.operations[0]?.snapshot.operationId).toBe('op-failed');
        expect(attentionOperationRows).toHaveLength(1);
        expect(attentionOperationRows[0]?.props.operations[0]?.snapshot.operationId).toBe('op-unavailable');
        expect(tree.root.findAllByType('ActionOperationLedgerView' as never)).toHaveLength(0);

        const failedRow = tree.root.findByProps({ testID: 'inbox.session.failed' });
        expect(failedRow.props.rightElement).toBeUndefined();
        expect(failedRow.props.detail).toBeUndefined();
        expect(failedRow.props.subtitle).toContain('status.error');
        expect(failedRow.findAllByType('SessionListIdentity')).toHaveLength(1);

        const readyRow = tree.root.findByType('InboxReadySessionRow');
        expect(readyRow.props.subtitle).toContain('status.readyForReview');
        expect(readyRow.props.identityDisplay).toBe('agentLogo');
        expect(tree.root.findByProps({ testID: 'inbox.ready.mark_all_read' }).props.hitSlop).toBe(17);

        pressByTestId('inbox.ready.mark_all_read');
        expect(model.markRead).toHaveBeenCalledWith(model.sessionPresentation.markAllReadTargets);
    });

    it('keeps the popover sections flat', async () => {
        const { tree } = await renderScreen(
            <InboxContent model={createModel()} presentation="popover" />,
        );

        expect(tree.root.findAllByType('ItemGroup' as never)).toHaveLength(0);
    });

    it('removes the leading slot when the canonical Session-list identity preference is none', async () => {
        identityState.display = 'none';
        const { tree } = await renderScreen(<InboxContent model={createModel()} />);

        const failedRow = tree.root.findByProps({ testID: 'inbox.session.failed' });
        expect(failedRow.props.leftElement).toBeUndefined();
        expect(failedRow.props.iconBoxSize).toBeUndefined();
        const readyRow = tree.root.findByType('InboxReadySessionRow');
        expect(readyRow.props.identityDisplay).toBe('none');
    });

    it('opens a V2 approval through its portable owning Home rather than the focused Home', async () => {
        const model = createModel();
        model.openApprovals = [{
            id: 'approval-home-b',
            header: { serverId: 'creator-local-b', serverIdentityId: 'stable-home-b' },
        }];
        const { tree } = await renderScreen(<InboxContent model={model} />);

        tree.root.findByType('ApprovalInboxCard').props.onPress();

        expect(routerPush).toHaveBeenCalledWith('/inbox/approvals/approval-home-b?serverId=stable-home-b');
    });

    it('keeps the V1 local Home route when a portable identity was never stored', async () => {
        const model = createModel();
        model.openApprovals = [{ id: 'approval-v1', header: { serverId: 'server-b' } }];
        const { tree } = await renderScreen(<InboxContent model={model} />);

        tree.root.findByType('ApprovalInboxCard').props.onPress();

        expect(routerPush).toHaveBeenCalledWith('/inbox/approvals/approval-v1?serverId=server-b');
    });

    it('keeps canonical prompt controls on a failed session inside Errors without duplicating it in Needs attention', async () => {
        const { tree } = await renderScreen(<InboxContent model={createModel({ failedHasPrompt: true })} />);
        const errors = tree.root.findByProps({ testID: 'inbox.section.errors' });
        const needsAttention = tree.root.findByProps({ testID: 'inbox.section.needs_attention' });

        expect(errors.findAllByType('InboxSessionAttentionGroupCard')).toHaveLength(1);
        expect(needsAttention.findAllByType('InboxSessionAttentionGroupCard')).toHaveLength(0);
        expect(tree.root.findAllByType('InboxSessionAttentionGroupCard')).toHaveLength(1);
    });
});

import { InboxContent } from './InboxContent';
