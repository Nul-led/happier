import type { SessionBoardItemProjection, SessionBoardSnapshot } from '@/sync/domains/session/board';
import { resolveSessionBoardItemTitle } from '@/components/sessions/board/sessionBoardItemPresentation';
import type { SessionBoardBinding, SessionBoardBindingUnavailableReason } from '@/components/sessions/board/observeSessionBoard';

import type { SessionCompanionItemRefV1 } from './state/sessionCompanionPreference';

export type SessionCompanionAddableItem = Readonly<{ widgetId: string; title: string }>;

/**
 * Projects every currently readable unselected Board item for the local picker.
 * Both rail and full surface consume this one projection, so neither can impose
 * a different arbitrary count limit or title rule.
 */
export function resolveSessionCompanionAddableItems(input: Readonly<{
    snapshot: SessionBoardSnapshot | null;
    refs: readonly SessionCompanionItemRefV1[];
}>): readonly SessionCompanionAddableItem[] {
    if (!input.snapshot) return Object.freeze([]);
    const selected = new Set(input.refs.flatMap((ref) => (
        ref.kind === 'widget' ? [ref.widgetId] : []
    )));
    const candidates: SessionCompanionAddableItem[] = [];
    for (const [widgetId, item] of input.snapshot.itemsById) {
        if (item.state.kind !== 'ready' || selected.has(widgetId)) continue;
        candidates.push(Object.freeze({
            widgetId,
            title: resolveSessionBoardItemTitle(item.state),
        }));
    }
    return Object.freeze(candidates);
}

/**
 * How much the exact Board repository currently knows about this Session's items.
 *
 * Only `authoritative` proves absence. Everything else means "not resolved yet",
 * which is why the Companion has a distinct pending state: a paging, offline or
 * unauthorized inventory must never be relabelled "this widget was removed".
 */
export type SessionCompanionBoardInventory =
    | Readonly<{ kind: 'authoritative' }>
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'offline' }>
    | Readonly<{ kind: 'locked' }>
    | Readonly<{
        kind: 'unavailable';
        reason: SessionBoardBindingUnavailableReason | 'unopenable' | 'unsupported';
    }>
    | Readonly<{ kind: 'revoked' }>;

const AUTHORITATIVE_INVENTORY = Object.freeze({ kind: 'authoritative' as const });
const LOADING_INVENTORY = Object.freeze({ kind: 'loading' as const });
const OFFLINE_INVENTORY = Object.freeze({ kind: 'offline' as const });
const LOCKED_INVENTORY = Object.freeze({ kind: 'locked' as const });
const REVOKED_INVENTORY = Object.freeze({ kind: 'revoked' as const });

export type SessionCompanionContentItem =
    | Readonly<{
        kind: 'summary';
        ref: Extract<SessionCompanionItemRefV1, { kind: 'builtin' }>;
    }>
    | Readonly<{
        kind: 'widget';
        ref: Extract<SessionCompanionItemRefV1, { kind: 'widget' }>;
        item: SessionBoardItemProjection;
    }>
    | Readonly<{
        kind: 'pending_widget';
        ref: Extract<SessionCompanionItemRefV1, { kind: 'widget' }>;
        inventory: Exclude<SessionCompanionBoardInventory, { kind: 'authoritative' }>;
    }>
    | Readonly<{
        kind: 'missing_widget';
        ref: Extract<SessionCompanionItemRefV1, { kind: 'widget' }>;
    }>;

/**
 * Reads the Board binding's own completeness facts. The Companion adds no second
 * freshness model: it only distinguishes "the canonical repository has told us
 * everything" from "it has not".
 */
export function resolveSessionCompanionBoardInventory(
    binding: SessionBoardBinding | null,
): SessionCompanionBoardInventory {
    if (!binding) return LOADING_INVENTORY;
    if (binding.status === 'unavailable') {
        if (binding.reason === 'forbidden' || binding.reason === 'not_found') {
            return REVOKED_INVENTORY;
        }
        if (binding.reason === 'offline' || binding.reason === 'server_error' || binding.reason === 'invalid_response') {
            return OFFLINE_INVENTORY;
        }
        return Object.freeze({ kind: 'unavailable', reason: binding.reason });
    }
    const snapshot = binding.snapshot;
    if (snapshot.layoutState.kind === 'locked') return LOCKED_INVENTORY;
    if (snapshot.layoutState.kind === 'unopenable') {
        return Object.freeze({ kind: 'unavailable', reason: 'unopenable' });
    }
    if (snapshot.layoutState.kind === 'unsupported') {
        return Object.freeze({ kind: 'unavailable', reason: 'unsupported' });
    }
    if (snapshot.layoutState.kind === 'loading' || snapshot.incomplete || snapshot.loading !== 'idle') {
        return LOADING_INVENTORY;
    }
    if (snapshot.reachability !== 'reachable' || snapshot.freshness !== 'fresh') {
        return OFFLINE_INVENTORY;
    }
    return AUTHORITATIVE_INVENTORY;
}

/**
 * Joins presentation-only references to the canonical Board projection.
 *
 * Missing records remain visible as recoverable local references; this owner
 * never prunes or replaces them and never copies shared item content. An absent
 * record is terminal ONLY when the exact Board repository has an authoritative
 * inventory — otherwise it is pending, so a slow page, an offline Home or a
 * refused read cannot masquerade as a deletion.
 */
export function resolveSessionCompanionContentItems(input: Readonly<{
    refs: readonly SessionCompanionItemRefV1[];
    boardItemsById: ReadonlyMap<string, SessionBoardItemProjection>;
    inventory: SessionCompanionBoardInventory;
}>): readonly SessionCompanionContentItem[] {
    return Object.freeze(input.refs.map((ref): SessionCompanionContentItem => {
        if (ref.kind === 'builtin') return Object.freeze({ kind: 'summary', ref });
        const item = input.boardItemsById.get(ref.widgetId);
        if (item) return Object.freeze({ kind: 'widget', ref, item });
        return input.inventory.kind === 'authoritative'
            ? Object.freeze({ kind: 'missing_widget', ref })
            : Object.freeze({ kind: 'pending_widget', ref, inventory: input.inventory });
    }));
}
