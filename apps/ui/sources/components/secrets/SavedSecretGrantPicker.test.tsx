import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionAccessDirectory } from '@/components/sessions/access/useSessionAccessDirectory';
import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', () => ({ t: (key: string) => key }));

const adminSearch = vi.hoisted(() => vi.fn(() => {
    throw new Error('Home administration search must not be consumed');
}));
vi.mock('@/hooks/home/useHomeAccountSearch', () => ({ useHomeAccountSearch: adminSearch }));

const retry = vi.hoisted(() => vi.fn());
const loadMore = vi.hoisted(() => vi.fn());
const directoryFixture = vi.hoisted(() => ({
    accountFailure: false,
    /** Teams and Groups are the other two principal kinds this directory owns. */
    collaborationPrincipals: false,
    accountHasMore: false,
}));
vi.mock('@/components/sessions/access/useSessionAccessDirectory', () => ({
    useSessionAccessDirectory: (): SessionAccessDirectory => ({
        sections: [{
            kind: 'account',
            title: 'People',
            candidates: [],
            status: directoryFixture.accountFailure ? 'error' : 'idle',
            ...(directoryFixture.accountFailure ? { error: { code: 'directory_failed', message: 'Directory unavailable', retryable: true } } : {}),
            cursor: directoryFixture.accountHasMore ? 'cursor-1' : null,
            hasMore: directoryFixture.accountHasMore,
            loadingMore: false,
            resolverKey: `accounts:${directoryFixture.accountFailure}`,
            resolveCandidates: async () => directoryFixture.accountFailure ? Promise.reject(new Error('offline')) : [{
                principal: {
                    ref: { kind: 'account', accountId: 'account-collaborator' },
                    key: 'account:account-collaborator',
                    displayName: 'Eligible Collaborator',
                    accessibilityLabel: 'Eligible Collaborator',
                },
                addition: { kind: 'allowed' },
                operation: { kind: 'idle' },
            }, {
                principal: {
                    ref: { kind: 'account', accountId: 'account-already-granted' },
                    key: 'account:account-already-granted',
                    displayName: 'Already Granted',
                    accessibilityLabel: 'Already Granted',
                },
                addition: { kind: 'allowed' },
                operation: { kind: 'idle' },
            }],
        }, ...(directoryFixture.collaborationPrincipals ? [{
            kind: 'team' as const,
            title: 'Teams',
            candidates: [{
                principal: {
                    ref: { kind: 'team' as const, teamId: 'team-acme' },
                    key: 'team:team-acme',
                    displayName: 'Acme',
                    accessibilityLabel: 'Acme',
                },
                addition: { kind: 'allowed' as const },
                operation: { kind: 'idle' as const },
            }],
            status: 'idle' as const,
            cursor: null,
            hasMore: false,
            loadingMore: false,
            resolverKey: 'teams',
        }, {
            kind: 'group' as const,
            title: 'Groups',
            candidates: [{
                principal: {
                    ref: { kind: 'group' as const, teamId: 'team-acme', groupId: 'group-oncall' },
                    key: 'group:team-acme:group-oncall',
                    displayName: 'On-call',
                    secondaryLabel: 'Acme',
                    accessibilityLabel: 'On-call in Acme',
                },
                addition: { kind: 'allowed' as const },
                operation: { kind: 'idle' as const },
            }],
            status: 'idle' as const,
            cursor: null,
            hasMore: false,
            loadingMore: false,
            resolverKey: 'groups',
        }] : [])],
        teamContexts: [],
        activeTeamContexts: [],
        teamDirectoryStatus: 'ready',
        teamDirectoryComplete: true,
        loadMore,
        retry,
    }),
}));

afterEach(() => {
    standardCleanup();
    adminSearch.mockClear();
    retry.mockClear();
    loadMore.mockClear();
    directoryFixture.accountFailure = false;
    directoryFixture.collaborationPrincipals = false;
    directoryFixture.accountHasMore = false;
});

