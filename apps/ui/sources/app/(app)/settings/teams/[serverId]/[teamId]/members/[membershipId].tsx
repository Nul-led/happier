import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamMemberDetailScreen } from '@/components/settings/teams/members/TeamMemberDetailScreen';
import { TeamMemberEncryptionSection } from '@/components/settings/teams/members/TeamMemberEncryptionSection';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamMemberDetailRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        membershipId?: string | string[];
        groupId?: string | string[];
        accountId?: string | string[];
        prepareHistory?: string | string[];
    }>();
    const groupId = firstRouteParam(params.groupId);
    const groupAccountId = firstRouteParam(params.accountId);
    // Only the add journey that explicitly chose to include existing history arrives
    // with this. Every other way of opening a member waits to be asked.
    const prepareHistory = firstRouteParam(params.prepareHistory) === '1';
    return (
        <TeamMemberDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            membershipId={firstRouteParam(params.membershipId)}
            renderEncryptionSection={(context) => (
                <TeamMemberEncryptionSection
                    context={context}
                    autoStartPreparation={prepareHistory}
                    target={groupId && groupAccountId
                        ? { kind: 'group', teamGroupId: groupId, accountId: groupAccountId }
                        : undefined}
                />
            )}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamMemberDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamMemberDetailRoute} />; }
