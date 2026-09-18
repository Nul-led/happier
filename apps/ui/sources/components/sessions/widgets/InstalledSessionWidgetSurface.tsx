import * as React from 'react';

import type {
    PluginUiInstanceKeyV1,
    PluginUiLaunchInputV1,
} from '@happier-dev/protocol/plugins/ui';

import { PluginInlineSurfaceHost } from '@/components/plugins/surfaces';
import { useSessionPluginPolicyContext } from '@/components/sessions/plugins/useSessionPluginPolicyContext';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { randomUUID } from '@/platform/randomUUID';
import type { Session } from '@/sync/domains/state/storageTypes';
import { resolvePluginSurfaceStatePresentation } from '@/sync/domains/surfaces/copy/resolveReasonCopy';
import { areSessionAddressesEqual, normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';

import {
    resolveInstalledSessionWidgetMount,
    type InstalledSessionWidgetMount,
    type InstalledSessionWidgetSource,
} from './sessionWidgetInstalledSurface';

/**
 * The installed-plugin arm of the one Session widget shell.
 *
 * It correlates the item's stable `{pluginId, localId}` reference to exactly one
 * currently projected `sessionWidget` placement and then hands the mount to the
 * incumbent `PluginSurfaceHost`/`boundPluginSurfaceController` path. It decides
 * nothing that path already owns: generation, execution origin, Artifact,
 * renderer selection, methods, crash state and retirement all stay there.
 *
 * The three facts it MUST supply, because no one below can reconstruct them:
 *
 * - the item's exact persisted bounded `input`, forwarded verbatim as the plugin
 *   launch input. Recomputing it or substituting host metadata would silently
 *   change what the person saved.
 * - a host-owned opaque `mountInstanceKey`, fresh for this physical mount and
 *   stable only while it lives. Without it, a Board card and a Companion card
 *   showing the same item collapse onto one legacy singleton mount.
 * - the canonical Session `policyContext`. Mounting with `undefined` where an
 *   equivalent Agent inline surface passes a real context would evaluate plugin
 *   availability against different facts in two placements of the same Session.
 *
 * A trusted installed plugin reaches this component identically whether it is
 * first-party or external: there is no origin-based privileged branch here.
 */

export type InstalledSessionWidgetSurfaceProps = Readonly<{
    sessionId: string;
    /**
     * Exact Home-qualified Session projection captured by the outer Session shell.
     * Absent while that shell is still hydrating — a loading fact this component
     * owns, never a reason for a host to draw a different (and wrong) state.
     */
    session?: Session;
    /** Canonical item-record revision; changing it retires the prior executable lifetime. */
    recordRevision: string;
    source: InstalledSessionWidgetSource;
    /** The item's persisted bounded launch input, forwarded unchanged. */
    input?: PluginUiLaunchInputV1;
    /** The public embedded presentation this physical host maps onto. */
    presentation: 'content' | 'fill';
    runtime: SessionPluginRuntimeState;
    /** Route-owned recovery retained by the incumbent plugin surface host. */
    onManagePlugin?: () => void;
    /** Current framed renderer's validated intrinsic height for outer semantic sizing. */
    onIntrinsicHeightChange?: (height: number) => void;
    testID: string;
}>;

function UnavailableInstalledWidget(props: Readonly<{
    unresolved: NonNullable<InstalledSessionWidgetMount['unresolved']>;
    testID: string;
}>): React.ReactElement {
    // One factual result, one centralized presentation projection. This adds no
    // widget-local availability enum and no widget-specific error copy.
    const presentation = resolvePluginSurfaceStatePresentation({
        state: props.unresolved.state,
        reasonCode: props.unresolved.reasonCode,
    });
    // Only `loading` and `unavailable` reach this component, and both produce a
    // replacement card. The fallback keeps a truthful state on screen rather
    // than an empty frame if that ever stops being true.
    const card = presentation.card ?? Object.freeze({
        kind: 'unavailable' as const,
        title: t('sessionBoard.item.pluginUnavailable.title'),
        reason: t('sessionBoard.item.pluginUnavailable.reason'),
        accessibilitySemantics: 'status' as const,
    });
    return (
        <SurfaceStateCard
            testID={`${props.testID}-state`}
            kind={card.kind}
            title={card.title}
            {...(card.reason === undefined ? {} : { reason: card.reason })}
            diagnosticCode={presentation.diagnosticCode}
            accessibilitySemantics={card.accessibilitySemantics}
        />
    );
}

function MountedInstalledSessionWidget(props: Readonly<{
    session: Session;
    mount: InstalledSessionWidgetMount;
    runtime: SessionPluginRuntimeState;
    input?: PluginUiLaunchInputV1;
    onManagePlugin?: () => void;
    onIntrinsicHeightChange?: (height: number) => void;
}>): React.ReactElement | null {
    // This child exists only while the plugin surface is executable. Losing
    // admission/current Session facts unmounts it; recovery creates a new
    // physical lifetime and therefore a new key. Keeping the key in the outer
    // record shell would let a late delivery from the retired lifetime address
    // the recovered mount with the same identity.
    const [mountInstanceKey] = React.useState<PluginUiInstanceKeyV1>(() => randomUUID());
    const policyContext = useSessionPluginPolicyContext({
        session: props.session,
        runtime: props.runtime,
    });
    const placement = props.mount.placement;
    const inlineMount = props.mount.inlineMount;
    if (!placement || !inlineMount) return null;
    return (
        <PluginInlineSurfaceHost
            placement={placement}
            inlineMount={inlineMount}
            sessionId={props.session.id}
            machineId={props.runtime.machineId}
            serverId={props.runtime.serverId}
            pluginUiProjection={props.runtime.pluginUiProjection}
            platform={props.runtime.platform}
            projectionInteractionEnabled={props.runtime.interactionEnabled}
            launchInput={props.input}
            mountInstanceKey={mountInstanceKey}
            policyContext={policyContext}
            {...(props.onIntrinsicHeightChange
                ? { onIntrinsicHeightChange: props.onIntrinsicHeightChange }
                : {})}
            {...(props.onManagePlugin
                ? {
                    unavailableAction: {
                        label: t('sessionBoard.item.actions.managePlugin'),
                        onPress: props.onManagePlugin,
                    },
                }
                : {})}
        />
    );
}

export function InstalledSessionWidgetSurface(
    props: InstalledSessionWidgetSurfaceProps,
): React.ReactElement {
    const session = props.session ?? null;
    // The shell and runtime already admit one exact Home-qualified Session.
    // Never subscribe to an id-only store lookup here: it would create a second
    // target authority for a physical mount that has already been qualified.
    const sessionServerId = session?.serverId ?? props.runtime.serverId;
    const hydratedAddress = session ? normalizeSessionAddress(sessionServerId, session.id) : null;
    const runtimeAddress = normalizeSessionAddress(props.runtime.serverId, props.sessionId);
    const mount = React.useMemo(() => resolveInstalledSessionWidgetMount({
        source: props.source,
        presentation: props.presentation,
        runtime: props.runtime,
    }), [props.presentation, props.runtime, props.source]);

    if (mount.unresolved) {
        return <UnavailableInstalledWidget unresolved={mount.unresolved} testID={props.testID} />;
    }
    if (props.runtime.phase !== 'current' || !props.runtime.interactionEnabled) {
        const state = props.runtime.phase === 'establishing' ? 'loading' : 'unavailable';
        return (
            <UnavailableInstalledWidget
                unresolved={{
                    state,
                    reasonCode: `session_widget_runtime_${props.runtime.phase}`,
                }}
                testID={`${props.testID}-runtime-${props.runtime.phase}`}
            />
        );
    }
    if (!session || !hydratedAddress || !runtimeAddress
        || !areSessionAddressesEqual(hydratedAddress, runtimeAddress)) {
        // An absent or same-id/cross-Home projection is loading here, never
        // authority to borrow another Home's policy facts.
        return (
            <UnavailableInstalledWidget
                unresolved={{ state: 'loading', reasonCode: 'session_widget_session_hydrating' }}
                testID={props.testID}
            />
        );
    }
    return (
        <MountedInstalledSessionWidget
            // A generation replacement is a new immutable executable authority,
            // even when the durable Board record did not change. Force the old
            // physical lifetime to unmount before binding the new generation.
            // The exact installed-package immutable generation is the currentness
            // fact; the coarse projection generation is only a fallback for
            // metadata-only rows. Keying by the coarse generation alone remounts
            // every widget when any unrelated plugin updates, losing transient
            // plugin state and breaking the calm-update contract.
            key={`${props.recordRevision}:${props.runtime.pluginUiProjection?.installedPackagesById?.[props.source.surface.pluginId]?.immutableGenerationId ?? props.runtime.pluginUiProjection?.generation ?? 'unknown'}`}
            session={session}
            mount={mount}
            runtime={props.runtime}
            input={props.input}
            {...(props.onIntrinsicHeightChange
                ? { onIntrinsicHeightChange: props.onIntrinsicHeightChange }
                : {})}
            {...(props.onManagePlugin ? { onManagePlugin: props.onManagePlugin } : {})}
        />
    );
}
