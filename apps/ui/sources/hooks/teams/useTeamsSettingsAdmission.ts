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
 * Teams is offered when the target Home set contains at least one Home whose
 * canonical `teams` feature decision is enabled. The returned per-Home entries
 * let a partial multi-Home view keep its capable Homes while explaining the
 * offline or still-loading ones truthfully.
 *
 * The target set is the user's Home view selection by default, which is what a
 * Settings destination is about. A surface addressed to one exact Home names it
 * through `serverIds`: that Home is the subject of the screen, so admission is
 * decided for it whether or not it happens to be in the current view selection.
 *
 * This is one narrow runtime admission predicate, not a second authorization
 * language: direct routes still rely on the Home's own authorization.
 */
export function useTeamsSettingsAdmission(options?: Readonly<{
    enabled?: boolean;
    /**
     * The exact Homes this admission is about. Absent means the user's current
     * Home view selection.
     */
    serverIds?: readonly string[];
}>): TeamsSettingsAdmission {
    const enabled = options?.enabled ?? true;
    const settings = useFeatureLocalPolicySettings();
    const selection = useEffectiveServerSelection();
    const targetServerIds = options?.serverIds ?? selection.serverIds;
    const snapshot = useServerFeaturesMainSelectionSnapshot(targetServerIds, { enabled });

    return React.useMemo(
        () => resolveTeamsSettingsAdmission({
            serverIds: snapshot.serverIds,
            snapshotsByServerId: snapshot.snapshotsByServerId,
            settings,
        }),
        [settings, snapshot],
    );
}
