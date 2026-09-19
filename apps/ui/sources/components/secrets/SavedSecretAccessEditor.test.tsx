import * as React from 'react';
import type { SavedSecretCatalogEntryV1 } from '@happier-dev/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedSecretResourceOperationResult } from '@/sync/ops/settings/savedSecretResourceOperations';

import { createDeferred, flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '@/components/settings/settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirmDisclosure = vi.hoisted(() => vi.fn(async () => true));

installSettingsViewCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { confirm: confirmDisclosure } }).module;
    },
});

const setGrants = vi.hoisted(() => vi.fn<() => Promise<SavedSecretResourceOperationResult>>(async () => ({ ok: true })));
const promotePersonal = vi.hoisted(() => vi.fn(async () => ({
    ok: true as const, resourceRef: 'happier:shared-secret:v1:resource-promoted',
})));

vi.mock('@/sync/ops/settings/savedSecretResourceOperations', () => ({
    setSavedSecretResourceGrants: setGrants,
    promotePersonalSavedSecretResource: promotePersonal,
}));
vi.mock('@/sync/runtime/getSyncSingleton', () => ({ getSyncSingleton: () => ({ encryption: null }) }));
vi.mock('@/components/sessions/access/useSessionAccessDirectory', () => ({
    useSessionAccessDirectory: () => ({
        sections: [
            { kind: 'account', title: 'People', candidates: [], status: 'idle', cursor: null, hasMore: false, loadingMore: false,
                resolveCandidates: async () => [{ principal: { ref: { kind: 'account', accountId: 'account-new' }, key: 'account:account-new', displayName: 'New Person', accessibilityLabel: 'New Person' }, addition: { kind: 'allowed' }, operation: { kind: 'idle' } }] },
            { kind: 'team', title: 'Teams', candidates: [], status: 'idle', cursor: null, hasMore: false, loadingMore: false,
                resolveCandidates: async () => [{ principal: { ref: { kind: 'team', teamId: 'team-new' }, key: 'team:team-new', displayName: 'New Team', accessibilityLabel: 'New Team' }, addition: { kind: 'allowed' }, operation: { kind: 'idle' } }] },
            { kind: 'group', title: 'Groups', candidates: [], status: 'idle', cursor: null, hasMore: false, loadingMore: false,
                resolveCandidates: async () => [{ principal: { ref: { kind: 'group', teamId: 'team-new', groupId: 'group-new' }, key: 'group:team-new:group-new', displayName: 'New Group', secondaryLabel: 'New Team', accessibilityLabel: 'New Group, New Team' }, addition: { kind: 'allowed' }, operation: { kind: 'idle' } }] },
        ],
        teamContexts: [], activeTeamContexts: [], teamDirectoryStatus: 'ready', teamDirectoryComplete: true,
        loadMore: vi.fn(), retry: vi.fn(),
    }),
}));

const entry = {
    ref: 'happier:shared-secret:v1:resource-1',
    source: 'shared_resource',
    relationship: 'owner',
    name: 'Shared key',
    kind: 'apiKey',
    encryptionMode: 'plain',
    owner: null,
    accessSources: [],
    audience: { accounts: [], teams: [], groups: [] },
    ownerAccountId: 'account-owner',
    revision: 3,
    materialStatus: 'ready',
    capabilities: { use: true, rename: true, rotate: true, manageAccess: true, delete: true },
} as const satisfies SavedSecretCatalogEntryV1;

afterEach(() => {
    standardCleanup();
    setGrants.mockReset();
    setGrants.mockResolvedValue({ ok: true });
    promotePersonal.mockReset();
    promotePersonal.mockResolvedValue({ ok: true as const, resourceRef: 'happier:shared-secret:v1:resource-promoted' });
    confirmDisclosure.mockReset();
    confirmDisclosure.mockResolvedValue(true);
});

const personalSecret = {
    id: 'personal-1',
    name: 'Personal key',
    kind: 'apiKey',
    encryptedValue: { _isSecretValue: true, value: 'sealed' },
    createdAt: 1,
    updatedAt: 2,
} as const;

