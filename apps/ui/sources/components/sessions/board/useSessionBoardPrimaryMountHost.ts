import * as React from 'react';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { usePaneFocusMode } from '@/components/appShell/panes/focusMode/usePaneFocusMode';
import { useSessionCompanionPlacement } from '@/components/sessions/companion/layout/useSessionCompanionPlacement';
import { useSessionCompanionPreference } from '@/components/sessions/companion/state/useSessionCompanionPreference';
import { useSessionScreenIsFocused } from '@/components/sessions/shell/useSessionScreenIsFocused';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import {
    isGenericSessionBoardVisibleInDetails,
    isSessionBoardVisibleInDetails,
    listVisibleSessionBoardDetailsExpandedItemIds,
} from './sessionBoardDetailsVisibility';
import {
    resolveSessionBoardItemPrimaryMountHost,
    resolveSessionBoardHostVisibility,
    type SessionBoardHostVisibility,
    type SessionBoardPlacementPrimaryMountResolver,
} from './sessionBoardHostVisibility';

/**
 * The one hook every Board placement calls to learn which placement runs an
 * executable item.
 *
 * It reads the same canonical facts for every caller — pane scope state, the
 * viewer-local Companion placement and (for the Cockpit) the current mobile
 * Session surface — so Details, the compact sidebar, the Companion rail and the
 * mobile Board cannot reach different answers. No placement self-appoints from
 * its own visibility, and nothing is stored: this is a derivation, not an arbiter.
 */
export function useSessionBoardHostVisibility(input: Readonly<{
    address: SessionAddress | null;
    paneScopeId: string;
    /** Retained Session shells must explicitly say whether this exact surface is presented. */
    presented?: boolean;
    /** The Cockpit's current Session surface, when this shell is the Cockpit. */
    mobileSurface?: 'board' | 'companion' | null;
}>): SessionBoardHostVisibility {
    const pane = useAppPaneScope(input.paneScopeId);
    const paneFocusMode = usePaneFocusMode(input.paneScopeId);
    const foreground = useSessionScreenIsFocused() && input.presented !== false;
    const companionPlacement = useSessionCompanionPlacement({
        sessionId: input.address?.sessionId ?? null,
        serverId: input.address?.serverId ?? null,
        paneScopeId: input.paneScopeId,
    });
    const scopeState = pane.scopeState;

    return resolveSessionBoardHostVisibility({
        foreground,
        panes: scopeState
            ? {
                detailsOpen: scopeState.details?.isOpen === true,
                // The typed Details-workspace view, split groups included — not a
                // guess from "Details is open".
                detailsShowsBoard: isSessionBoardVisibleInDetails(scopeState.details),
                // Only the generic Board grid can draw an arbitrary item; an expanded
                // `board:<itemId>` tab draws exactly one.
                detailsShowsGenericBoard: isGenericSessionBoardVisibleInDetails(scopeState.details),
                // Which items are ALSO presented in their own expanded destination, so
                // two visible Details copies of one executable item can be told apart.
                detailsExpandedItemIds: listVisibleSessionBoardDetailsExpandedItemIds(scopeState.details),
                detailsFocusModeActive: paneFocusMode.active,
                rightOpen: scopeState.right?.isOpen === true,
                rightActiveTabId: scopeState.right?.activeTabId ?? null,
            }
            : null,
        companionPlacement,
        mobileSurface: input.mobileSurface ?? null,
    });
}

export function useSessionBoardPrimaryMountResolver(input: Readonly<{
    address: SessionAddress | null;
    paneScopeId: string;
    presented?: boolean;
    mobileSurface?: 'board' | 'companion' | null;
}>): SessionBoardPlacementPrimaryMountResolver {
    const visibility = useSessionBoardHostVisibility(input);
    const { preference } = useSessionCompanionPreference({
        sessionId: input.address?.sessionId ?? null,
        serverId: input.address?.serverId ?? null,
    });
    const companionWidgetIds = React.useMemo(() => new Set(
        preference.items.flatMap((item) => item.kind === 'widget' ? [item.widgetId] : []),
    ), [preference.items]);

    return React.useCallback((itemId, destination) => resolveSessionBoardItemPrimaryMountHost({
        visibility,
        itemVisibleInCompanion: companionWidgetIds.has(itemId),
        itemId,
        ...(destination ? { detailsDestination: destination } : {}),
    }), [companionWidgetIds, visibility]);
}
