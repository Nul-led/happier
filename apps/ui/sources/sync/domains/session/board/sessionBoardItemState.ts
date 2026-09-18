import type { SessionSurfaceItemV1 } from '@happier-dev/protocol/sessions/board';

import type { SessionBoardOpenedRecord } from './sessionBoardRecordOutcome';

/**
 * The canonical Board item state (Plan 03 §9). Board, Details, the compact
 * sidebar, inline transcript references, mobile Cockpit and Companion all read
 * this one union; none of them maintains a second status ladder.
 *
 * It carries only what the RECORD proves. Whether this client can render a ready
 * item's source — renderer availability, plugin currentness, executable mount
 * mode — belongs to the surface adapters above it and is resolved at the host.
 */
export type SessionBoardItemState =
    /** No prior data for this item yet. Never a fabricated empty item. */
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'ready'; item: SessionSurfaceItemV1 }>
    /** Session is E2EE and its key is not available yet. Recoverable, not absent. */
    | Readonly<{ kind: 'locked' }>
    | Readonly<{ kind: 'unopenable'; reason: 'corrupt_or_unopenable' | 'malformed' | 'mode_mismatch' }>
    | Readonly<{ kind: 'unsupported'; version: unknown }>
    /** The layout places an item whose record is not in a complete inventory. */
    | Readonly<{ kind: 'missingReference' }>
    /** A viewer-local reference (Companion, inline result) to an item the Board no longer has. */
    | Readonly<{ kind: 'removed' }>;

/**
 * Derive one item's state from its opened record.
 *
 * `record === undefined` means the inventory returned no row for this address.
 * That is only absence when the inventory is complete: an unfinished page must
 * not turn a valid sibling into a missing reference (Plan 04 §3.1).
 */
export function deriveSessionBoardItemState(
    record: SessionBoardOpenedRecord<SessionSurfaceItemV1> | undefined,
    inventory: Readonly<{ complete: boolean }>,
): SessionBoardItemState {
    if (record === undefined) {
        return inventory.complete ? Object.freeze({ kind: 'missingReference' as const }) : Object.freeze({ kind: 'loading' as const });
    }
    const outcome = record.outcome;
    switch (outcome.status) {
        case 'ready':
            return Object.freeze({ kind: 'ready' as const, item: outcome.value });
        case 'locked':
            return Object.freeze({ kind: 'locked' as const });
        case 'unsupported_version':
            return Object.freeze({ kind: 'unsupported' as const, version: outcome.version });
        case 'corrupt_or_unopenable':
        case 'malformed':
        case 'mode_mismatch':
            return Object.freeze({ kind: 'unopenable' as const, reason: outcome.status });
    }
}

/** A malformed or locked sibling must never hide the rest of the Board (Plan 03 §3.9). */
export function isSessionBoardItemStateRenderable(state: SessionBoardItemState): boolean {
    return state.kind !== 'removed';
}

/**
 * Whether the person may still act on this row. A locked or malformed item is a
 * real row with a real revision, so an editor can still remove it; a missing or
 * already-removed reference has nothing to mutate.
 */
export function sessionBoardItemStateHasRecord(state: SessionBoardItemState): boolean {
    return state.kind === 'ready'
        || state.kind === 'locked'
        || state.kind === 'unopenable'
        || state.kind === 'unsupported';
}
