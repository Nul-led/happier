import {
    createDaemonPeerMediationObservabilityStore,
    type DaemonPeerMediationObservabilityStore,
} from '../peer/mediation/observability/store';
import type { DaemonPeerMediationObservabilityEmitter } from '../peer/mediation/observability/events';

/**
 * Bootstrap-owned peer-mediation observability runtime (PMS-9, FINALIZATION-PLAN finding #49).
 *
 * One shared store backs collection and reads. The live Home setting is consulted at publication,
 * so disabling collection stops retaining events without replacing subscribed store instances.
 */
export type DaemonPeerMediationObservabilityRuntime = Readonly<{
    store: DaemonPeerMediationObservabilityStore;
    emitter: DaemonPeerMediationObservabilityEmitter;
}>;

export function createDaemonPeerMediationObservabilityRuntime(
    input: Readonly<{ nowMs?: () => number; isEnabled?: () => boolean }> = {},
): DaemonPeerMediationObservabilityRuntime {
    const store = createDaemonPeerMediationObservabilityStore({
        ...(input.nowMs ? { nowMs: input.nowMs } : {}),
    });
    return {
        store,
        emitter: {
            emit: (event) => {
                if (input.isEnabled?.() === true) store.publish(event);
            },
        },
    };
}
