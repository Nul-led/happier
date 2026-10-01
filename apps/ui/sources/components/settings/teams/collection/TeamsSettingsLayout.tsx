import * as React from 'react';
import { usePathname } from '@/components/appShell/workspace/destinationRoute';
import { useHappierCollectionVisit } from '@happier-dev/plugin-ui/presentation';

import { resolveSettingsNestedRouteName } from '@/components/settings/navigation/settingsRouteRegistry';
import { SettingsCollectionLayout } from '@/components/settings/shell/SettingsCollectionLayout';
import { teamAddressKey } from '@/sync/domains/teams/teamAddress';

import { TeamsCollectionRail } from './TeamsCollectionRail';
import { recordTeamsCollectionVisit, resolveSelectedTeamAddress } from './teamsCollection';

/** Rail width at normal text scale: a Team mark, a name and one role · Home line. */
const TEAMS_RAIL_WIDTH_PX = 264;
/** The narrowest Team page that still fits a field or segmented row beside its label. */
const TEAMS_DETAIL_MIN_WIDTH_PX = 480;

function resolveTeamsChildRoute(pathname: string): string {
    return resolveSettingsNestedRouteName('teams', pathname) ?? 'index';
}

/**
 * Teams as a collection beside the open Team. Wide: the Teams rail beside the Team's pages. Narrow:
 * the Team pages alone, whose index lists the Teams and pushes each one.
 */
export const TeamsSettingsLayout = React.memo(function TeamsSettingsLayout() {
    // Beside the rail and in the pushed list alike, the opened Team is what a wide collection lands on.
    useHappierCollectionVisit(recordTeamsCollectionVisit, resolveSelectedTeamAddress(usePathname().replace(/\/+$/, '')), teamAddressKey);
    return (
        <SettingsCollectionLayout
            navigator="teams"
            rootPathname="/settings/teams"
            resolveChildRoute={resolveTeamsChildRoute}
            rail={<TeamsCollectionRail />}
            railWidthPx={TEAMS_RAIL_WIDTH_PX}
            detailMinWidthPx={TEAMS_DETAIL_MIN_WIDTH_PX}
            testID="settings-teams"
        />
    );
});
