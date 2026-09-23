import * as React from 'react';

import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { CallerHostedHtmlRuntime } from '@/components/ui/surfaces/hostedHtml/HostedHtmlSurfaceAdapter';
import type { SessionBoardMountHost } from '@/sync/domains/session/board';

import { SessionBoardPane } from './SessionBoardPane';
import type { SessionBoardPlacementPrimaryMountResolver } from './sessionBoardHostVisibility';

const NO_PRIMARY_MOUNT = () => null;

/**
 * The Details/focused-Details Board placement.
 *
 * The details renderer is a plain render callback, so it cannot ask the shared
 * host-visibility owner which placement runs an executable item — it used to
 * appoint itself whenever its tab was active. This thin component restores the
 * single owner without giving the renderer registry a hook of its own.
 */
export const SessionBoardDetailsSurface = React.memo(function SessionBoardDetailsSurface(props: Readonly<{
    sessionId: string;
    session?: Session;
    serverId?: string | null;
    paneScopeId: string;
    host: Extract<SessionBoardMountHost, 'details' | 'focusedDetails'>;
    /** This Details tab is the active one; a background tab renders nothing live. */
    active: boolean;
    pluginRuntime: SessionPluginRuntimeState;
    callerHostedHtmlRuntime?: CallerHostedHtmlRuntime;
    focusedItemId?: string;
    onLeaveFocusedItem?: () => void;
    onReadFullItem?: (itemId: string) => void;
    resolvePrimaryHost?: SessionBoardPlacementPrimaryMountResolver;
}>) {
    // The generic Board destination and an item's expanded destination are both the
    // `details` host and can be presented side by side in two split groups. Each one
    // says which destination it is, so the shared owner selects ONE physical copy to
    // run the item and the other draws a truthful preview of the same card.
    const destinationItemId = props.focusedItemId ?? null;
    const resolvePrimaryHost = props.resolvePrimaryHost;
    const resolveForDestination = React.useCallback(
        (itemId: string) => resolvePrimaryHost?.(itemId, { detailsDestinationItemId: destinationItemId }) ?? null,
        [destinationItemId, resolvePrimaryHost],
    );
    return (
        <SessionBoardPane
            sessionId={props.sessionId}
            {...(props.session ? { session: props.session } : {})}
            serverId={props.serverId}
            host={props.host}
            // A background Details tab is not on screen, so it never runs content
            // even when the shared owner named this host.
            resolvePrimaryHost={props.active ? resolveForDestination : NO_PRIMARY_MOUNT}
            // The same fact, one step further: the Details workspace keeps every
            // tab mounted for content, scroll and view continuity, so a retained
            // pane must keep drawing its Board while owning no interaction. Left
            // eligible, each hidden pane mounted its own editor over the one
            // shared draft and re-registered the one continuity draft guard, so
            // the last tab to mount answered Save with text nobody was looking at.
            retained={!props.active}
            density="full"
            layout="grid"
            {...(props.focusedItemId ? { focusedItemId: props.focusedItemId } : {})}
            {...(props.onLeaveFocusedItem ? { onLeaveFocusedItem: props.onLeaveFocusedItem } : {})}
            {...(props.onReadFullItem ? { onReadFullItem: props.onReadFullItem } : {})}
            pluginRuntime={props.pluginRuntime}
            {...(props.callerHostedHtmlRuntime ? { callerHostedHtmlRuntime: props.callerHostedHtmlRuntime } : {})}
        />
    );
});
