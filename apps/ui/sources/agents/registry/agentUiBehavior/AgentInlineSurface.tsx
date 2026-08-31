import * as React from 'react';
import type { PluginUiJsonValueV1 } from '@happier-dev/protocol/plugins/ui';

import { PluginInlineSurfaceHost, type PluginInlineSurfaceMountV1 } from '@/components/plugins/surfaces';
import { useScopedPluginUiProjection } from '@/components/plugins/projection/useScopedPluginUiProjection';
import { selectPluginInlineSurfacePlacementsBySurface } from '@/sync/domains/plugins/ui/surfacePlacementSelectors';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { usePluginUiSessionPolicyEvaluationContext } from '@/components/sessions/model/usePluginUiSessionPolicyEvaluationContext';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { readSessionPresentationAgentId } from '@/sync/domains/session/presentation/readSessionPresentationAgentId';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { PluginUiInlineSurfacePlacementProjection } from '@/sync/domains/plugins/ui/projection';
import { useSession, useSessionServerId, useSettings } from '@/sync/store/hooks';
import { useSessionStatus } from '@/utils/sessions/sessionUtils';

function MountedAgentInlineSurface(props: Readonly<{
    session: Session;
    placement: PluginUiInlineSurfacePlacementProjection;
    current: ReturnType<typeof useScopedPluginUiProjection>;
    agentId?: string | null;
    inlineMount: PluginInlineSurfaceMountV1;
    launchInput?: PluginUiJsonValueV1;
}>): React.ReactElement {
    const sessionStatus = useSessionStatus(props.session, {
        subscribeToSession: false,
        subscribeToTranscript: false,
    });
    const settings = useSettings();
    const serverFeaturesSnapshot = useServerFeaturesSnapshotForServerId(props.current.serverId, {
        enabled: Boolean(props.current.serverId),
    });
    const policyContext = usePluginUiSessionPolicyEvaluationContext({
        platform: props.current.platform,
        serverId: props.current.serverId,
        settings,
        serverFeaturesSnapshot,
        facts: {
            pluginEnabled: true,
            sessionAgentId: readSessionPresentationAgentId(props.session) ?? props.agentId ?? null,
            sessionState: sessionStatus.state,
            machineId: props.current.machineId,
            projectId: null,
            browserExists: false,
        },
    });

    return (
        <PluginInlineSurfaceHost
            placement={props.placement}
            inlineMount={props.inlineMount}
            sessionId={props.session.id}
            machineId={props.current.machineId}
            serverId={props.current.serverId}
            agentId={props.agentId}
            pluginUiProjection={props.current.pluginUiProjection}
            platform={props.current.platform}
            projectionInteractionEnabled={props.current.interactionEnabled}
            launchInput={props.launchInput}
            policyContext={policyContext}
        />
    );
}

export function AgentInlineSurface(props: Readonly<{
    pluginId: string;
    surfaceId: string;
    sessionId: string;
    /** Route-scoped server identity may be supplied by a details owner. */
    serverId?: string | null;
    agentId?: string | null;
    inlineMount: PluginInlineSurfaceMountV1;
    launchInput?: PluginUiJsonValueV1;
}>): React.ReactElement | null {
    // Inline surfaces are children of the live Session owner. Never trust a
    // machine id serialized into a launch card/details resource: a Session can
    // be handed off while a retained details tree remains mounted. The existing
    // Session target hook is the canonical machine owner; the Session server
    // hook provides the matching server scope.
    const sessionTarget = useSessionMachineTarget(props.sessionId);
    const sessionServerId = useSessionServerId(props.sessionId);
    const session = useSession(props.sessionId);
    const current = useScopedPluginUiProjection({
        machineId: sessionTarget?.machineId ?? null,
        serverId: sessionServerId ?? props.serverId,
    });
    const placements = current.pluginUiProjection
        ? selectPluginInlineSurfacePlacementsBySurface(current.pluginUiProjection, {
            pluginId: props.pluginId,
            localId: props.surfaceId,
        }, props.inlineMount.role)
        : [];
    const placement = placements.length === 1 ? placements[0] : null;
    if (!placement || !session) return null;
    return (
        <MountedAgentInlineSurface
            session={session}
            placement={placement}
            current={current}
            inlineMount={props.inlineMount}
            agentId={props.agentId}
            launchInput={props.launchInput}
        />
    );
}
