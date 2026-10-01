import type { SessionConnectedServicesAuthSwitchRestartState } from '@/components/sessions/agentInput/hooks/useSessionConnectedServicesAuthSwitch';
import type { SessionState } from '@/utils/sessions/sessionUtils';
export type SessionViewConnectionStatus = Readonly<{
    text: string;
    color: string;
    dotColor: string;
    isPulsing: boolean;
}>;

export function resolveSessionViewConnectionStatus(input: Readonly<{
    connectedServicesRestartState: SessionConnectedServicesAuthSwitchRestartState;
    restartingText: string;
    switchFailedText: string;
    inactiveStatusText: string | null;
    sessionStatusResuming: boolean;
    /** The canonical presented Session state (`presentSessionAwarenessV1`). */
    sessionStatusState: SessionState;
    sessionStatusText: string;
    sessionStatusColor: string;
    sessionStatusDotColor: string;
    sessionStatusPulsing: boolean;
}>): SessionViewConnectionStatus | null {
    const restartPending = input.connectedServicesRestartState?.status === 'restarting'
        || input.connectedServicesRestartState?.status === 'pending_confirmation';
    // Before the runtime has been observed there is no status to state: the line stays empty
    // rather than reading "unknown". A restart, a failed switch or an inactive Session is a real
    // fact and still speaks.
    if (
        input.sessionStatusState === 'unknown'
        && !restartPending
        && input.connectedServicesRestartState?.status !== 'failed'
        && !input.inactiveStatusText
    ) {
        return null;
    }
    return {
        text: restartPending
            ? input.restartingText
            : input.connectedServicesRestartState?.status === 'failed'
                ? input.switchFailedText
                : input.sessionStatusResuming
                    ? input.sessionStatusText
                    : (input.inactiveStatusText || input.sessionStatusText),
        color: input.sessionStatusColor,
        dotColor: input.sessionStatusDotColor,
        isPulsing: restartPending
            || input.sessionStatusPulsing,
    };
}
