import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a Team wrapper owes the operation that was deferred.
 *
 * Every Lane 01 mutation whose success carries data the initiating journey
 * still needs — a new Team or Group id, a membership to prepare history at —
 * must finish with the Home's own answer when an explicit UI-approval
 * requirement turns it into a durable approval request. Invitation creation
 * and reissue are the deliberate exception, on live-only custody, and the last
 * case here holds that line.
 * The shared front door owns the approval lifecycle and the binding; what these
 * cases pin is the wrappers' half of it:
 *
 *  - the caller's result handler actually reaches the front door, so the
 *    registration is upgraded from a bare Artifact id to a continuation;
 *  - the wrapper's own post-success work — publishing the Home's row into the
 *    one Team/Group projection, invalidating the sequences a mutation moved,
 *    re-reading the exact Team after an admission — happens on the deferred
 *    path exactly as it does on the immediate one, so an approved mutation is
 *    not a half-settled one;
 *  - settlement never redispatches the mutation, because the Home already
 *    performed it when the approval was granted.
 */

const runTeamActionMock = vi.hoisted(() => vi.fn());
const applyTeamProjectionMock = vi.hoisted(() => vi.fn());
const applyTeamGroupProjectionMock = vi.hoisted(() => vi.fn());
const invalidateTeamGroupsForTeamMock = vi.hoisted(() => vi.fn());
const refreshTeamMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('./teamActionClient', () => ({
    runTeamAction: runTeamActionMock,
}));
vi.mock('@/sync/store/teams/teamsSnapshots', () => ({
    applyTeamProjection: applyTeamProjectionMock,
    applyTeamGroupProjection: applyTeamGroupProjectionMock,
    invalidateTeamGroupsForTeam: invalidateTeamGroupsForTeamMock,
}));
vi.mock('@/sync/engine/teams/teamsDirectoryEngine', () => ({
    refreshTeam: refreshTeamMock,
}));

import { createTeamGroup, addTeamGroupMember } from './teamGroupOperations';
import { addTeamMember } from './teamMemberOperations';
import { createTeam } from './teamOperations';
import { createTeamInvitation, reissueTeamInvitation } from './teamInvitationOperations';

const SCOPE = Object.freeze({ serverId: 'home-1', accountId: 'account-ada' });
const ADDRESS = Object.freeze({ serverId: 'home-1', teamId: 'team-1' });

const TEAM = Object.freeze({ id: 'team-new', name: 'Design' });
const GROUP = Object.freeze({ id: 'group-new', name: 'Design' });
const MEMBERSHIP = Object.freeze({ id: 'membership-grace', accountId: 'account-grace' });
const GROUP_MEMBER_ADDED = Object.freeze({ status: 'added' as const });
const GROUP_MEMBER_UNCHANGED = Object.freeze({ status: 'unchanged' as const });
const INVITATION = Object.freeze({
    invitation: { id: 'invitation-1' },
    joinUrl: `https://home-a.example/join/${'a'.repeat(43)}`,
});
const REISSUE = Object.freeze({
    replacement: { id: 'invitation-2' },
    joinUrl: `https://home-a.example/join/${'b'.repeat(43)}`,
});

/**
 * Stands in for the shared front door having created an approval Artifact.
 *
 * It captures the handlers the wrapper passed down and throws the pending
 * error the real client throws, so a case can settle the deferred answer
 * afterwards exactly as the mounted continuation would.
 */
type Deferred = Readonly<{
    settle: (value: unknown) => Promise<void>;
    refuse: (code: string) => void;
}>;

function deferNextAction(): { readonly captured: Deferred | null } {
    const holder: { captured: Deferred | null } = { captured: null };
    runTeamActionMock.mockImplementationOnce(async (params: Readonly<{
        onApprovalSucceeded?: (value: unknown) => void | Promise<void>;
        onApprovalFailed?: (code: string) => void;
    }>) => {
        holder.captured = params.onApprovalSucceeded || params.onApprovalFailed
            ? {
                settle: async (value: unknown) => { await params.onApprovalSucceeded?.(value); },
                refuse: (code: string) => params.onApprovalFailed?.(code),
            }
            : null;
        throw new Error('team_action_approval_pending');
    });
    return holder;
}

