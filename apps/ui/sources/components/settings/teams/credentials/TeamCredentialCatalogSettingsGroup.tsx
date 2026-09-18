import * as React from 'react';
import type { TeamCredentialResourceCatalogEntryV1 } from '@happier-dev/protocol/teams';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { HomeTeamCredentialModelCatalog } from '@/hooks/teams/useHomeTeamCredentialModelCatalog';
import { t } from '@/text';

import {
    deliveryModeLabel,
    recipientDeliveryMode,
    resourceStateLabel,
    sourceKindLabel,
    teamCredentialRecoveryLabel,
    teamCredentialRecoveryPresentation,
} from './teamCredentialPresentation';

export const TeamCredentialCatalogSettingsGroup = React.memo(function TeamCredentialCatalogSettingsGroup(props: Readonly<{
    title: string;
    sourceKind: 'connected_service' | 'provider';
    catalog: HomeTeamCredentialModelCatalog;
    onOpen: (resource: TeamCredentialResourceCatalogEntryV1) => void;
}>) {
    const resources = React.useMemo(() => {
        const unique = new Map<string, TeamCredentialResourceCatalogEntryV1>();
        for (const resource of props.catalog.resources) {
            if (resource.sourcePresentation?.kind !== props.sourceKind) continue;
            unique.set(`${resource.teamId}:${resource.id}`, resource);
        }
        return [...unique.values()].sort((left, right) => (
            left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id)
        ));
    }, [props.catalog.resources, props.sourceKind]);

    if (resources.length === 0) return null;

    return (
        <ItemGroup title={props.title} footer={props.catalog.current ? undefined : t('teams.stale.label')}>
            {resources.map((resource) => {
                const resourceCurrent = props.catalog.currentResourceKeys.has(`${resource.teamId}:${resource.id}`);
                // The catalog row never decides who may repair a resource: every
                // navigable recovery opens the exact resource's own Settings, which
                // applies the Home's viewer decision. Recoveries without a
                // destination here — owner handoff, app update, choosing another
                // resource — keep the row visible and say what to do instead.
                const recovery = teamCredentialRecoveryPresentation(resource.recoveryAction);
                const canOpen = resourceCurrent;
                const teamName = props.catalog.teamNameById[resource.teamId] ?? t('teams.title');
                const state = resourceStateLabel(resource.readiness.kind);
                // A disabled row must still say why it cannot open and what its
                // recovery is; an openable row's destination is the recovery, so
                // the state alone is enough.
                const recoveryLabel = resourceCurrent && recovery !== null
                    ? teamCredentialRecoveryLabel(recovery)
                    : null;
                const mode = recipientDeliveryMode(resource);
                const delivery = mode ? deliveryModeLabel(mode) : null;
                const subtitle = [teamName, delivery, state, recoveryLabel].filter((part): part is string => Boolean(part)).join(' · ');
                return (
                    <Item
                        key={`${resource.teamId}:${resource.id}`}
                        testID={`team-credential-catalog-resource:${resource.teamId}:${resource.id}`}
                        title={resource.displayName}
                        subtitle={subtitle}
                        accessibilityLabel={[
                            resource.displayName,
                            teamName,
                            sourceKindLabel(resource.sourcePresentation),
                            delivery,
                            state,
                            recoveryLabel,
                        ].filter((part): part is string => Boolean(part)).join(', ')}
                        disabled={!canOpen}
                        onPress={canOpen ? () => props.onOpen(resource) : undefined}
                    />
                );
            })}
        </ItemGroup>
    );
});