describe('SavedSecretGrantPicker collaboration directory', () => {
    it('lets an ordinary owner select a collaboration-eligible Account without consuming Home administration search', async () => {
        const { SavedSecretGrantPicker, createEmptySavedSecretGrantDraft } = await import('./SavedSecretGrantPicker');
        const onChange = vi.fn();
        const screen = await renderScreen(
            <SavedSecretGrantPicker
                scope={{ serverId: 'home-a', accountId: 'ordinary-owner' }}
                draft={createEmptySavedSecretGrantDraft()}
                onChange={onChange}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-collaborator')).toBeTruthy());
        expect(screen.findByTestId('saved-secret-access-account:account-outsider')).toBeNull();
        screen.pressByTestId('saved-secret-access-account:account-collaborator');

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            accounts: new Set(['account-collaborator']),
        }));
        expect(adminSearch).not.toHaveBeenCalled();
    });

    it('presents a truthful directory failure with a retry action', async () => {
        directoryFixture.accountFailure = true;
        const { SavedSecretGrantPicker, createEmptySavedSecretGrantDraft } = await import('./SavedSecretGrantPicker');
        const screen = await renderScreen(
            <SavedSecretGrantPicker
                scope={{ serverId: 'home-a', accountId: 'ordinary-owner' }}
                draft={createEmptySavedSecretGrantDraft()}
                onChange={vi.fn()}
            />,
        );
        await flushHookEffects();

        expect(screen.getTextContent()).toContain('Directory unavailable');
        screen.pressByTestId('saved-secret-access-directory-retry:account');
        expect(retry).toHaveBeenCalledWith('account');
        expect(adminSearch).not.toHaveBeenCalled();
    });

    it('offers Teams and Groups from the same collaboration directory and keeps a Group bound to its Team', async () => {
        directoryFixture.collaborationPrincipals = true;
        const { SavedSecretGrantPicker, createEmptySavedSecretGrantDraft } = await import('./SavedSecretGrantPicker');
        const onChange = vi.fn();
        const screen = await renderScreen(
            <SavedSecretGrantPicker
                scope={{ serverId: 'home-a', accountId: 'ordinary-owner' }}
                draft={createEmptySavedSecretGrantDraft()}
                onChange={onChange}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-team:team-acme')).toBeTruthy());
        screen.pressByTestId('saved-secret-access-team:team-acme');
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ teams: new Set(['team-acme']) }));

        // A Group id is unique only inside its Team, so selecting one has to
        // carry the Team it came from or the grant addresses nothing.
        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-group:team-acme:group-oncall')).toBeTruthy());
        screen.pressByTestId('saved-secret-access-group:team-acme:group-oncall');
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ groups: new Set(['group-oncall']) }));
        expect(adminSearch).not.toHaveBeenCalled();
    });

    it('shows principals that already hold access once, as current access rather than as candidates', async () => {
        const { SavedSecretGrantPicker, createEmptySavedSecretGrantDraft } = await import('./SavedSecretGrantPicker');
        const screen = await renderScreen(
            <SavedSecretGrantPicker
                scope={{ serverId: 'home-a', accountId: 'ordinary-owner' }}
                draft={createEmptySavedSecretGrantDraft()}
                onChange={vi.fn()}
                retainedAudience={{
                    accounts: [{
                        kind: 'account',
                        accountId: 'account-already-granted',
                        firstName: 'Already',
                        lastName: 'Granted',
                        username: null,
                        avatarUrl: null,
                    }],
                    teams: [],
                    groups: [],
                }}
            />,
        );

        await vi.waitFor(() => expect(screen.findByTestId('saved-secret-access-account:account-collaborator')).toBeTruthy());
        // One row only: a second, candidate row would offer to grant access
        // that this Account already holds.
        expect(screen.findAllHostsByTestId('saved-secret-access-account:account-already-granted')).toHaveLength(1);
    });

    it('offers to browse the rest of a directory page that has more results', async () => {
        directoryFixture.accountHasMore = true;
        const { SavedSecretGrantPicker, createEmptySavedSecretGrantDraft } = await import('./SavedSecretGrantPicker');
        const screen = await renderScreen(
            <SavedSecretGrantPicker
                scope={{ serverId: 'home-a', accountId: 'ordinary-owner' }}
                draft={createEmptySavedSecretGrantDraft()}
                onChange={vi.fn()}
            />,
        );
        await flushHookEffects();

        expect(screen.findByTestId('saved-secret-access-directory-browse:account')).toBeTruthy();
    });
});
