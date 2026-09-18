import * as React from 'react';

import { useServerFeaturesMainSelectionSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { useEffectiveServerSelection } from '@/hooks/server/useEffectiveServerSelection';
import { useFeatureLocalPolicySettings } from '@/hooks/server/useFeatureLocalPolicySettings';
import {
    resolveTeamsSettingsAdmission,
    type TeamsSettingsAdmission,
} from '@/sync/domains/teams/teamsSettingsAdmission';

export type { TeamsSettingsAdmission } from '@/sync/domains/teams/teamsSettingsAdmission';

/**
 * The Settings admission decision for the Teams destination.
 *
 * Teams is offered when the exact Home set the user is looking at contains at
 * least one Home whose canonical `teams` feature decision is enabled. The
 * returned per-Home entries let a partial multi-Home view keep its capable
 * Homes while explaining the offline or still-loading ones truthfully.
 *
 * This is one narrow runtime admission predicate, not a second authorization
 * language: direct routes still rely on the Home's own authorization.
 */
export function useTeamsSettingsAdmission(options?: Readonly<{ enabled?: boolean }>): TeamsSettingsAdmission {
    const enabled = options?.enabled ?? true;
    const settings = useFeatureLocalPolicySettings();
    const selection = useEffectiveServerSelection();
    const snapshot = useServerFeaturesMainSelectionSnapshot(selection.serverIds, { enabled });

    return React.useMemo(
        () => resolveTeamsSettingsAdmission({
            serverIds: snapshot.serverIds,
            snapshotsByServerId: snapshot.snapshotsByServerId,
            settings,
        }),
        [settings, snapshot],
    );
}
