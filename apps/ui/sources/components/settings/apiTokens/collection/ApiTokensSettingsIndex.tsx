import * as React from 'react';
import { Redirect } from '@/components/appShell/workspace/destinationRoute';
import { useHappierCollectionIndexView } from '@happier-dev/plugin-ui/presentation';

import { ApiTokensSettingsScreen } from '../ApiTokensSettingsScreen';
import { useApiTokenSettingsControllerState } from '../useApiTokenSettingsControllerState';
import { apiTokenDetailPath, readLastVisitedApiToken, resolveApiTokenCollectionLanding } from './apiTokensCollection';
import { useApiTokenSettingsScopeController } from './ApiTokenSettingsScope';

/**
 * `/settings/account/api-tokens`. Beside the rail a token is always open, so the index lands on the
 * last opened or first one; where no rail shows, the index is the token list and each row pushes its
 * detail.
 */
export const ApiTokensSettingsIndex = React.memo(function ApiTokensSettingsIndex() {
    const view = useHappierCollectionIndexView();
    if (view === 'pending') return null;
    if (view === 'land') return <ApiTokenCollectionLanding />;
    return <ApiTokensSettingsScreen />;
});

const ApiTokenCollectionLanding = React.memo(function ApiTokenCollectionLanding() {
    const state = useApiTokenSettingsControllerState(useApiTokenSettingsScopeController());
    // Wait for the first list so "first token" is not a guess and the page does not flash first.
    if ((state.phase === 'idle' || state.phase === 'loading') && state.tokens.length === 0) return null;
    const landingId = resolveApiTokenCollectionLanding(state.tokens, readLastVisitedApiToken());
    if (landingId) return <Redirect href={apiTokenDetailPath(landingId) as never} />;
    return <ApiTokensSettingsScreen />;
});
