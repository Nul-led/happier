import * as React from 'react';

import { getServerSelectionTargetIconName, getServerSelectionTargetSubtitle } from '@/sync/domains/server/selection/serverSelectionTargets';
import type { ServerSelectionTarget } from '@/sync/domains/server/selection/serverSelectionTypes';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

export type ConnectionTargetStatusFact = Readonly<{ label: string }>;

type UseConnectionTargetActionsParams = Readonly<{
    targets: ReadonlyArray<ServerSelectionTarget>;
    activeTargetKey: string;
    onSelectTarget: (target: ServerSelectionTarget) => void;
    selectedColor: string;
    iconColor: string;
    statusByServerId?: Readonly<Record<string, ConnectionTargetStatusFact>>;
    focusedServerId?: string | null;
    defaultServerId?: string | null;
}>;

export function useConnectionTargetActions(params: UseConnectionTargetActionsParams) {
    return React.useMemo(() => {
        return params.targets.map((target) => {
            const targetKey = `${target.kind}:${target.id}`;
            const isSelected = targetKey === params.activeTargetKey;
            const facts = target.kind === 'server'
                ? [
                    getServerSelectionTargetSubtitle(target),
                    target.serverId === params.focusedServerId ? t('server.active') : null,
                    target.serverId === params.defaultServerId && target.serverId !== params.focusedServerId ? t('server.default') : null,
                    params.statusByServerId?.[target.serverId]?.label ?? null,
                ]
                : [getServerSelectionTargetSubtitle(target), isSelected ? t('server.active') : null];
            const visibleFacts = facts.filter((value): value is string => typeof value === 'string' && value.length > 0);
            return {
                id: `target-use-${target.kind}-${target.id}`,
                label: target.name,
                subtitle: visibleFacts.join(' · '),
                accessibilityLabel: [target.name, ...visibleFacts].join(', '),
                icon: (
                    <Icon
                        name={getServerSelectionTargetIconName(target)}
                        size={16}
                        color={params.iconColor}
                    />
                ),
                right: isSelected
                    ? <Icon name="check" size={16} color={params.selectedColor} />
                    : null,
                selected: isSelected,
                disabled: isSelected,
                onPress: () => {
                    params.onSelectTarget(target);
                },
            };
        });
    }, [params.activeTargetKey, params.defaultServerId, params.focusedServerId, params.iconColor, params.onSelectTarget, params.selectedColor, params.statusByServerId, params.targets]);
}
