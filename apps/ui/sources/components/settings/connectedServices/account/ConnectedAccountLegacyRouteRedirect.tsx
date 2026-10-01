import * as React from 'react';
import { useLocalSearchParams, useRouter } from '@/components/appShell/workspace/destinationRoute';

import { useProjectedConnectedServicesRegistry } from '@/components/appShell/plugins/AppShellPluginUiProjection';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import {
    buildConnectedAccountSettingsRoute,
    readConnectedAccountAddRequest,
    resolveConnectedAccountSettingsRoute,
} from '@/sync/domains/connectedServices/connectedAccountSettingsRoute';
import { t } from '@/text';

/**
 * Translation-only ingress for released scalar built-in settings links.
 * It performs no account read or mutation and replaces the URL with the
 * qualified route as soon as the projected owner is available.
 */
export const ConnectedAccountLegacyRouteRedirect = React.memo(
    function ConnectedAccountLegacyRouteRedirect() {
        const params = useLocalSearchParams();
        const router = useRouter();
        const registry = useProjectedConnectedServicesRegistry();
        const addRequested = readConnectedAccountAddRequest(params);
        const resolved = React.useMemo(
            () => resolveConnectedAccountSettingsRoute(
                {
                    serviceId: params.serviceId,
                    profileId: params.profileId,
                    groupId: params.groupId,
                },
                registry.entries,
            ),
            [params.groupId, params.profileId, params.serviceId, registry.entries],
        );

        React.useEffect(() => {
            if (!resolved) return;
            router.replace(buildConnectedAccountSettingsRoute(
                resolved.service,
                resolved.focus,
                { add: addRequested },
            ));
        }, [addRequested, resolved, router]);

        return (
            <ItemList>
                <ItemGroup title={t('connectedServices.title')}>
                    <Item
                        title={resolved || registry.status === 'loading'
                            ? t('common.loading')
                            : t('connectedServices.detail.unknownService')}
                        mode="info"
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    },
);
