import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { NativeAuthEmailVerifyScreen } from '@/components/account/auth/emailPassword/NativeAuthLandingScreens';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

/**
 * Public no-referrer landing for a native email verification link. The bearer
 * travels in the path so the shared capability redactor can template it
 * wherever a URL is logged; it is previewed read-only and never stored.
 */
export default function NativeAuthEmailVerifyRoute() {
    const params = useLocalSearchParams<{ token?: string | string[]; target?: string | string[]; purpose?: string | string[] }>();
    return <NativeAuthEmailVerifyScreen
        token={firstRouteParam(params.token) || null}
        homeTarget={firstRouteParam(params.target) || null}
        purpose={firstRouteParam(params.purpose) === 'account_service' ? 'account_service' : null}
    />;
}
