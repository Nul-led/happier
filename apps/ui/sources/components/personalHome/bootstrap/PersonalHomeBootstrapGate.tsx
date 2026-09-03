import * as React from 'react';
import { View } from 'react-native';

import { PersonalHomeSetupSurface } from '../setup/PersonalHomeSetupSurface';
import { PersonalHomeRecoveryStrip } from './PersonalHomeRecoveryStrip';
import { isPersonalHomeBootstrapRuntimeHost } from './personalHomeBootstrapHost';
import type { PersonalHomeBootstrapOperation, PersonalHomeFacts } from './personalHomeBootstrapTypes';
import {
    usePersonalHomeBootstrapController,
    type PersonalHomeBootstrapOperationRunner,
} from './usePersonalHomeBootstrapController';

export type PersonalHomeBootstrapGateProps = Readonly<{
    children: React.ReactNode;
    /** Fact collection is supplied by the runtime/profile/auth owners. */
    readFacts?: () => Promise<PersonalHomeFacts>;
    operations?: Partial<Record<PersonalHomeBootstrapOperation, PersonalHomeBootstrapOperationRunner>>;
    initialFacts?: PersonalHomeFacts | null;
    isDesktopHost?: boolean;
    isDesktopMainWindow?: boolean;
    /** Explicit recovery/callback routes must remain reachable before setup completes. */
    bypass?: boolean;
    onUseExisting?: () => void;
    useExistingRuntimeOperation?: PersonalHomeBootstrapOperationRunner;
    onUseAnotherHome?: () => void;
    onOpenDetails?: () => void;
    setupSurface?: (props: React.ComponentProps<typeof PersonalHomeSetupSurface>) => React.ReactNode;
}>;

function passThroughFacts(): Promise<PersonalHomeFacts> {
    return Promise.resolve({
        hostIsDesktop: false,
        isDesktopMainWindow: false,
        explicitlySelectedOtherHome: false,
        completedPersonalHomeProfile: null,
        candidateLocalProfile: null,
        relayRuntime: null,
        localHomeReachability: 'unknown',
        localHomeIdentity: null,
        localHomeAuth: 'unknown',
        anonymousSignup: 'unknown',
        daemon: null,
        activeTask: null,
    });
}

/**
 * Desktop main-window-only shell gate. Overlay/callback windows and mobile/web hosts never enter
 * the Personal Home setup owner. The normal shell remains the child tree once Home readiness is
 * derived from facts; there is no success route or remounted frame.
 */
export function PersonalHomeBootstrapGate(props: PersonalHomeBootstrapGateProps): React.ReactElement {
    const runtimeHost = isPersonalHomeBootstrapRuntimeHost();
    const isDesktop = props.isDesktopHost ?? runtimeHost;
    const isMainWindow = props.isDesktopMainWindow ?? runtimeHost;
    const enabled = isDesktop && isMainWindow && props.bypass !== true && props.readFacts != null;
    const controller = usePersonalHomeBootstrapController({
        readFacts: props.readFacts ?? passThroughFacts,
        operations: props.operations,
        initialFacts: props.initialFacts,
        enabled,
    });
    const handleUseExisting = React.useCallback(() => {
        if (props.useExistingRuntimeOperation) {
            void controller.execute(props.useExistingRuntimeOperation);
            return;
        }
        props.onUseExisting?.();
    }, [controller.execute, props.onUseExisting, props.useExistingRuntimeOperation]);

    if (!enabled || !controller.snapshot.shouldGateShell) {
        // The shell is released once Home readiness is derived from facts. A post-shell daemon
        // failure stays scoped to a recovery strip in the same frame; the first-run gate never
        // reopens for it.
        const showPostShellRecovery = enabled
            && controller.error != null
            && controller.snapshot.homeReady
            && controller.snapshot.shouldGateShell === false;
        return (
            <View style={{ flex: 1 }}>
                {props.children}
                {showPostShellRecovery ? (
                    <PersonalHomeRecoveryStrip
                        kind={controller.facts?.completedPersonalHomeProfile ? 'computer' : 'profile'}
                        activeTask={controller.facts?.activeTask ?? null}
                        detail={controller.snapshot.detail}
                        onOpenDetails={props.onOpenDetails}
                        onRetry={controller.retry}
                    />
                ) : null}
            </View>
        );
    }

    const setupProps: React.ComponentProps<typeof PersonalHomeSetupSurface> = {
        snapshot: controller.snapshot,
        activeTask: controller.facts?.activeTask ?? null,
        onRetry: controller.retry,
        onOpenDetails: props.onOpenDetails,
        onUseExisting: props.useExistingRuntimeOperation || props.onUseExisting
            ? handleUseExisting
            : undefined,
        onUseAnotherHome: props.onUseAnotherHome,
    };
    return (
        <>
            {props.setupSurface ? props.setupSurface(setupProps) : <PersonalHomeSetupSurface {...setupProps} />}
        </>
    );
}
