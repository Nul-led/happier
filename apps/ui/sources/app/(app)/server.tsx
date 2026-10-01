import * as React from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { HomeRecoveryAuthenticationFlow } from '@/components/account/auth/HomeRecoveryAuthenticationFlow';
import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { HOMES_ADD_ROUTE, HOMES_GROUP_NEW_ROUTE } from '@/components/settings/server/collection/homeCollectionModel';
import { parseServerSettingsRouteParams } from '@/components/settings/server/navigation/serverSettingsRouteParams';

type RouteParams = Record<string, string | string[]>;

/**
 * Where a `/server` link lands in Settings → Homes: a Home to add (`url`, from a notification, a
 * Personal Home setup or a link) opens the Add a Home draft with that address; a group to make opens
 * the new-group draft; anything else opens the Homes collection.
 */
function resolveForward(params: RouteParams): Readonly<{ pathname: string; params?: Record<string, string> }> {
    const route = parseServerSettingsRouteParams(params);
    if (route.url) {
        return {
            pathname: HOMES_ADD_ROUTE,
            params: {
                address: route.url,
                ...(route.auto ? { auto: '1' } : {}),
                ...(route.source ? { source: route.source } : {}),
            },
        };
    }
    if (route.groupEditor) {
        return { pathname: HOMES_GROUP_NEW_ROUTE, params: { groupServerIds: JSON.stringify(route.initialGroupServerIds) } };
    }
    return { pathname: SETTINGS_ROUTES.servers };
}

/**
 * `/server` is the entry many places link to (the phone header, the connection popover, notifications,
 * Team joins, setup). Home recovery (`recoveryProfile`) stays here as its own full-screen flow; every
 * other request opens its place in Settings → Homes.
 */
export default function ServerConfigRoute() {
    const params = useLocalSearchParams<RouteParams>();
    const recovery = React.useMemo(() => parseServerSettingsRouteParams(params).recovery, [params]);
    const handledRef = React.useRef(false);
    React.useEffect(() => {
        if (recovery || handledRef.current) return;
        handledRef.current = true;
        router.replace(resolveForward(params) as never);
    }, [params, recovery]);

    if (!recovery) return null;
    return (
        <HomeRecoveryAuthenticationFlow
            profileRef={recovery.profileRef}
            returnTo={recovery.returnTo}
            onAuthenticated={() => router.replace(recovery.returnTo as never)}
            onBack={() => router.replace(recovery.returnTo as never)}
        />
    );
}
