import type { ConnectionHealthKind } from './connectionHealthTypes';

/**
 * First-layer Home connection summary. It answers only "can I reach this Home
 * right now, and what can I do about it" — machine, socket, and transport facts
 * stay behind the Details disclosure.
 */
export type HomeConnectionSummaryKind = 'connected' | 'reconnecting' | 'unavailable' | 'sign_in';

export type HomeConnectionSummaryLabelKey =
    | 'connectionStatus.summary.connected'
    | 'connectionStatus.summary.reconnecting'
    | 'connectionStatus.summary.unavailable'
    | 'connectionStatus.summary.signInAgain';

/** Presentation is resolved by the popover's shared status-presentation owner. */
export type HomeConnectionStatusKey = 'connected' | 'connecting' | 'error' | 'action_required';

export type HomeConnectionSummary = Readonly<{
    kind: HomeConnectionSummaryKind;
    statusLabelKey: HomeConnectionSummaryLabelKey;
    statusKey: HomeConnectionStatusKey;
    /** `restore` re-authenticates this Home; `retry` reconnects it. */
    action: 'none' | 'retry' | 'restore';
}>;

const SUMMARY_PRESENTATION: Readonly<Record<HomeConnectionSummaryKind, Readonly<{
    statusLabelKey: HomeConnectionSummaryLabelKey;
    statusKey: HomeConnectionStatusKey;
}>>> = {
    connected: { statusLabelKey: 'connectionStatus.summary.connected', statusKey: 'connected' },
    reconnecting: { statusLabelKey: 'connectionStatus.summary.reconnecting', statusKey: 'connecting' },
    unavailable: { statusLabelKey: 'connectionStatus.summary.unavailable', statusKey: 'error' },
    sign_in: { statusLabelKey: 'connectionStatus.summary.signInAgain', statusKey: 'action_required' },
};

function resolveSummaryKind(healthKind: ConnectionHealthKind): HomeConnectionSummaryKind {
    switch (healthKind) {
        case 'auth_required':
            return 'sign_in';
        case 'connecting':
        case 'server_restarting':
            return 'reconnecting';
        case 'server_error':
        case 'server_unreachable':
            return 'unavailable';
        case 'healthy':
        case 'no_machine':
        case 'machine_offline':
        case 'machine_not_ready':
            return 'connected';
    }
}

/**
 * The summary state comes from the canonical connection-health owner so the
 * popover never invents a second interpretation of whether the Home is up. Only
 * the offered action additionally consults the last sync error, because
 * retryability and auth-ness are error facts the health kind does not carry.
 */
export function resolveHomeConnectionSummary(params: Readonly<{
    healthKind: ConnectionHealthKind;
    syncErrorKind?: string | null;
    syncErrorRetryable?: boolean | null;
}>): HomeConnectionSummary {
    const kind = resolveSummaryKind(params.healthKind);
    const hasSyncError = params.syncErrorKind != null;
    const action = kind === 'sign_in' || params.syncErrorKind === 'auth'
        ? 'restore'
        : params.syncErrorRetryable === false
            ? 'none'
            : kind === 'reconnecting' || kind === 'unavailable' || hasSyncError
                ? 'retry'
                : 'none';

    return { kind, ...SUMMARY_PRESENTATION[kind], action };
}
