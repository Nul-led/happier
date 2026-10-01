import * as React from 'react';

import { useRouter, type Href } from '@/components/appShell/workspace/destinationRoute';
import {
    readSessionComposerActionChipAvailable,
    requestRegisteredSessionComposerActionChip,
    subscribeSessionComposerPresentationTargets,
} from '@/components/sessions/presentation/sessionComposerPresentationTargets';
import { resolveSessionRoutePathForSurface } from '@/components/workspaceCockpit/session/sessionCockpitState';
import { useSessionCockpitSurfaceNavigation } from '@/components/workspaceCockpit/session/SessionCockpitSurfaceNavigation';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useDeviceType } from '@/utils/platform/responsive';

import { SESSION_GOAL_CHIP_KEY } from './sessionGoalChipKey';

/**
 * The Goal control's one external open entry (FIN 04 §5.5, X5).
 *
 * The Goal control is the session composer's goal chip and its popover; there is no second Goal
 * control. Any other surface — the Work tab's "+" › Keep going until done…, its Goal row — opens that
 * same popover by asking the exact Home/Session composer through the presentation-target registry. The
 * request waits for that composer when it is not on screen yet.
 */

/** Opens the Goal control of the exact session composer, or retains the request until it can. */
export function openSessionGoalControl(address: SessionAddress): boolean {
    return requestRegisteredSessionComposerActionChip(address, SESSION_GOAL_CHIP_KEY);
}

export type SessionGoalControlEntry = Readonly<{
    /** The session's composer offers the Goal control (it can hold a goal and this person may edit it). */
    available: boolean;
    open: () => void;
}>;

/**
 * The entry for surfaces beside or above a session. Beside the session the composer is on screen and
 * the popover opens in place; on a phone the composer is the session's Chat surface, which is shown
 * first so the request lands on it.
 */
export function useSessionGoalControlEntry(params: Readonly<{
    sessionId: string;
    serverId: string | null | undefined;
}>): SessionGoalControlEntry {
    const router = useRouter();
    const phone = useDeviceType() === 'phone';
    const cockpitNavigation = useSessionCockpitSurfaceNavigation();
    const { sessionId } = params;
    const serverId = params.serverId?.trim() || null;
    const readAvailable = React.useCallback(
        () => (serverId ? readSessionComposerActionChipAvailable({ serverId, sessionId }, SESSION_GOAL_CHIP_KEY) : false),
        [serverId, sessionId],
    );
    const available = React.useSyncExternalStore(subscribeSessionComposerPresentationTargets, readAvailable, readAvailable);

    const open = React.useCallback(() => {
        if (!serverId) return;
        const opened = openSessionGoalControl({ serverId, sessionId });
        if (opened || !phone) return;
        if (cockpitNavigation) {
            cockpitNavigation.switchSurface('chat');
            return;
        }
        router.push(resolveSessionRoutePathForSurface(sessionId, 'chat', { serverId }) as Href);
    }, [cockpitNavigation, phone, router, serverId, sessionId]);

    return React.useMemo(() => ({ available, open }), [available, open]);
}
