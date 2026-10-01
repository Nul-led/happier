import { describe, expect, it } from 'vitest';

import type { TeamsDirectoryRow } from '../teamsDirectoryViewState';

import {
    readTeamCredentialSourceHint,
    resolveSelectedTeamAddress,
    resolveTeamsCollectionLanding,
} from './teamsCollection';

function row(serverId: string, teamId: string): TeamsDirectoryRow {
    return {
        address: { serverId, teamId },
        homeName: serverId,
        team: { name: teamId } as TeamsDirectoryRow['team'],
    };
}

describe('resolveTeamsCollectionLanding', () => {
    it('lands on the Team visited last when it is still listed, otherwise on the first Team', () => {
        const rows = [row('home-a', 'one'), row('home-b', 'two')];
        expect(resolveTeamsCollectionLanding(rows, { serverId: 'home-b', teamId: 'two' })).toEqual({ serverId: 'home-b', teamId: 'two' });
        // The same Team id on another Home is a different Team.
        expect(resolveTeamsCollectionLanding(rows, { serverId: 'home-a', teamId: 'two' })).toEqual({ serverId: 'home-a', teamId: 'one' });
        expect(resolveTeamsCollectionLanding(rows, null)).toEqual({ serverId: 'home-a', teamId: 'one' });
        expect(resolveTeamsCollectionLanding([], null)).toBeNull();
    });
});

describe('resolveSelectedTeamAddress', () => {
    it('reads the Team a collection pathname is about, at any depth below it', () => {
        expect(resolveSelectedTeamAddress('/settings/teams/home-a/team-1')).toEqual({ serverId: 'home-a', teamId: 'team-1' });
        expect(resolveSelectedTeamAddress('/settings/teams/home%20a/team-1/members/m-2/')).toEqual({ serverId: 'home a', teamId: 'team-1' });
        expect(resolveSelectedTeamAddress('/settings/teams')).toBeNull();
        expect(resolveSelectedTeamAddress('/settings/teams/new')).toBeNull();
        expect(resolveSelectedTeamAddress('/settings/agents/claude')).toBeNull();
    });
});

describe('readTeamCredentialSourceHint', () => {
    it('reads a complete share-with-Team source and nothing partial', () => {
        expect(readTeamCredentialSourceHint({
            credentialSourceKind: 'connected_account',
            credentialSourceServerId: 'home-a',
            credentialSourcePluginId: 'plugin',
            credentialSourceLocalId: 'local',
            credentialSourceAccountId: 'acct',
        })).toEqual({
            kind: 'connected_account',
            serverId: 'home-a',
            account: { service: { pluginId: 'plugin', localId: 'local' }, accountId: 'acct' },
        });
        expect(readTeamCredentialSourceHint({
            credentialSourceKind: 'connected_pool',
            credentialSourceServerId: 'home-a',
            credentialSourcePluginId: 'plugin',
            credentialSourceLocalId: 'local',
            credentialSourceGroupId: 'group',
        })).toEqual({
            kind: 'connected_pool',
            serverId: 'home-a',
            service: { pluginId: 'plugin', localId: 'local' },
            groupId: 'group',
        });
        expect(readTeamCredentialSourceHint({
            credentialSourceKind: 'provider_connection',
            credentialSourceServerId: 'home-a',
            credentialSourceConnectionId: 'conn',
            credentialSourceSlotId: 'slot',
            credentialSourceMachineId: 'machine',
            credentialSourceConnectionSecurityFingerprint: 'fp',
        })).toEqual({
            kind: 'provider_connection',
            serverId: 'home-a',
            machineId: 'machine',
            connectionId: 'conn',
            credentialSlotId: 'slot',
            connectionSecurityFingerprint: 'fp',
        });
        expect(readTeamCredentialSourceHint({ credentialSourceKind: 'provider_connection', credentialSourceServerId: 'home-a' })).toBeNull();
        expect(readTeamCredentialSourceHint({})).toBeNull();
    });
});
