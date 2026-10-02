import type { HappierAgentPageRect, HappierPresenceTakeControlResult } from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import type { BrowserAutomationControlService } from '@/sync/domains/browser/automation';
import { readSessionPresentationAgentId } from '@/sync/domains/session/presentation/readSessionPresentationAgentId';
import { useSession } from '@/sync/domains/state/storage';
import { selectBrowserCopresence } from '@/sync/domains/browser/automation/copresence';
import type { BrowserControlViewState } from '@/sync/domains/browser/control';
import { isDaemonAuthoritativeBrowserView } from '@/sync/domains/browser/control/commands';
import { t } from '@/text';

import { BrowserAgentCursor } from './BrowserAgentCursor';
import { BrowserPresenceCapsule } from './BrowserPresenceCapsule';
import type { BrowserDaemonControlCommandSender } from '@/sync/domains/browser/control/machineRpc';

/**
 * The session whose agent drives this browser. The leaf reads the session's agent (for its mark and
 * name) and its canonical activity (`thinking`: is the turn running) itself, so the chrome around it
 * never subscribes to the session record.
 */
export type BrowserShellAgentPresence = Readonly<{
    sessionId: string;
    serverId?: string | null;
    /**
     * The agent's catalog id when the host already knows it without a Session record in this
     * client's store (a dev specimen; a surface opened from another Home). The Session's own agent,
     * when its record is here, always wins.
     */
    knownAgentId?: string | null;
}>;

function resolveAgentName(agentId: string | null | undefined): string {
    const core = agentId ? getAgentCore(agentId as AgentId) : null;
    return core ? t(core.displayNameKey) : t('browserPresence.agentFallbackName');
}

/**
 * The session's agent as the browser surfaces name it: its catalog id (for the mark), its display
 * name, and whether its turn is running (`thinking`, the session's canonical activity). Read in the
 * leaf that renders it, so the chrome never subscribes to the session record.
 */
export function useBrowserSessionAgentIdentity(agent: BrowserShellAgentPresence | null): Readonly<{
    agentId: string | null;
    name: string;
    turnActive: boolean | undefined;
}> {
    const session = useSession(agent?.sessionId ?? '', agent?.serverId ?? null);
    const turnActive = session ? session.thinking === true : undefined;
    const sessionMetadata = session?.metadata;
    const sessionLayoutVersion = session?.metadataLayoutVersion;
    const agentId = React.useMemo(
        () => (session ? readSessionPresentationAgentId(session) : null),
        // The agent identity changes only with the session's metadata.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [sessionMetadata, sessionLayoutVersion],
    );
    const resolvedAgentId = agentId ?? agent?.knownAgentId ?? null;
    return React.useMemo(
        () => ({ agentId: resolvedAgentId, name: resolveAgentName(resolvedAgentId), turnActive }),
        [resolvedAgentId, turnActive],
    );
}

/**
 * The presence capsule's data leaf. It alone subscribes to the automation owner, so a controller
 * change or a finished action re-renders this capsule and not the browser chrome around it.
 *
 * Take control and Hand back go straight to the controller owner (`recordHumanInput`,
 * `releaseHumanControl`): the takeover interrupts the agent's in-flight mutating action there, and
 * the owner refuses the agent's next one until the person hands the page back.
 */
export function BrowserShellPresence(props: Readonly<{
    view: BrowserControlViewState;
    /** The in-app automation owner, for views the app renders itself. */
    controlService: BrowserAutomationControlService | null;
    sendDaemonCommand?: BrowserDaemonControlCommandSender;
    agent: BrowserShellAgentPresence | null;
    /** Where the page is drawn when it does not fill the frame (a fitted stream). */
    pageRect?: HappierAgentPageRect | null;
    compact?: boolean;
    nowMs?: () => number;
    testID: string;
}>): React.ReactElement | null {
    const { controlService, view } = props;
    // A daemon-owned view's controller is the daemon's (its `controllerChanged` events, ingested into
    // the view state); an in-app view's is the in-app automation owner. One projection, two owners,
    // never a third copy here.
    const daemonOwned = isDaemonAuthoritativeBrowserView(view);
    const [version, setVersion] = React.useState(0);
    React.useEffect(() => {
        if (!controlService || daemonOwned) return undefined;
        return controlService.subscribe(() => setVersion((current) => current + 1));
    }, [controlService, daemonOwned]);

    const viewKey = React.useMemo(
        () => ({ browserSessionId: view.browserSessionId, viewId: view.viewId }),
        [view.browserSessionId, view.viewId],
    );
    const identity = useBrowserSessionAgentIdentity(props.agent);
    const agentTurnActive = identity.turnActive;
    const daemonController = daemonOwned ? view.automationController ?? null : null;

    const presence = React.useMemo(() => selectBrowserCopresence({
        snapshot: !daemonOwned && controlService ? controlService.getSnapshot() : null,
        controllerState: daemonController,
        view: viewKey,
        agentTurnActive,
        timeline: !daemonOwned && controlService ? controlService.getActionTimeline(viewKey) : [],
    }), [agentTurnActive, controlService, daemonController, daemonOwned, version, viewKey]);

    const agent = React.useMemo(
        () => ({ agentId: identity.agentId, name: identity.name }),
        [identity.agentId, identity.name],
    );

    const nowMs = props.nowMs;
    const takeControl = React.useCallback(() => {
        if (daemonOwned) {
            if (!props.sendDaemonCommand) return { status: 'failed' } satisfies HappierPresenceTakeControlResult;
            return props.sendDaemonCommand({ kind: 'takeControl', commandId: `take-control:${view.viewId}:${nowMs?.() ?? Date.now()}`, ...viewKey })
                .then((result): HappierPresenceTakeControlResult => ({ status: result.ok
                    ? result.result.status === 'dispatched' ? 'accepted' : 'failed'
                    : result.reason === 'unavailable' ? 'failed' : 'unknown' }));
        }
        controlService?.recordHumanInput({
            ...viewKey,
            inputKind: 'takeover',
            occurredAtMs: nowMs?.() ?? Date.now(),
        });
    }, [controlService, daemonOwned, nowMs, props.sendDaemonCommand, view.viewId, viewKey]);
    const handBack = React.useCallback(() => {
        if (daemonOwned) {
            props.sendDaemonCommand?.({ kind: 'handBack', commandId: `hand-back:${view.viewId}:${nowMs?.() ?? Date.now()}`, ...viewKey });
            return;
        }
        controlService?.releaseHumanControl(viewKey);
    }, [controlService, daemonOwned, nowMs, props.sendDaemonCommand, view.viewId, viewKey]);
    const canControl = daemonOwned ? Boolean(props.sendDaemonCommand) : controlService !== null;

    return (
        <>
            <BrowserAgentCursor
                testID={`${props.testID}-cursor`}
                target={presence.kind === 'agent' ? presence.target : null}
                pageRect={props.pageRect}
                agentId={agent.agentId}
            />
            <BrowserPresenceCapsule
                testID={props.testID}
                presence={presence}
                agent={agent}
                compact={props.compact}
                onTakeControl={canControl ? takeControl : undefined}
                onHandBack={canControl ? handBack : undefined}
            />
        </>
    );
}
