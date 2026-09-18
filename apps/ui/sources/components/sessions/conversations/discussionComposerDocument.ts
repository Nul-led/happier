import {
    SessionDiscussionAccountIdSchema,
    type SessionDiscussionMessageContentV1,
} from '@happier-dev/protocol';

export type DiscussionMentionSpan = Readonly<{
    start: number;
    end: number;
    accountId: string;
}>;

/** Resolves an optional manual title without adding a second UI limit owner. */
export function resolveSessionDiscussionCreationTitle(input: Readonly<{
    title: string;
    text: string;
    mentions?: readonly DiscussionMentionSpan[];
}>): string | null {
    const manualTitle = input.title.trim();
    if (manualTitle) return manualTitle.normalize('NFC');
    const textWithoutResolvedMentions = [...(input.mentions ?? [])]
        .sort((left, right) => right.start - left.start)
        .reduce((text, mention) => (
            mention.start >= 0 && mention.end > mention.start && mention.end <= text.length
                ? `${text.slice(0, mention.start)}${text.slice(mention.end)}`
                : text
        ), input.text);
    const derived = textWithoutResolvedMentions
        .split(/\r?\n/u)
        .find((line) => line.trim().length > 0)
        ?.trim()
        .normalize('NFC');
    return derived || null;
}

/**
 * Opens the human draft's intentionally JSON-shaped mention field into the one
 * composer representation. Invalid or overlapping spans remain ordinary text;
 * they never manufacture an Account identity from a visible `@label`.
 */
export function parseDiscussionMentionSpans(
    value: unknown,
    text: string,
): readonly DiscussionMentionSpan[] {
    if (!Array.isArray(value)) return [];
    const candidates = value.flatMap((entry): readonly DiscussionMentionSpan[] => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        if (Object.keys(entry).sort().join(',') !== 'accountId,end,start') return [];
        const candidate = entry as Record<string, unknown>;
        const accountId = SessionDiscussionAccountIdSchema.safeParse(candidate.accountId);
        if (
            !accountId.success
            || !Number.isSafeInteger(candidate.start)
            || !Number.isSafeInteger(candidate.end)
        ) return [];
        const start = candidate.start as number;
        const end = candidate.end as number;
        if (start < 0 || end <= start || end > text.length) return [];
        const visible = text.slice(start, end);
        const before = text.slice(Math.max(0, start - 1), start);
        const after = text.slice(end, end + 1);
        if (
            !visible.startsWith('@')
            || visible.length === 1
            || (start > 0 && !/\s/u.test(before))
            || /[\p{L}\p{N}_]/u.test(after)
        ) return [];
        return [{ start, end, accountId: accountId.data }];
    }).sort((left, right) => left.start - right.start || left.end - right.end);

    let greatestPreviousEnd = -1;
    return candidates.filter((candidate, index) => {
        const overlapsPrevious = greatestPreviousEnd > candidate.start;
        greatestPreviousEnd = Math.max(greatestPreviousEnd, candidate.end);
        const overlapsNext = (candidates[index + 1]?.start ?? Number.POSITIVE_INFINITY) < candidate.end;
        // An ambiguous range is not resolved by array order. Every conflicting
        // entry remains plain text instead of choosing an Account identity.
        return !overlapsPrevious && !overlapsNext;
    });
}

export function readActiveDiscussionMentionQuery(
    text: string,
    cursor: number,
): Readonly<{ start: number; query: string }> | null {
    const prefix = text.slice(0, cursor);
    const match = /(?:^|\s)@([^\s@]*)$/u.exec(prefix);
    if (!match) return null;
    return { start: cursor - match[1]!.length - 1, query: match[1]! };
}

function readChangedRange(previousText: string, nextText: string): Readonly<{
    previousStart: number;
    previousEnd: number;
    delta: number;
}> {
    const sharedLength = Math.min(previousText.length, nextText.length);
    let prefixLength = 0;
    while (
        prefixLength < sharedLength
        && previousText.charCodeAt(prefixLength) === nextText.charCodeAt(prefixLength)
    ) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    while (
        suffixLength < sharedLength - prefixLength
        && previousText.charCodeAt(previousText.length - suffixLength - 1)
            === nextText.charCodeAt(nextText.length - suffixLength - 1)
    ) {
        suffixLength += 1;
    }

    return {
        previousStart: prefixLength,
        previousEnd: previousText.length - suffixLength,
        delta: nextText.length - previousText.length,
    };
}

