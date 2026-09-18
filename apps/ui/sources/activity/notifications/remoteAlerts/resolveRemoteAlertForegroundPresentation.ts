import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { consumeOtherLegActivityAlertPresentation } from './activityAlertPresentationNotes';
import { resolveIncomingActivityRemoteAlert, type ActivityRemoteAlertTarget } from './activityRemoteAlertRouting';

export type RemoteAlertForegroundPresentation =
    | Readonly<{ kind: 'not_remote_alert' }>
    | Readonly<{ kind: 'suppress'; reason: 'unroutable' | 'session_visible' | 'already_presented' }>
    | Readonly<{ kind: 'present'; target: ActivityRemoteAlertTarget }>;

/**
 * Decide what a Home-submitted alert may do while this app is in the
 * foreground, before the Account/device foreground behavior applies.
 *
 * `unroutable` means this device cannot name the alert's Home, so it neither
 * presents nor deep-links it. `already_presented` means this device's own local
 * notification leg already showed this committed event, so the Home alert must
 * not repeat it (Lane 09C §10.4 C5b step 6); that one-shot note is consumed
 * here, so a later event for the same Session is never suppressed.
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
    if (target.eventIdentity && consumeOtherLegActivityAlertPresentation({
        address: target.address,
        event: target.event,
        identity: target.eventIdentity,
        source: 'home_remote_alert',
    })) {
        return { kind: 'suppress', reason: 'already_presented' };
    }
    return { kind: 'present', target };
}
