import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '@/components/settings/settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirmDisclosure = vi.hoisted(() => vi.fn(async () => true));
const createResource = vi.hoisted(() => vi.fn());

installSettingsViewCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { confirm: confirmDisclosure } }).module;
    },
});

vi.mock('@/sync/ops/settings/savedSecretResourceOperations', () => ({
    createSavedSecretResource: createResource,
}));
vi.mock('@/sync/ops/teams/teamActionClient', () => ({
    isTeamActionApprovalPendingError: (value: unknown) => (
        typeof value === 'object' && value !== null && 'registration' in value
    ),
}));
vi.mock('@/components/sessions/access/useSessionAccessDirectory', () => ({
    useSessionAccessDirectory: () => ({
        sections: [
            { kind: 'account', title: 'People', candidates: [], status: 'idle', cursor: null, hasMore: false, loadingMore: false,
                resolveCandidates: async () => [{ principal: { ref: { kind: 'account', accountId: 'account-b' }, key: 'account:account-b', displayName: 'B', accessibilityLabel: 'B' }, addition: { kind: 'allowed' }, operation: { kind: 'idle' } }] },
            { kind: 'team', title: 'Teams', candidates: [], status: 'idle', cursor: null, hasMore: false, loadingMore: false,
                resolveCandidates: async () => [{ principal: { ref: { kind: 'team', teamId: 'team-a' }, key: 'team:team-a', displayName: 'Team A', accessibilityLabel: 'Team A' }, addition: { kind: 'allowed' }, operation: { kind: 'idle' } }] },
            { kind: 'group', title: 'Groups', candidates: [], status: 'idle', cursor: null, hasMore: false, loadingMore: false,
                resolveCandidates: async () => [{ principal: { ref: { kind: 'group', teamId: 'team-a', groupId: 'group-a' }, key: 'group:team-a:group-a', displayName: 'Group A', secondaryLabel: 'Team A', accessibilityLabel: 'Group A, Team A' }, addition: { kind: 'allowed' }, operation: { kind: 'idle' } }] },
        ],
        teamContexts: [], activeTeamContexts: [], teamDirectoryStatus: 'ready', teamDirectoryComplete: true,
        loadMore: vi.fn(), retry: vi.fn(),
    }),
}));

afterEach(() => {
    standardCleanup();
    confirmDisclosure.mockReset();
    confirmDisclosure.mockResolvedValue(true);
    createResource.mockReset();
});

