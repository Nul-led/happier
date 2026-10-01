import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import { ExternalSessionsIntegrationSection } from './ExternalSessionsIntegrationSection';
import type {
    ExternalSessionsAutoLinkSourceDescriptor,
    ExternalSessionsIntegrationDescriptor,
    ExternalSessionsIntegrationOperations,
    ExternalSessionsQualifiedAgent,
} from './externalSessionsIntegrationModel';
import type {
    ExternalSessionsIntegrationInventoryState,
} from './externalSessionsIntegrationController';
import { Icon } from '@/components/ui/icons/Icon';

export const ExternalSessionsAgentSettingsSection = React.memo(function ExternalSessionsAgentSettingsSection(
    props: Readonly<{
        machineId: string | null;
        agent: ExternalSessionsQualifiedAgent | null;
        agentTitle: string;
        integrations: readonly ExternalSessionsIntegrationDescriptor[] | null;
        autoLinkSources: readonly ExternalSessionsAutoLinkSourceDescriptor[] | null;
        operations?: ExternalSessionsIntegrationOperations | null;
        inventoryState?: ExternalSessionsIntegrationInventoryState;
        onRetryInventory?: (() => void | Promise<void>) | null;
        hasMoreInventory?: boolean;
        loadingMoreInventory?: boolean;
        onLoadMoreInventory?: (() => void | Promise<void>) | null;
        onBrowse: (() => void) | null;
        onManageAll: () => void;
    }>,
) {
    return (
        <>
            <ExternalSessionsIntegrationSection
                integrations={props.integrations}
                autoLinkSources={props.autoLinkSources}
                machineId={props.machineId}
                agent={props.agent}
                agentTitle={props.agentTitle}
                operations={props.operations}
                inventoryState={props.inventoryState}
                onRetryInventory={props.onRetryInventory}
                hasMoreInventory={props.hasMoreInventory}
                loadingMoreInventory={props.loadingMoreInventory}
                onLoadMoreInventory={props.onLoadMoreInventory}
            />
            {/* On an agent's page, browsing and managing its external sessions are its integrations. */}
            <ItemGroup title={t('settingsAgents.detailPage.integrationsTitle')}>
                {props.onBrowse ? (
                    <Item
                        testID="settings-external-sessions-agent-browse"
                        icon={<Icon name="folder-open" />}
                        title={t('externalSessions.settingsAgentBrowseTitle', { agent: props.agentTitle })}
                        onPress={props.onBrowse}
                    />
                ) : null}
                <Item
                    testID="settings-external-sessions-manage-all"
                    icon={<Icon name="sliders-horizontal" />}
                    title={t('externalSessions.settingsManageAllTitle')}
                    subtitle={t('externalSessions.settingsManageAllSubtitle')}
                    onPress={props.onManageAll}
                />
            </ItemGroup>
        </>
    );
});
