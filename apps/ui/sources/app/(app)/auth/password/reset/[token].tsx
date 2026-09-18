import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { NativeAuthPasswordResetScreen } from '@/components/account/auth/emailPassword/NativeAuthLandingScreens';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

/**
 * Public no-referrer landing for a Plain password reset link. Opening it only
 * previews the bearer; the exact reset transaction consumes it on submit.
 */
export default function NativeAuthPasswordResetRoute() {
    const params = useLocalSearchParams<{ token?: string | string[]; target?: string | string[] }>();
    return <NativeAuthPasswordResetScreen
        token={firstRouteParam(params.token) || null}
        homeTarget={firstRouteParam(params.target) || null}
    />;
}