async function expectDeferred(operation: Promise<unknown>): Promise<void> {
    await expect(operation).rejects.toThrow('team_action_approval_pending');
}

beforeEach(() => {
    runTeamActionMock.mockReset();
    applyTeamProjectionMock.mockReset();
    applyTeamGroupProjectionMock.mockReset();
    invalidateTeamGroupsForTeamMock.mockReset();
    refreshTeamMock.mockClear();
});

describe('deferred Team mutation results', () => {
    it('publishes an approved Team creation under the id only its answer carries', async () => {
        const deferred = deferNextAction();
        const received: unknown[] = [];

        await expectDeferred(createTeam({
            scope: SCOPE,
            name: 'Design',
            description: null,
            requestKey: 'key-1',
            onApprovalSucceeded: (team) => { received.push(team); },
        }));

        // Nothing is published before the approval is decided.
        expect(applyTeamProjectionMock).not.toHaveBeenCalled();
        await deferred.captured!.settle(TEAM);

        // The new Team's id exists only in this answer, so the projection is
        // addressed by it rather than by an address the caller never had.
        expect(applyTeamProjectionMock).toHaveBeenCalledWith(expect.objectContaining({
            scope: SCOPE,
            address: { serverId: 'home-1', teamId: 'team-new' },
            team: TEAM,
        }));
        expect(received).toEqual([TEAM]);
        // The Home created the Team when the approval was granted; settling it
        // must never send the mutation a second time.
        expect(runTeamActionMock).toHaveBeenCalledTimes(1);
    });

    it('publishes an approved Group creation and marks the sequences it moved', async () => {
        const deferred = deferNextAction();
        const received: unknown[] = [];

        await expectDeferred(createTeamGroup({
            scope: SCOPE,
            address: ADDRESS,
            name: 'Design',
            description: null,
            requestKey: 'key-1',
            onApprovalSucceeded: (group) => { received.push(group); },
        }));
        await deferred.captured!.settle(GROUP);

        expect(applyTeamGroupProjectionMock).toHaveBeenCalledWith(expect.objectContaining({
            scope: SCOPE,
            address: ADDRESS,
            group: GROUP,
        }));
        expect(invalidateTeamGroupsForTeamMock).toHaveBeenCalledWith(SCOPE, ADDRESS);
        expect(received).toEqual([GROUP]);
        expect(runTeamActionMock).toHaveBeenCalledTimes(1);
    });

    it('re-reads the exact Team behind an approved admission before the caller acts', async () => {
        const deferred = deferNextAction();
        const received: unknown[] = [];

        await expectDeferred(addTeamMember({
            scope: SCOPE,
            address: ADDRESS,
            accountId: 'account-grace',
            role: 'member',
            historyAccess: 'all_existing',
            onApprovalSucceeded: (membership) => { received.push(membership); },
        }));
        expect(refreshTeamMock).not.toHaveBeenCalled();
        await deferred.captured!.settle(MEMBERSHIP);

        // An admission can move the viewer's own Team capabilities, and the
        // membership id it answers with is where the history journey continues.
        expect(refreshTeamMock).toHaveBeenCalledWith(SCOPE, ADDRESS);
        expect(received).toEqual([MEMBERSHIP]);
        expect(runTeamActionMock).toHaveBeenCalledTimes(1);
    });

    it('keeps an approved Group contribution truthful about whether it changed anything', async () => {
        const added = deferNextAction();
        const addedResults: unknown[] = [];
        await expectDeferred(addTeamGroupMember({
            scope: SCOPE,
            address: ADDRESS,
            groupId: 'group-1',
            accountId: 'account-grace',
            historyAccess: 'all_existing',
            onApprovalSucceeded: (result) => { addedResults.push(result); },
        }));
        await added.captured!.settle(GROUP_MEMBER_ADDED);

        expect(invalidateTeamGroupsForTeamMock).toHaveBeenCalledWith(SCOPE, ADDRESS);
        expect(addedResults).toEqual([GROUP_MEMBER_ADDED]);

        invalidateTeamGroupsForTeamMock.mockClear();
        const unchanged = deferNextAction();
        const unchangedResults: unknown[] = [];
        await expectDeferred(addTeamGroupMember({
            scope: SCOPE,
            address: ADDRESS,
            groupId: 'group-1',
            accountId: 'account-grace',
            historyAccess: 'from_membership',
            onApprovalSucceeded: (result) => { unchangedResults.push(result); },
        }));
        await unchanged.captured!.settle(GROUP_MEMBER_UNCHANGED);

        // A truthful zero-effect answer changed nothing on the Home, so it must
        // not cost every holder of these rows a re-read — approved or not.
        expect(invalidateTeamGroupsForTeamMock).not.toHaveBeenCalled();
        expect(unchangedResults).toEqual([GROUP_MEMBER_UNCHANGED]);
    });

    /**
     * The two bearer-carrying answers deliberately do NOT join the deferred
     * family.
     *
     * They are declared live-only custody: the raw link returns to the live
     * invocation and the durable Artifact retains only the safe observation
     * projection, so there is nothing a later continuation could hand back. A
     * wrapper that quietly registered one would be asking the platform to keep
     * a re-readable secret, which is the exact property this domain refuses.
     * What they carry instead is the caller's mount lifetime.
     */
    it('keeps invitation creation and reissue on live-only custody, never a continuation', async () => {
        runTeamActionMock.mockResolvedValueOnce({ kind: 'succeeded', value: INVITATION });
        const lifetime = new AbortController();
        await createTeamInvitation({
            scope: SCOPE,
            address: ADDRESS,
            role: 'member',
            historyAccess: 'from_membership',
            recipientEmail: null,
            requestKey: 'key-1',
            signal: lifetime.signal,
        });

        runTeamActionMock.mockResolvedValueOnce({ kind: 'succeeded', value: REISSUE });
        await reissueTeamInvitation({
            scope: SCOPE,
            address: ADDRESS,
            invitationId: 'invitation-1',
            recipientEmail: null,
            requestKey: 'key-2',
            signal: lifetime.signal,
        });

        for (const call of runTeamActionMock.mock.calls) {
            const params = call[0] as Readonly<Record<string, unknown>>;
            // The invocation is what the approval waits on, and losing it is
            // what cancels the wait — so the lifetime travels and no result
            // handler does.
            expect(params.signal).toBe(lifetime.signal);
            expect(params.onApprovalSucceeded).toBeUndefined();
            expect(params.onApprovalFailed).toBeUndefined();
        }
        expect(runTeamActionMock).toHaveBeenCalledTimes(2);
    });

    it('carries a refusal back as the operations own typed code, not as success', async () => {
        const deferred = deferNextAction();
        const succeededWith: unknown[] = [];
        const refusals: string[] = [];

        await expectDeferred(createTeam({
            scope: SCOPE,
            name: 'Design',
            description: null,
            requestKey: 'key-1',
            onApprovalSucceeded: (team) => { succeededWith.push(team); },
            onApprovalFailed: (code) => { refusals.push(code); },
        }));
        deferred.captured!.refuse('approval_rejected');

        expect(refusals).toEqual(['approval_rejected']);
        expect(succeededWith).toEqual([]);
        // A refused mutation changed nothing, so no projection may claim it did.
        expect(applyTeamProjectionMock).not.toHaveBeenCalled();
        expect(runTeamActionMock).toHaveBeenCalledTimes(1);
    });

    it('leaves a wrapper without result handlers registering nothing to settle', async () => {
        const deferred = deferNextAction();

        await expectDeferred(createTeamGroup({
            scope: SCOPE,
            address: ADDRESS,
            name: 'Design',
            description: null,
            requestKey: 'key-1',
        }));

        // The existing non-result-bearing contract is preserved: a caller that
        // asked for nothing still registers only its Artifact id.
        expect(deferred.captured).toBeNull();
    });
});