describe('SavedSecretAccessEditor', () => {
    it('promotes a personal secret once, with the chosen grants, only when the person saves', async () => {
        const { SavedSecretAccessEditor } = await import('./SavedSecretAccessEditor');
        const onClose = vi.fn();
        const onSaved = vi.fn(async () => {});
        const screen = await renderScreen(
            <SavedSecretAccessEditor
                target={{ kind: 'personal', secret: personalSecret, expectedSettingsVersion: 9 }}
                scope={{ serverId: 'home-a', accountId: 'account-owner' }}
                onClose={onClose}
                onSaved={onSaved}
            />,
        );

        // Opening the picker converts nothing: the secret is still personal
        // until the person has chosen who receives it and confirmed.
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-new')).toBeTruthy());
        expect(promotePersonal).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('saved-secret-access-account:account-new');
        await screen.pressByTestIdAsync('saved-secret-access-team:team-new');
        expect(promotePersonal).not.toHaveBeenCalled();

        await screen.pressByTestIdAsync('saved-secret-access-save');

        expect(confirmDisclosure).toHaveBeenCalledOnce();
        expect(promotePersonal).toHaveBeenCalledOnce();
        expect(promotePersonal).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'home-a', accountId: 'account-owner' },
            expectedSettingsVersion: 9,
            secret: personalSecret,
            accountGrants: ['account-new'],
            teamGrants: ['team-new'],
            groupGrants: [],
        }));
        expect(setGrants).not.toHaveBeenCalled();
        expect(onSaved).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('keeps a personal secret personal when the first-grant disclosure is declined', async () => {
        confirmDisclosure.mockResolvedValueOnce(false);
        const { SavedSecretAccessEditor } = await import('./SavedSecretAccessEditor');
        const screen = await renderScreen(
            <SavedSecretAccessEditor
                target={{ kind: 'personal', secret: personalSecret, expectedSettingsVersion: 9 }}
                scope={{ serverId: 'home-a', accountId: 'account-owner' }}
                onClose={vi.fn()}
                onSaved={vi.fn(async () => {})}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-new')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-account:account-new');
        await screen.pressByTestIdAsync('saved-secret-access-save');

        expect(promotePersonal).not.toHaveBeenCalled();
        expect(screen.findByTestId('saved-secret-access-save')).toBeTruthy();
    });

    it('saves Account, Team and Group choices through the canonical revision-fenced grant operation', async () => {
        const { SavedSecretAccessEditor } = await import('./SavedSecretAccessEditor');
        const onClose = vi.fn();
        const onSaved = vi.fn(async () => {});
        const screen = await renderScreen(
            <SavedSecretAccessEditor
                target={{ kind: 'shared', entry }}
                scope={{ serverId: 'home-a', accountId: 'account-owner' }}
                onClose={onClose}
                onSaved={onSaved}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-new')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-account:account-new');
        await screen.pressByTestIdAsync('saved-secret-access-team:team-new');
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-group:team-new:group-new')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-group:team-new:group-new');
        await screen.pressByTestIdAsync('saved-secret-access-save');

        expect(setGrants).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'home-a', accountId: 'account-owner' },
            resourceId: 'resource-1',
            expectedRevision: 3,
            encryptionMode: 'plain',
            accountGrants: ['account-new'],
            teamGrants: ['team-new'],
            groupGrants: ['group-new'],
        }));
        expect(onSaved).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not let a late save response close a different resource revision', async () => {
        const { SavedSecretAccessEditor } = await import('./SavedSecretAccessEditor');
        const request = createDeferred<{ ok: true }>();
        setGrants.mockImplementationOnce(() => request.promise);
        const onClose = vi.fn();
        const onSaved = vi.fn(async () => {});
        const scope = { serverId: 'home-a', accountId: 'account-owner' } as const;
        const screen = await renderScreen(
            <SavedSecretAccessEditor target={{ kind: 'shared', entry }} scope={scope} onClose={onClose} onSaved={onSaved} />,
        );

        screen.pressByTestId('saved-secret-access-save');
        await screen.update(
            <SavedSecretAccessEditor
                target={{ kind: 'shared', entry: { ...entry, revision: 4 } }}
                scope={scope}
                onClose={onClose}
                onSaved={onSaved}
            />,
        );
        request.resolve({ ok: true });
        await flushHookEffects();

        expect(onSaved).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.findByTestId('saved-secret-access-save')).toBeTruthy();
    });

    it('does not create the first external grant when direct-disclosure confirmation is cancelled', async () => {
        confirmDisclosure.mockResolvedValueOnce(false);
        const { SavedSecretAccessEditor } = await import('./SavedSecretAccessEditor');
        const screen = await renderScreen(
            <SavedSecretAccessEditor
                target={{ kind: 'shared', entry }}
                scope={{ serverId: 'home-a', accountId: 'account-owner' }}
                onClose={vi.fn()}
                onSaved={vi.fn(async () => {})}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-new')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-account:account-new');
        await screen.pressByTestIdAsync('saved-secret-access-save');

        expect(confirmDisclosure).toHaveBeenCalledOnce();
        expect(setGrants).not.toHaveBeenCalled();
        expect(screen.findByTestId('saved-secret-access-save')).toBeTruthy();
    });

    it('refreshes authoritative state and stays open when grant outcome is unknown', async () => {
        setGrants.mockResolvedValueOnce({ ok: false, reason: 'outcome_unknown' });
        const onClose = vi.fn();
        const onSaved = vi.fn(async () => {});
        const { SavedSecretAccessEditor } = await import('./SavedSecretAccessEditor');
        const screen = await renderScreen(
            <SavedSecretAccessEditor
                target={{ kind: 'shared', entry }}
                scope={{ serverId: 'home-a', accountId: 'account-owner' }}
                onClose={onClose}
                onSaved={onSaved}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-new')).toBeTruthy());
        await screen.pressByTestIdAsync('saved-secret-access-account:account-new');
        await screen.pressByTestIdAsync('saved-secret-access-save');

        expect(onSaved).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.findByTestId('saved-secret-access-save')).toBeTruthy();
    });
});
