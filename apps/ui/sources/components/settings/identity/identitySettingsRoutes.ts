import type { SettingsRouteContext } from '@/components/settings/catalog/settingDeclarations';
import { homeAdministrationOverviewPath } from '@/components/settings/home/governance/homeAdministrationRoutes';
import { teamDetailPath } from '@/components/settings/teams/teamsRoutes';
import type { TeamAddress } from '@/sync/domains/teams/teamAddress';

/** Search never chooses one identity from an ambiguous route parameter. */
export function identitySettingParam(context: SettingsRouteContext, key: string): string | null {
    const value = context.params[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function identitySettingAtRoute(context: SettingsRouteContext, destination: string): string | null {
    return context.pathname === destination.split('?')[0] ? destination : null;
}

export function identitySettingHomeId(context: SettingsRouteContext): string | null {
    const serverId = identitySettingParam(context, 'serverId');
    if (!serverId) return null;
    const root = homeAdministrationOverviewPath(serverId);
    return context.pathname === root || context.pathname.startsWith(`${root}/`) ? serverId : null;
}

export function identitySettingTeamAddress(context: SettingsRouteContext): TeamAddress | null {
    const serverId = identitySettingParam(context, 'serverId');
    const teamId = identitySettingParam(context, 'teamId');
    if (!serverId || !teamId) return null;
    const address = { serverId, teamId };
    const root = teamDetailPath(address);
    return context.pathname === root || context.pathname.startsWith(`${root}/`) ? address : null;
}
