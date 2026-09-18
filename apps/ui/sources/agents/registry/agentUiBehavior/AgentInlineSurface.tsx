import * as React from 'react';
import type { PluginUiInlineSurfaceMountV1, PluginUiJsonValueV1 } from '@happier-dev/protocol/plugins/ui';

import { PluginInlineSurfaceHost } from '@/components/plugins/surfaces';
import { selectPluginInlineSurfacePlacementsBySurface } from '@/sync/domains/plugins/ui/surfacePlacementSelectors';
import {
    useSessionAddressForSessionId,
    useSessionPluginRuntime,
    type SessionPluginRuntimeState,
} from '@/components/sessions/plugins/useSessionPluginRuntime';
import { useSessionPluginPolicyContext } from '@/components/sessions/plugins/useSessionPluginPolicyContext';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { PluginUiInlineSurfacePlacementProjection } from '@/sync/domains/plugins/ui/projection';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';

function MountedAgentInlineSurface(props: Readonly<{
    session: Session;
    placement: PluginUiInlineSurfacePlacementProjection;
    current: SessionPluginRuntimeState;
    agentId?: string | null;
    inlineMount: PluginUiInlineSurfaceMountV1;
    launchInput?: PluginUiJsonValueV1;
}>): React.ReactElement {
    const policyContext = useSessionPluginPolicyContext({
        session: props.session,
        runtime: props.current,
        agentId: props.agentId,
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
    inlineMount: PluginUiInlineSurfaceMountV1;
    launchInput?: PluginUiJsonValueV1;
}>): React.ReactElement | null {
    // Inline surfaces are children of the live Session owner. Never trust a
    // machine id serialized into a launch card/details resource: a Session can
    // be handed off while a retained details tree remains mounted. The shared
    // exact-Session runtime owner resolves the current machine, server and
    // projection for one Home-qualified Session — this component keeps no
    // second copy of that resolution.
    const address = useSessionAddressForSessionId(props.sessionId, props.serverId);
    const session = useSessionViewShellSession(props.sessionId, address?.serverId ?? null);
    const current = useSessionPluginRuntime({ address });
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