describe('SavedSecretCreateEditor', () => {
    it('creates an owner-only resource from one name, kind, and value entry', async () => {
        createResource.mockResolvedValueOnce({
            ok: true, resourceRef: 'happier:shared-secret:v1:resource-a', revision: 1,
        });
        const onCreated = vi.fn(async () => {});
        const { SavedSecretCreateEditor } = await import('./SavedSecretCreateEditor');
        const screen = await renderScreen(
            <SavedSecretCreateEditor
                scope={{ serverId: 'home-a', accountId: 'owner-a' }}
                approvalPending={false}
                requestApproval={vi.fn()}
                onCancel={vi.fn()}
                onCreated={onCreated}
            />,
        );

        screen.changeTextByTestId('saved-secret-create-name', 'Deploy token');
        screen.changeTextByTestId('saved-secret-create-value', '  token-value\n');
        await screen.pressByTestIdAsync('saved-secret-create-kind:token');
        await screen.pressByTestIdAsync('saved-secret-create-submit');

        expect(confirmDisclosure).not.toHaveBeenCalled();
        expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'home-a', accountId: 'owner-a' },
            name: 'Deploy token', kind: 'token', value: '  token-value\n',
            accountGrants: [], teamGrants: [], groupGrants: [],
        }));
        expect(onCreated).toHaveBeenCalledWith('happier:shared-secret:v1:resource-a');
    });

    it('confirms disclosure and submits initial Account, Team, and Group grants', async () => {
        createResource.mockResolvedValueOnce({
            ok: true, resourceRef: 'happier:shared-secret:v1:resource-a', revision: 1,
        });
        const { SavedSecretCreateEditor } = await import('./SavedSecretCreateEditor');
        const screen = await renderScreen(
            <SavedSecretCreateEditor
                scope={{ serverId: 'home-a', accountId: 'owner-a' }}
                approvalPending={false}
                requestApproval={vi.fn()}
                onCancel={vi.fn()}
                onCreated={vi.fn(async () => {})}
            />,
        );

        screen.changeTextByTestId('saved-secret-create-name', 'Mixed secret');
        screen.changeTextByTestId('saved-secret-create-value', 'secret-value');
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-b')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-account:account-b');
        await screen.pressByTestIdAsync('saved-secret-access-team:team-a');
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-group:team-a:group-a')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-group:team-a:group-a');
        await screen.pressByTestIdAsync('saved-secret-create-submit');

        expect(confirmDisclosure).toHaveBeenCalledOnce();
        expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
            accountGrants: ['account-b'], teamGrants: ['team-a'], groupGrants: ['group-a'],
        }));
    });

    it('keeps the draft mounted while approval is pending and presents the exact artifact', async () => {
        const requestApproval = vi.fn();
        createResource.mockRejectedValueOnce({ registration: { artifactId: 'approval-a' } });
        const { SavedSecretCreateEditor } = await import('./SavedSecretCreateEditor');
        const screen = await renderScreen(
            <SavedSecretCreateEditor
                scope={{ serverId: 'home-a', accountId: 'owner-a' }}
                approvalPending={false}
                requestApproval={requestApproval}
                onCancel={vi.fn()}
                onCreated={vi.fn(async () => {})}
            />,
        );
        screen.changeTextByTestId('saved-secret-create-name', 'Kept name');
        screen.changeTextByTestId('saved-secret-create-value', 'kept-value');
        // Both entries must be committed before the press: the rendered submit
        // handler is the one the last commit produced.
        await flushHookEffects();
        await screen.pressByTestIdAsync('saved-secret-create-submit');
        expect(requestApproval).toHaveBeenCalledWith({ artifactId: 'approval-a' });

        await screen.update(
            <SavedSecretCreateEditor
                scope={{ serverId: 'home-a', accountId: 'owner-a' }}
                approvalPending
                approvalId="approval-a"
                requestApproval={requestApproval}
                onOpenApproval={vi.fn()}
                onCancel={vi.fn()}
                onCreated={vi.fn(async () => {})}
            />,
        );
        expect(screen.findByTestId('saved-secret-create-name')?.props.value).toBe('Kept name');
        expect(screen.findByTestId('saved-secret-create-submit')?.props.disabled).toBe(true);
        expect(screen.findByTestId('saved-secret-create-approval')).toBeTruthy();
    });

    it('clears the draft across a Home switch and ignores the old Home result', async () => {
        const deferred = createDeferred<{
            ok: true; resourceRef: string; revision: number;
        }>();
        createResource.mockReturnValueOnce(deferred.promise);
        const onCreated = vi.fn(async () => {});
        const { SavedSecretCreateEditor } = await import('./SavedSecretCreateEditor');
        const common = {
            approvalPending: false,
            requestApproval: vi.fn(),
            onCancel: vi.fn(),
            onCreated,
        };
        const screen = await renderScreen(
            <SavedSecretCreateEditor scope={{ serverId: 'home-a', accountId: 'owner-a' }} {...common} />,
        );
        screen.changeTextByTestId('saved-secret-create-name', 'Home A secret');
        screen.changeTextByTestId('saved-secret-create-value', 'home-a-value');
        // Commit the typed draft before pressing, so the press reads it.
        await flushHookEffects();
        screen.pressByTestId('saved-secret-create-submit');

        await screen.update(
            <SavedSecretCreateEditor scope={{ serverId: 'home-b', accountId: 'owner-b' }} {...common} />,
        );
        // A different Home is a different draft: the value typed for Home A is
        // gone, so nothing typed there can be submitted here.
        expect(screen.findByTestId('saved-secret-create-name')?.props.value).toBe('');
        expect(screen.findByTestId('saved-secret-create-value')?.props.value).toBe('');
        await screen.pressByTestIdAsync('saved-secret-create-submit');
        expect(createResource).toHaveBeenCalledTimes(1);

        deferred.resolve({ ok: true, resourceRef: 'happier:shared-secret:v1:old-home', revision: 1 });
        await flushHookEffects();
        expect(onCreated).not.toHaveBeenCalled();
    });

    it('does not carry one Home\u2019s recipients into a Create on another Home', async () => {
        createResource.mockResolvedValueOnce({
            ok: true, resourceRef: 'happier:shared-secret:v1:resource-b', revision: 1,
        });
        const { SavedSecretCreateEditor } = await import('./SavedSecretCreateEditor');
        const common = {
            approvalPending: false,
            requestApproval: vi.fn(),
            onCancel: vi.fn(),
            onCreated: vi.fn(async () => {}),
        };
        const screen = await renderScreen(
            <SavedSecretCreateEditor scope={{ serverId: 'home-a', accountId: 'owner-a' }} {...common} />,
        );
        screen.changeTextByTestId('saved-secret-create-name', 'Cross-Home secret');
        screen.changeTextByTestId('saved-secret-create-value', 'cross-home-value');
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-b')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-account:account-b');
        await screen.pressByTestIdAsync('saved-secret-access-team:team-a');

        await screen.update(
            <SavedSecretCreateEditor scope={{ serverId: 'home-b', accountId: 'owner-b' }} {...common} />,
        );
        screen.changeTextByTestId('saved-secret-create-name', 'Home B secret');
        screen.changeTextByTestId('saved-secret-create-value', 'home-b-value');
        await flushHookEffects();
        await screen.pressByTestIdAsync('saved-secret-create-submit');

        // `account-b`, `team-a` and `group-a` are Home A identities; submitting
        // them to Home B would ask it to share with principals it never named.
        expect(createResource).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'home-b', accountId: 'owner-b' },
            name: 'Home B secret',
            value: 'home-b-value',
            accountGrants: [], teamGrants: [], groupGrants: [],
        }));
        // An owner-only create needs no disclosure confirmation, which also
        // proves the recipient sets really were empty at submit time.
        expect(confirmDisclosure).not.toHaveBeenCalled();
    });

    it('keeps entered material available for retry after a typed failure', async () => {
        createResource.mockResolvedValueOnce({ ok: false, reason: 'unavailable' });
        const { SavedSecretCreateEditor } = await import('./SavedSecretCreateEditor');
        const screen = await renderScreen(
            <SavedSecretCreateEditor
                scope={{ serverId: 'home-a', accountId: 'owner-a' }}
                approvalPending={false}
                requestApproval={vi.fn()}
                onCancel={vi.fn()}
                onCreated={vi.fn(async () => {})}
            />,
        );
        screen.changeTextByTestId('saved-secret-create-name', 'Retry me');
        screen.changeTextByTestId('saved-secret-create-value', 'still-here');
        await screen.pressByTestIdAsync('saved-secret-create-submit');

        expect(screen.findByTestId('saved-secret-create-name')?.props.value).toBe('Retry me');
        expect(screen.findByTestId('saved-secret-create-value')?.props.value).toBe('still-here');
        expect(screen.findByTestId('saved-secret-create-submit')?.props.disabled).toBe(false);
    });
});
