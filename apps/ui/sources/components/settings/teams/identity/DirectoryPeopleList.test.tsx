import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const executeDirectoryMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
    useRouter: () => ({ push: routerPushMock }),
}));
vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/text', () => ({
    t: (key: string) => key,
}));
vi.mock('./identityAdministrationClient', () => ({
    createIdentityAdministrationClient: () => ({ executeDirectory: executeDirectoryMock }),
}));

import { DirectoryPeopleList } from './DirectoryPeopleList';

const scope = { serverId: 'home-1', accountId: 'account-1' } as const;
const address = { serverId: 'home-1', teamId: 'team-1' } as const;

beforeEach(() => {
    standardCleanup();
    executeDirectoryMock.mockReset();
    routerPushMock.mockReset();
});

describe('DirectoryPeopleList', () => {
    it('distinguishes provisioned people without Accounts from bound Team members', async () => {
        executeDirectoryMock.mockResolvedValue({
            ok: true,
            value: {
                items: [
                    {
                        v: 1,
                        id: 'person-unbound',
                        sourceId: 'source-1',
                        externalUserId: 'external-1',
                        displayName: 'Ada Provisioned',
                        email: 'ada@example.com',
                        externalLogin: null,
                        state: 'active',
                        accountBinding: { state: 'unbound' },
                        sourceLabel: 'Example directory',
                    },
                    {
                        v: 1,
                        id: 'person-bound',
                        sourceId: 'source-1',
                        externalUserId: 'external-2',
                        displayName: 'Grace Member',
                        email: 'grace@example.com',
                        externalLogin: null,
                        state: 'active',
                        accountBinding: {
                            state: 'bound',
                            accountId: 'account-grace',
                            teamMembershipId: 'membership-grace',
                        },
                        sourceLabel: 'Example directory',
                    },
                ],
                nextCursor: null,
            },
        });

        const screen = await renderScreen(
            <DirectoryPeopleList scope={scope} address={address} sourceId="source-1" />,
        );

        await vi.waitFor(() => {
            expect(screen.findByTestId('directory-person:person-unbound')).not.toBeNull();
        });
        const unbound = screen.findByTestId('directory-person:person-unbound');
        const bound = screen.findByTestId('directory-person:person-bound');
        expect(unbound?.props.detail).toBe('teams.authentication.directory.people.provisioned');
        expect(unbound?.props.onPress).toBeUndefined();
        expect(bound?.props.detail).toBe('teams.authentication.directory.people.member');

        screen.pressByTestId('directory-person:person-bound');
        expect(routerPushMock).toHaveBeenCalledWith(
            '/settings/teams/home-1/team-1/members/membership-grace',
        );
    });

    it('keeps provisioned people visible when a later page fails', async () => {
        executeDirectoryMock
            .mockResolvedValueOnce({
                ok: true,
                value: {
                    items: [{
                        v: 1,
                        id: 'person-1',
                        sourceId: 'source-1',
                        externalUserId: 'external-1',
                        displayName: null,
                        email: 'person@example.com',
                        externalLogin: 'person',
                        state: 'suspended',
                        accountBinding: { state: 'unbound' },
                        sourceLabel: 'Example directory',
                    }],
                    nextCursor: 'cursor-2',
                },
            })
            .mockResolvedValueOnce({
                ok: false,
                failure: { code: 'home_unreachable', retryable: true },
            });

        const screen = await renderScreen(
            <DirectoryPeopleList scope={scope} address={address} sourceId="source-1" />,
        );
        await vi.waitFor(() => expect(screen.findByTestId('directory-people-load-more')).not.toBeNull());

        await screen.pressByTestIdAsync('directory-people-load-more');

        await vi.waitFor(() => expect(screen.findByTestId('directory-people-retry')).not.toBeNull());
        expect(screen.findByTestId('directory-person:person-1')).not.toBeNull();
        expect(executeDirectoryMock.mock.calls[1]?.[1]).toMatchObject({ cursor: 'cursor-2' });
    });
});
