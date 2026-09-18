const PROVEN_NO_SERVER_DISPATCH_CODES = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
]);

function readErrorCode(error: unknown, depth = 0): string | null {
    if (!error || typeof error !== 'object' || depth > 3) return null;
    const record = error as Readonly<{ code?: unknown; cause?: unknown }>;
    if (typeof record.code === 'string' && record.code.trim().length > 0) {
        return record.code.trim().toUpperCase();
    }
    return readErrorCode(record.cause, depth + 1);
}

/**
 * Classify a failed HTTP mutation from the canonical transport witness.
 *
 * `issued` means every local authority/setup guard passed and the request was
 * handed to the transport. It deliberately does not claim that the server
 * received bytes. A small set of connection-establishment failures can still
 * prove that it did not; every other post-issue loss remains ambiguous.
 */
export function classifyHttpMutationRequestFailure(input: Readonly<{
    error: unknown;
    issued: boolean;
    signal?: AbortSignal;
}>): 'cancelled' | 'not_dispatched' | 'outcome_unknown' {
    const aborted = input.signal?.aborted === true
        || (input.error instanceof Error && input.error.name === 'AbortError');
    if (!input.issued) return aborted ? 'cancelled' : 'not_dispatched';
    return PROVEN_NO_SERVER_DISPATCH_CODES.has(readErrorCode(input.error) ?? '')
        ? 'not_dispatched'
        : 'outcome_unknown';
}
