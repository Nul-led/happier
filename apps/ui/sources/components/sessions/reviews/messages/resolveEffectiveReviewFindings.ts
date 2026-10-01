import type { ReviewFinding, ReviewFollowUpV1 } from '@happier-dev/protocol';
import { ReviewFollowUpV1Schema as ReviewFollowUpSchema } from '@happier-dev/protocol';

import type { Message } from "@happier-dev/session-core/messages";
import { parseHappierMetaEnvelope } from '@/components/sessions/transcript/structured/happierMetaEnvelope';

type RunRef = Readonly<{
    runId: string;
    callId: string;
    backendId: string;
}>;

/** One question asked about a finding and the reviewer's answer (`review.follow_up`). */
export type ReviewFindingThreadEntry = Readonly<{
    threadId: string;
    requestMarkdown: string;
    answerMarkdown: string;
    generatedAtMs: number;
    /** The finding as the answer left it, when the answer changed it. */
    updatedFinding: ReviewFinding | null;
    /** The finding as it was before this answer, when the answer changed it. */
    previousFinding: ReviewFinding | null;
}>;

export type EffectiveReviewFindings = Readonly<{
    /** The latest version of every finding, in the order the review first reported them. */
    findings: readonly ReviewFinding[];
    threadRefsByFindingId: Readonly<Record<string, readonly string[]>>;
    /** The questions asked about each finding and their answers, oldest first. */
    threadsByFindingId: Readonly<Record<string, readonly ReviewFindingThreadEntry[]>>;
    /** The finding as the review first reported it, for findings a later answer changed. */
    originalByFindingId: Readonly<Record<string, ReviewFinding>>;
}>;

function isSameRunRef(left: RunRef, right: RunRef): boolean {
    return left.runId === right.runId
        && left.callId === right.callId
        && left.backendId === right.backendId;
}

function parseReviewFollowUp(message: Message): ReviewFollowUpV1 | null {
    const envelope = parseHappierMetaEnvelope(message.meta);
    if (!envelope || envelope.kind !== 'review_follow_up.v1') return null;
    const parsed = ReviewFollowUpSchema.safeParse(envelope.payload);
    if (!parsed.success) return null;
    return parsed.data;
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
    const values = map.get(key) ?? [];
    if (!values.includes(value)) values.push(value);
    map.set(key, values);
}

/**
 * The owner of a review's latest findings and of the thread under each finding: a finding's
 * questions are the `review_follow_up.v1` answers that name it (by `findingIds` or by updating it),
 * and an answer that updates a finding becomes that finding's latest version.
 */
export function resolveEffectiveReviewFindings(params: Readonly<{
    runRef: RunRef;
    initialFindings: readonly ReviewFinding[];
    messages: readonly Message[];
}>): EffectiveReviewFindings {
    const findingById = new Map<string, ReviewFinding>();
    const orderedFindingIds: string[] = [];
    const threadRefsByFindingId = new Map<string, string[]>();
    const threadsByFindingId = new Map<string, ReviewFindingThreadEntry[]>();
    const originalByFindingId = new Map<string, ReviewFinding>();

    for (const finding of params.initialFindings) {
        if (findingById.has(finding.id)) continue;
        orderedFindingIds.push(finding.id);
        findingById.set(finding.id, finding);
    }

    for (const message of params.messages) {
        const followUp = parseReviewFollowUp(message);
        if (!followUp || !isSameRunRef(followUp.parentRunRef, params.runRef)) continue;
        const updatedById = new Map((followUp.updatedFindings ?? []).map((finding) => [finding.id, finding] as const));
        const askedIds = new Set<string>([...(followUp.findingIds ?? []), ...updatedById.keys()]);

        for (const findingId of askedIds) {
            const previous = findingById.get(findingId) ?? null;
            const updated = updatedById.get(findingId) ?? null;
            if (updated) {
                if (!findingById.has(findingId)) orderedFindingIds.push(findingId);
                if (previous && !originalByFindingId.has(findingId)) originalByFindingId.set(findingId, previous);
                findingById.set(findingId, updated);
                pushUnique(threadRefsByFindingId, findingId, followUp.threadId);
            }
            if (!findingById.has(findingId)) continue;
            const entries = threadsByFindingId.get(findingId) ?? [];
            entries.push({
                threadId: followUp.threadId,
                requestMarkdown: followUp.requestMarkdown,
                answerMarkdown: followUp.answerMarkdown,
                generatedAtMs: followUp.generatedAtMs,
                updatedFinding: updated,
                previousFinding: updated ? previous : null,
            });
            threadsByFindingId.set(findingId, entries);
        }
    }

    return {
        findings: orderedFindingIds
            .map((findingId) => findingById.get(findingId))
            .filter((finding): finding is ReviewFinding => Boolean(finding)),
        threadRefsByFindingId: Object.fromEntries(
            Array.from(threadRefsByFindingId.entries()).map(([findingId, threadRefs]) => [findingId, [...threadRefs]]),
        ),
        threadsByFindingId: Object.fromEntries(threadsByFindingId.entries()),
        originalByFindingId: Object.fromEntries(originalByFindingId.entries()),
    };
}
