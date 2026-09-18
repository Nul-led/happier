import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestHomeDomainMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/api/home/homeServerActionTransport', () => ({ requestHomeDomain: requestHomeDomainMock }));

import {
    listTeamCredentialDirectMaterialPreparation,
} from './teamCredentialOperations';

const scope = { serverId: 'home-1', accountId: 'account-owner' } as const;

beforeEach(() => requestHomeDomainMock.mockReset());

describe('Team credential direct-material user intents', () => {
    it('reads the material-safe source-owner census from the resource domain', async () => {
        requestHomeDomainMock.mockResolvedValueOnce({
            ok: true,
            value: { resourceRevision: 7, sourceOwner: true, recipients: [], nextCursor: null },
        });

        await listTeamCredentialDirectMaterialPreparation({
            scope,
            teamId: 'team /1',
            resourceId: 'resource?/1',
            cursor: 'next +/page',
        });

        expect(requestHomeDomainMock).toHaveBeenCalledWith(expect.objectContaining({
            scope,
            path: '/v2/teams/team%20%2F1/credential-resources/resource%3F%2F1/direct-material?view=census&cursor=next+%2B%2Fpage',
            method: 'GET',
            effect: 'read',
            input: undefined,
        }));
    });

});
