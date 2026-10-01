import * as React from 'react';
import { useGlobalSearchParams } from '@/components/appShell/workspace/destinationRoute';
import { useIsFocused } from '@/components/appShell/workspace/destinationRoute';

import { SettingsCollectionLayout } from '@/components/settings/shell/SettingsCollectionLayout';

import { ProviderConnectionsSettingsScreen, PROVIDERS_COLLECTION_ROUTE } from './ProviderConnectionsSettingsScreen';

/** Rail width at normal text scale: a provider mark, a name and one status line. */
const PROVIDER_RAIL_WIDTH_PX = 272;
/** The narrowest detail that still fits a field select beside its label. */
const PROVIDER_DETAIL_MIN_WIDTH_PX = 480;

function resolveProvidersChildRoute(pathname: string): string {
    if (pathname === PROVIDERS_COLLECTION_ROUTE) return 'index';
    if (pathname === `${PROVIDERS_COLLECTION_ROUTE}/new`) return 'new';
    return pathname.endsWith('/models') ? '[connectionId]/models' : '[connectionId]';
}

/**
 * Providers as a collection beside the selected connection. Wide: the provider rail beside the
 * detail stack. Narrow: the detail stack alone, whose index page lists the providers and pushes
 * their detail; an open editor keeps its draft across the change.
 */
export const ProviderSettingsLayout = React.memo(function ProviderSettingsLayout() {
    return (
        <SettingsCollectionLayout
            navigator="providers"
            rootPathname={PROVIDERS_COLLECTION_ROUTE}
            resolveChildRoute={resolveProvidersChildRoute}
            rail={<ProviderCollectionRail />}
            railWidthPx={PROVIDER_RAIL_WIDTH_PX}
            detailMinWidthPx={PROVIDER_DETAIL_MIN_WIDTH_PX}
            testID="settings-providers"
        />
    );
});

/** The rail beside a provider's detail; it reads while the Providers navigator is focused. */
const ProviderCollectionRail = React.memo(function ProviderCollectionRail() {
    const focused = useIsFocused();
    const params = useGlobalSearchParams<{ connectionId?: string | string[] }>();
    const connectionId = Array.isArray(params.connectionId) ? params.connectionId[0] : params.connectionId;
    return (
        <ProviderConnectionsSettingsScreen
            variant="rail"
            active={focused}
            selectedConnectionId={connectionId ?? null}
        />
    );
});
