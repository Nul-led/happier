import * as React from 'react';
import type { BrowserViewTargetV1 } from '@happier-dev/protocol';
import { LocalServicePublicPreviewControls } from '@/components/sessions/localServices/LocalServicePublicPreviewControls';
import { useLocalServicePublicPreviewActions } from '@/components/sessions/localServices/publicPreviewActions';
import { useLocalServiceCapabilityDisabledReasons, useLocalServicePublicPreviewFeatureEnabled } from '@/components/sessions/localServices/useLocalServicePublicPreviewFeature';
import { useLocalServicePublicPreviewState } from '@/sync/domains/local/services/publicPreview/useLocalServicePublicPreviewState';
import { createFrontDoorRuntimeActionExecutor } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';

import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useMachineDisplayNamesById } from '@/sync/store/hooks';
import { t } from '@/text';

const NO_LAUNCH_TARGETS = Object.freeze([]);

/** Browser consumes the same consent sheet, status store and create/copy/revoke owner as Services. */
export function BrowserLocalPreviewPublicLinkControls(props: Readonly<{
    target: Extract<BrowserViewTargetV1, { kind: 'localServicePreview' }>;
    serviceTitle: string;
    serverId?: string | null;
    testID: string;
}>): React.ReactElement | null {
    const enabled = useLocalServicePublicPreviewFeatureEnabled(props.serverId);
    const capabilityDisabledReasons = useLocalServiceCapabilityDisabledReasons(props.serverId);
    const state = useLocalServicePublicPreviewState({
        machineId: props.target.machineId,
        sessionId: props.target.sessionId,
        previewId: props.target.targetId,
        serverId: props.serverId,
        enabled: enabled && Boolean(props.target.sessionId),
    });
    const runtimeActionExecute = React.useMemo(() => createFrontDoorRuntimeActionExecutor(), []);
    const actions = useLocalServicePublicPreviewActions({ runtimeActionExecute, machineId: props.target.machineId, sessionId: props.target.sessionId, serverId: props.serverId });
    // The existing public-exposure contract is Session-bound; do not manufacture a Session.
    if (!props.target.sessionId) return null;
    return <LocalServicePublicPreviewControls launchTargets={NO_LAUNCH_TARGETS} browserTarget={props.target} serviceTitle={props.serviceTitle} state={state} actions={actions} capabilityDisabledReasons={capabilityDisabledReasons} testID={props.testID} />;
}

/**
 * A private preview this device was given no way to open (services lab R, H-UX F-1).
 *
 * Whether a viewer can open a private preview is decided once, by the server's preview access owner:
 * it issues an access URL for this viewer, or it does not. When it does not, the honest state is where
 * the service runs and the way that works from here, never a generic "unavailable" or a page that
 * fails to load. The machine is named from the canonical display-name projection; an unknown machine
 * reads as "another machine" rather than a raw id.
 */
export function BrowserLocalPreviewElsewhere(props: Readonly<{
    testID: string;
    serviceTitle: string;
    machineId: string;
}>): React.ReactElement {
    const machineIds = React.useMemo(() => [props.machineId], [props.machineId]);
    const machineName = useMachineDisplayNamesById(machineIds)[props.machineId] ?? null;
    return (
        <SurfaceStateCard
            testID={`${props.testID}-elsewhere`}
            kind="unavailable"
            iconName="laptop"
            title={machineName
                ? t('browserShell.unavailable.previewElsewhereTitle', { service: props.serviceTitle, machine: machineName })
                : t('browserShell.unavailable.previewElsewhereTitleUnknownMachine', { service: props.serviceTitle })}
            reason={t('browserShell.unavailable.previewElsewhere')}
        />
    );
}
