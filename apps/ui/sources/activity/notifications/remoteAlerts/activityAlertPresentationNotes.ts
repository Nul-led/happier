import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';

import type { ActivityAlertEventKind } from './activityRemoteAlertRouting';

/**
 * Which leg last showed this device an alert for one committed event.
 *
 * This is an in-process note, not a delivery receipt: it proves nothing
 * about display, acknowledges no frontier, never advances read or Voice state,
 * says nothing about other devices, and makes no exactly-once claim. Its only
 * job is that one committed event does not produce two visible alerts on the
 * same device when both the Home leg and this device's own local notification
 * observe it (Lane 09C §10.4 C5b step 6).
 *
 * A note exists only for a canonical committed-event identity and suppresses at
 * most one alert from the *other* leg. Identityless state observations are
 * deliberately never recorded or consumed: they must re-run current
 * eligibility and policy instead of being conflated by Session/category.
 */
export type ActivityAlertPresentationSource = 'home_remote_alert' | 'local_notification';

type PresentationNote = Readonly<{ source: ActivityAlertPresentationSource }>;

const notes = new Map<string, PresentationNote>();

function noteKey(address: SessionAddress, event: ActivityAlertEventKind, identity: string): string {
    return `${sessionAddressKey(address)}:${event}:${identity}`;
}

export function noteActivityAlertPresented(params: Readonly<{
    address: SessionAddress;
    event: ActivityAlertEventKind;
    /** Canonical stable identity of the committed event. */
    identity: string;
    source: ActivityAlertPresentationSource;
}>): void {
    // Current-state observations have no committed occurrence identity. They
    // must never create a cross-leg suppression note by accidentally folding
    // every observation into the same `undefined` key.
    if (!params.identity) return;
    const key = noteKey(params.address, params.event, params.identity);
    notes.delete(key);
    notes.set(key, { source: params.source });
}

/**
 * True when the other leg already showed this device an alert for this exact
 * event. The note is consumed, so it can never suppress a second time.
 */
export function consumeOtherLegActivityAlertPresentation(params: Readonly<{
    address: SessionAddress;
    event: ActivityAlertEventKind;
    /** Canonical stable identity of the committed event. */
    identity: string;
    source: ActivityAlertPresentationSource;
}>): boolean {
    const key = noteKey(params.address, params.event, params.identity);
    const note = notes.get(key);
    if (!note || note.source === params.source) return false;
    notes.delete(key);
    return true;
}

export function resetActivityAlertPresentationNotesForTests(): void {
    notes.clear();
}
