import { normalizeNonEmptyString } from '@/voice/shared/normalizeNonEmptyString';
import { segmentInterruptionWords } from './segmentInterruptionWords';

/**
 * Canonical normalization for backchannel / interruption transcript matching.
 *
 * Canonicalizes Unicode, lowercases, collapses punctuation to spaces and trims —
 * so `"Yeah, exactly!"` and `"yeah exactly"` compare equal. Shared by the
 * backchannel filter and the runtime turn-policy controller so the two paths
 * cannot drift.
 */
export function normalizeInterruptionTranscript(value: string | null | undefined): string {
    const normalized = normalizeNonEmptyString(value) ?? '';
    if (!normalized) {
        return '';
    }

    const meaningful = normalized
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    // Preserve combining marks in actual language, but marks/emoji/punctuation
    // alone still carry no transcript meaning.
    return /[\p{L}\p{N}]/u.test(meaningful) ? meaningful : '';
}

/** Meaningful word tokens, including dictionary boundaries in unspaced scripts. */
export function interruptionTranscriptWords(value: string | null | undefined): string[] {
    const normalized = normalizeInterruptionTranscript(value);
    if (!normalized) return [];
    return segmentInterruptionWords(normalized).filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/** Word count of the normalized transcript (0 for empty). */
export function countInterruptionWords(value: string | null | undefined): number {
    return interruptionTranscriptWords(value).length;
}