/**
 * Keeps selected Account identity attached only while its complete visible
 * token survives an edit. This is a document transform, not cursor policy:
 * every UI host (native/web and synchronized draft replay) gets identical
 * mention behavior without trusting a freshly typed `@label` as identity.
 */
export function reconcileDiscussionMentionSpans(params: Readonly<{
    previousText: string;
    nextText: string;
    mentions: readonly DiscussionMentionSpan[];
}>): readonly DiscussionMentionSpan[] {
    if (params.previousText === params.nextText) return params.mentions;
    const change = readChangedRange(params.previousText, params.nextText);

    return params.mentions.flatMap((mention) => {
        const preserve = (candidate: DiscussionMentionSpan): readonly DiscussionMentionSpan[] => {
            const previousToken = params.previousText.slice(mention.start, mention.end);
            if (params.nextText.slice(candidate.start, candidate.end) !== previousToken) return [];
            const before = params.nextText.slice(Math.max(0, candidate.start - 1), candidate.start);
            const after = params.nextText.slice(candidate.end, candidate.end + 1);
            if ((candidate.start > 0 && !/\s/u.test(before)) || /[\p{L}\p{N}_]/u.test(after)) return [];
            return [candidate];
        };
        if (mention.end <= change.previousStart) return preserve(mention);
        if (mention.start >= change.previousEnd) {
            return preserve({
                ...mention,
                start: mention.start + change.delta,
                end: mention.end + change.delta,
            });
        }
        return [];
    });
}

export function insertDiscussionMention(params: Readonly<{
    text: string;
    mentions: readonly DiscussionMentionSpan[];
    queryStart: number;
    selectionEnd: number;
    visibleToken: string;
    accountId: string;
}>): Readonly<{
    text: string;
    mentions: readonly DiscussionMentionSpan[];
    selection: Readonly<{ start: number; end: number }>;
}> {
    const suffix = params.text.slice(params.selectionEnd);
    const separator = /^\s/u.test(suffix) ? '' : ' ';
    const text = `${params.text.slice(0, params.queryStart)}${params.visibleToken}${separator}${suffix}`;
    const mentions = reconcileDiscussionMentionSpans({
        previousText: params.text,
        nextText: text,
        mentions: params.mentions,
    });
    const cursor = params.queryStart + params.visibleToken.length + 1;
    return {
        text,
        mentions: [
            ...mentions,
            {
                start: params.queryStart,
                end: params.queryStart + params.visibleToken.length,
                accountId: params.accountId,
            },
        ].sort((left, right) => left.start - right.start),
        selection: { start: cursor, end: cursor },
    };
}

export function buildSessionDiscussionContent(
    text: string,
    mentions: readonly DiscussionMentionSpan[],
): SessionDiscussionMessageContentV1 {
    const parts: SessionDiscussionMessageContentV1['parts'][number][] = [];
    let offset = 0;
    for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
        if (
            mention.start < offset
            || mention.end <= mention.start
            || mention.end > text.length
        ) {
            continue;
        }
        if (mention.start > offset) {
            parts.push({ t: 'text', text: text.slice(offset, mention.start).normalize('NFC') });
        }
        parts.push({ t: 'mention', accountId: mention.accountId });
        offset = mention.end;
    }
    if (offset < text.length) parts.push({ t: 'text', text: text.slice(offset).normalize('NFC') });
    return { v: 1, parts };
}

export function buildSessionDiscussionContentFromPendingText(input: Readonly<{
    previousText: string;
    pendingText: string;
    mentions: readonly DiscussionMentionSpan[];
}>): SessionDiscussionMessageContentV1 {
    return buildSessionDiscussionContent(input.pendingText, reconcileDiscussionMentionSpans({
        previousText: input.previousText,
        nextText: input.pendingText,
        mentions: input.mentions,
    }));
}
