import * as React from 'react';
import { useRouter, type Href } from 'expo-router';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import {
    createSessionDiscussionDetailsTab,
    type SessionDiscussionDetailsTarget,
} from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import type { SessionMobileSurface } from '@/components/workspaceCockpit/session/sessionCockpitState';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useDeviceType } from '@/utils/platform/responsive';

export function buildSessionDiscussionRouteHref(input: Readonly<{
    target: SessionDiscussionDetailsTarget;
    sourceSurface: SessionMobileSurface;
}>): string {
    return buildScopedSessionRouteHref({
        sessionId: input.target.address.sessionId,
        serverId: input.target.address.serverId,
        suffix: input.target.kind === 'new'
            ? '/discussions/new'
            : `/discussions/${encodeURIComponent(input.target.discussionId)}`,
        query: { sourceSurface: input.sourceSurface },
    });
}

/**
 * Which discussion the Details workspace currently shows for this exact Session
 * address, read back from the canonical tab key the builder above spelled (Lane 05).
 *
 * Derived rather than tracked so the list cannot hold a second opinion about
 * what is open: a tab closed, replaced or activated by any other owner is
 * reflected immediately, and a tab belonging to another Home or Session — whose
 * raw ids may collide — never selects a row here.
 */
export function readOpenSessionDiscussionTargetKey(input: Readonly<{
    activeTabKey: string | null | undefined;
    address: SessionAddress;
}>): string | null {
    const prefix = `discussion:${sessionAddressKey(input.address)}:`;
    if (!input.activeTabKey?.startsWith(prefix)) return null;
    const targetKey = input.activeTabKey.slice(prefix.length);
    return targetKey.length > 0 ? targetKey : null;
}

/**
 * The one responsive Discussion navigation command (Lane 05). Desktop/tablet opens the
 * typed Details resource; phones use the thin route that renders the same
 * details component. The exact SessionAddress is carried through both paths.
 */
export function useOpenSessionDiscussion(input: Readonly<{
    address: SessionAddress;
    sourceSurface?: SessionMobileSurface;
}>): Readonly<{
    openNewDiscussion: () => void;
    openDiscussion: (discussionId: string, title?: string | null) => void;
    /**
     * `'new'`, a discussion id, or `null` — the retained selection a list row
     * renders while its Details resource is open. Always `null` on phones,
     * where the details screen is pushed rather than mounted beside the list.
     */
    activeDiscussionKey: string | null;
}> {
    const router = useRouter();
    const deviceType = useDeviceType();
    const pane = useAppPaneScope(createSessionPaneScopeId(input.address.sessionId, input.address.serverId));
    const sourceSurface = input.sourceSurface ?? 'collaboration';

    const openTarget = React.useCallback((
        target: SessionDiscussionDetailsTarget,
        title?: string | null,
    ) => {
        if (deviceType === 'phone') {
            router.push(buildSessionDiscussionRouteHref({ target, sourceSurface }) as Href);
            return;
        }
        pane.openDetailsTab(createSessionDiscussionDetailsTab({ ...target, title }), { intent: 'preview' });
    }, [deviceType, pane, router, sourceSurface]);

    const activeDiscussionKey = deviceType === 'phone' ? null : readOpenSessionDiscussionTargetKey({
        activeTabKey: pane.scopeState?.details.activeTabKey,
        address: input.address,
    });

    return React.useMemo(() => ({
        openNewDiscussion: () => openTarget({ kind: 'new', address: input.address }),
        openDiscussion: (discussionId: string, title?: string | null) => openTarget({
            kind: 'discussion',
            address: input.address,
            discussionId,
        }, title),
        activeDiscussionKey,
    }), [activeDiscussionKey, input.address, openTarget]);
}
