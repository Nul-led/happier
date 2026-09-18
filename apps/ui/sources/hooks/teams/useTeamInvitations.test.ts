import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

import { useTeamInvitations } from './useTeamInvitations';

const listTeamInvitations = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/teams/teamInvitationOperations', () => ({
    listTeamInvitations,
}));

describe('useTeamInvitations', () => {
    it('does not let a superseded Home answer replace the current delivery capability', async () => {
        let releaseFirst!: (value: unknown) => void;
        const first = new Promise((resolve) => { releaseFirst = resolve; });
        listTeamInvitations
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce({
                kind: 'succeeded',
                value: { items: [], nextCursor: null, emailDelivery: 'unavailable', linkDelivery: 'unavailable' },
            });

        const rendered = await renderHook(
            (props: Readonly<{ serverId: string }>) => useTeamInvitations({
                scope: { serverId: props.serverId, accountId: `account:${props.serverId}` },
                address: { serverId: props.serverId, teamId: 'team-1' },
                state: null,
                enabled: true,
            }),
            { initialProps: { serverId: 'home-a' } },
        );

        await rendered.rerender({ serverId: 'home-b' });
        await vi.waitFor(() => expect(rendered.getCurrent().emailDelivery).toBe('unavailable'));

        releaseFirst({
            kind: 'succeeded',
            value: { items: [], nextCursor: null, emailDelivery: 'available', linkDelivery: 'available' },
        });
        await Promise.resolve();

        expect(rendered.getCurrent().emailDelivery).toBe('unavailable');
        expect(rendered.getCurrent().linkDelivery).toBe('unavailable');
        await rendered.unmount();
    });
});
