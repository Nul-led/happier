import * as React from 'react';

import { ManagedGitHubAppDetailContent } from '@/components/settings/home/githubApps/ManagedGitHubAppDetailScreen';
import type { ManagedGitHubAppSurface } from '@/components/settings/home/githubApps/managedGitHubAppSurface';
import { ManagedGitHubAppEditorContent } from '@/components/settings/home/githubApps/ManagedGitHubAppEditorScreen';
import { ManagedGitHubAppsSection } from '@/components/settings/home/githubApps/ManagedGitHubAppsSection';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import type { TeamSectionContext } from '../teamSectionContext';
import { teamAuthenticationPath, teamDirectoryPath, teamGitHubAppEditPath, teamGitHubAppPath, teamIdentityProviderSetupPath } from '../teamsRoutes';

/**
 * The Team binding of the shared GitHub App surface.
 *
 * A Team-owned App is the same registration record as a Home-owned one, read
 * and written through the same Actions; only the owner and the destinations
 * differ. Building the Team a second detail screen would mean two places that
 * decide what a verified installation is.
 */
export function teamGitHubAppSurface(context: TeamSectionContext): ManagedGitHubAppSurface {
    return {
        scope: context.scope,
        owner: { kind: 'team', teamId: context.address.teamId },
        mutationsAvailable: context.canMutate,
        onApprovalPending: context.requestApproval,
        routes: {
            detail: (registrationId) => teamGitHubAppPath(context.address, registrationId),
            edit: (registrationId) => teamGitHubAppEditPath(context.address, registrationId),
            signIn: teamAuthenticationPath(context.address),
            directory: teamDirectoryPath(context.address),
        },
    };
}

const Forbidden = React.memo(function Forbidden() {
    return (
        <ItemGroup>
            <Item testID="team-github-app-forbidden" title={t('teams.errors.forbidden')} showChevron={false} />
        </ItemGroup>
    );
});

export const TeamGitHubAppDetailScreen = React.memo(function TeamGitHubAppDetailScreen(props: Readonly<{
    serverId: string;
    teamId: string;
    registrationId: string;
}>) {
    return (
        <TeamSection serverId={props.serverId} teamId={props.teamId} title={t('identityAdministration.githubApps')} description={t('teams.pages.githubApp')}>
            {(context) => context.team.capabilities.manageAuthentication ? (
                <ManagedGitHubAppDetailContent
                    surface={teamGitHubAppSurface(context)}
                    registrationId={props.registrationId}
                />
            ) : <Forbidden />}
        </TeamSection>
    );
});

export const TeamGitHubAppEditorScreen = React.memo(function TeamGitHubAppEditorScreen(props: Readonly<{
    serverId: string;
    teamId: string;
    registrationId: string;
}>) {
    return (
        <TeamSection
            serverId={props.serverId}
            teamId={props.teamId}
            title={t('identityAdministration.githubAppEditTitle')}
            description={t('teams.pages.githubAppEdit')}
        >
            {(context) => context.team.capabilities.manageAuthentication ? (
                <ManagedGitHubAppEditorContent
                    surface={teamGitHubAppSurface(context)}
                    manifestReturn={{ kind: 'team', serverId: context.address.serverId, teamId: context.address.teamId }}
                    registrationId={props.registrationId}
                />
            ) : <Forbidden />}
        </TeamSection>
    );
});

/**
 * The Team's own GitHub App registrations, contributed to its Authentication
 * document.
 *
 * It exists because an App is registered before an installation is verified: a
 * Team admin who only saw the eligible-provider row would have a registered App
 * reported as "setup unavailable" with nowhere to finish it.
 */
export const TeamGitHubAppsSection = React.memo(function TeamGitHubAppsSection(props: Readonly<{
    context: TeamSectionContext;
    createAvailable: boolean;
}>) {
    return (
        <ManagedGitHubAppsSection
            surface={teamGitHubAppSurface(props.context)}
            createPath={teamIdentityProviderSetupPath(props.context.address, 'github_app_identity')}
            createAvailable={props.createAvailable}
        />
    );
});
