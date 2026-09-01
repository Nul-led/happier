import * as React from 'react';

import { getServerSelectionTargetSubtitle } from '@/sync/domains/server/selection/serverSelectionTargets';
import type { ServerSelectionTarget } from '@/sync/domains/server/selection/serverSelectionTypes';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

export type ConnectionTargetStatusFact = Readonly<{ label: string }>;

type UseConnectionTargetActionsParams = Readonly<{
    targets: ReadonlyArray<ServerSelectionTarget>;
    activeTargetKey: string;
    onSelectTarget: (target: ServerSelectionTarget) => void;
    selectedColor: string;
    statusByServerId?: Readonly<Record<string, ConnectionTargetStatusFact>>;
}>;

export function useConnectionTargetActions(params: UseConnectionTargetActionsParams) {
    return React.useMemo(() => {
        const serverNameCounts = new Map<string, number>();
        for (const target of params.targets) {
            if (target.kind !== 'server') continue;
            const key = target.name.trim().toLocaleLowerCase();
            serverNameCounts.set(key, (serverNameCounts.get(key) ?? 0) + 1);
        }

        return params.targets.map((target) => {
            const targetKey = `${target.kind}:${target.id}`;
            const isSelected = targetKey === params.activeTargetKey;
            const status = target.kind === 'server'
                ? params.statusByServerId?.[target.serverId]?.label ?? t('status.unknown')
                : getServerSelectionTargetSubtitle(target);
            const duplicateNameDisambiguator = target.kind === 'server'
                && (serverNameCounts.get(target.name.trim().toLocaleLowerCase()) ?? 0) > 1
                    ? getServerSelectionTargetSubtitle(target)
                    : null;
            return {
                id: `target-use-${target.kind}-${target.id}`,
                label: target.name,
                subtitle: status,
                accessibilityLabel: [target.name, status, duplicateNameDisambiguator].filter(Boolean).join(', '),
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
    }, [params.activeTargetKey, params.onSelectTarget, params.selectedColor, params.statusByServerId, params.targets]);
}
