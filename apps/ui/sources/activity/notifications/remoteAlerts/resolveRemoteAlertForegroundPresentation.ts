import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { resolveIncomingActivityRemoteAlert, type ActivityRemoteAlertTarget } from './activityRemoteAlertRouting';

export type RemoteAlertForegroundPresentation =
    | Readonly<{ kind: 'not_remote_alert' }>
    | Readonly<{ kind: 'suppress'; reason: 'unroutable' | 'session_visible' }>
    | Readonly<{ kind: 'present'; target: ActivityRemoteAlertTarget }>;

/**
 * Decide what a Home-submitted alert may do while this app is in the
 * foreground, before the Account/device foreground behavior applies.
 *
 * `unroutable` means this device cannot name the alert's Home, so it neither
 * presents nor deep-links it. Event presentation is decided later by the shared
 * foreground owner after exact Account and delivery policy admission; routing
 * must never consume a note for an arrival that cannot present.
 */
export function resolveRemoteAlertForegroundPresentation(params: Readonly<{
    data: unknown;
    isSessionVisible: (address: SessionAddress) => boolean;
}>): RemoteAlertForegroundPresentation {
    const incoming = resolveIncomingActivityRemoteAlert(params.data);
    if (incoming.kind === 'not_remote_alert') return { kind: 'not_remote_alert' };
    if (incoming.kind === 'unroutable') return { kind: 'suppress', reason: 'unroutable' };

    const target = incoming.target;
    if (params.isSessionVisible(target.address)) return { kind: 'suppress', reason: 'session_visible' };
    return { kind: 'present', target };
}
