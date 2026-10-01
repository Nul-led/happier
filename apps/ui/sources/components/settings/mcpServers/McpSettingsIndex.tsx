import * as React from 'react';
import { Redirect, useRouter } from '@/components/appShell/workspace/destinationRoute';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { AddMcpServerMenu } from './collection/AddMcpServerMenu';
import { McpServerCollection } from './collection/McpServerCollection';
import {
    buildMcpServerCollection,
    mcpServerRoute,
    resolveMcpServerLandingId,
} from './collection/mcpServerCollectionModel';
import { useMcpServersSettings } from './useMcpServersSettings';
import { useHappierCollectionIndexView } from '@happier-dev/plugin-ui/presentation';

/**
 * `/settings/mcp`. Beside the rail a server is always selected, so the index lands on one; with no
 * server yet it invites adding the first. Where no rail shows, the index is the server list.
 */
export const McpSettingsIndex = React.memo(function McpSettingsIndex() {
    const view = useHappierCollectionIndexView();
    if (view === 'pending') return null;
    if (view === 'land') return <McpCollectionLanding />;
    return <McpServerCollection variant="page" />;
});

const McpCollectionLanding = React.memo(function McpCollectionLanding() {
    const router = useRouter();
    const { settings } = useMcpServersSettings();
    const rows = React.useMemo(() => buildMcpServerCollection(settings, ''), [settings]);
    const navigate = React.useCallback((href: string) => {
        const result = runGuardedNavigation(() => router.replace(href as never));
        if (result !== true) fireAndForget(result, { tag: 'McpCollectionLanding.navigate' });
    }, [router]);

    const landingId = resolveMcpServerLandingId(rows);
    if (landingId) return <Redirect href={mcpServerRoute(landingId) as never} />;

    return (
        <ItemList presentation="page">
            <EmptyState
                testID="settings.mcpServers.invitation"
                layout="page"
                variant="add"
                iconName="puzzle-piece"
                title={t('mcpSettings.landingTitle')}
                subtitle={t('mcpSettings.landingDescription')}
                // One way to add: its menu holds every way (configure, paste JSON, from this
                // machine, presets), the same menu as the rail's "+".
                action={(
                    <AddMcpServerMenu
                        onAdd={navigate}
                        renderTrigger={(toggle) => (
                            <RoundButton
                                testID="settings.mcpServers.invitation.add"
                                size="normal"
                                title={t('mcpSettings.add')}
                                onPress={toggle}
                            />
                        )}
                    />
                )}
            />
        </ItemList>
    );
});
