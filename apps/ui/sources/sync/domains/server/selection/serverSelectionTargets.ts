import { t } from '@/text';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import type { IconName } from '@/components/ui/icons/Icon';

import { isAllHomesSelectionTargetId } from './allHomesSelectionTarget';
import type { ServerSelectionTarget } from './serverSelectionTypes';

export function isAllHomesSelectionTarget(target: ServerSelectionTarget): boolean {
    return target.kind === 'group' && isAllHomesSelectionTargetId(target.groupId);
}

export function getServerSelectionTargetIconName(target: ServerSelectionTarget): IconName {
    return target.kind === 'group' ? 'stack' : 'hard-drives';
}

/** A target's name: "All Homes" for the virtual selection, else the Home's or group's own name. */
export function getServerSelectionTargetName(target: ServerSelectionTarget): string {
    return isAllHomesSelectionTarget(target) ? t('accountPopover.allHomes') : target.name;
}

export function getServerSelectionTargetSubtitle(target: ServerSelectionTarget): string {
    if (target.kind === 'group') {
        return isAllHomesSelectionTarget(target)
            ? t('accountPopover.allHomesSubtitle', { count: target.serverIds.length })
            : t('server.serverCount', { count: target.serverIds.length });
    }
    return toServerUrlDisplay(target.serverUrl);
}
