import type { SessionListFetchResult } from './sessionSnapshot';

export type OrdinarySessionListFrontier = Readonly<{
    nextCursor: string | null;
    hasNext: boolean;
    attentionNextCursor: string | null;
    attentionHasNext: boolean;
}>;

export type OrdinarySessionListContinuation =
    | Readonly<{ kind: 'ordinary'; cursor: string }>
    | Readonly<{ kind: 'attention'; cursor: string }>;

export const EMPTY_ORDINARY_SESSION_LIST_FRONTIER: OrdinarySessionListFrontier = {
    nextCursor: null,
    hasNext: false,
    attentionNextCursor: null,
    attentionHasNext: false,
};

export function resolveOrdinarySessionListContinuation(
    frontier: OrdinarySessionListFrontier,
): OrdinarySessionListContinuation | null {
    if (frontier.hasNext && frontier.nextCursor) {
        return { kind: 'ordinary', cursor: frontier.nextCursor };
    }
    if (frontier.attentionHasNext && frontier.attentionNextCursor) {
        return { kind: 'attention', cursor: frontier.attentionNextCursor };
    }
    return null;
}

export function advanceOrdinarySessionListFrontier(params: Readonly<{
    previous: OrdinarySessionListFrontier;
    continuation: OrdinarySessionListContinuation | null;
    result: SessionListFetchResult;
}>): OrdinarySessionListFrontier {
    const { continuation, previous, result } = params;
    if (!continuation) {
        return {
            nextCursor: result.hasNext ? result.nextCursor : null,
            hasNext: result.hasNext,
            attentionNextCursor: result.attentionHasNext ? result.attentionNextCursor : null,
            attentionHasNext: result.attentionHasNext,
        };
    }
    if (continuation.kind === 'ordinary') {
        if (result.hasNext && (!result.nextCursor || result.nextCursor === continuation.cursor)) {
            throw new Error('Ordinary Session-list cursor did not advance');
        }
        return {
            ...previous,
            nextCursor: result.hasNext ? result.nextCursor : null,
            hasNext: result.hasNext,
        };
    }
    if (
        result.attentionHasNext
        && (!result.attentionNextCursor || result.attentionNextCursor === continuation.cursor)
    ) {
        throw new Error('Ordinary Session-list attention cursor did not advance');
    }
    return {
        ...previous,
        attentionNextCursor: result.attentionHasNext ? result.attentionNextCursor : null,
        attentionHasNext: result.attentionHasNext,
    };
}

export function isOrdinarySessionListFrontierComplete(
    frontier: OrdinarySessionListFrontier,
): boolean {
    return !frontier.hasNext && !frontier.attentionHasNext;
}
