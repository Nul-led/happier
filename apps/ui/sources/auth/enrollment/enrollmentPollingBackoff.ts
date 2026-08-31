const ENROLLMENT_POLL_BASE_DELAY_MS = 1_000;
const ENROLLMENT_POLL_MAX_DELAY_MS = 5_000;
const ENROLLMENT_POLL_JITTER_MS = 250;

/** Canonical bounded retry delay for user-initiated enrollment polling. */
export function enrollmentPollingBackoffMs(failureCount: number): number {
    const exponential = Math.min(
        ENROLLMENT_POLL_BASE_DELAY_MS * 2 ** Math.max(0, failureCount - 1),
        ENROLLMENT_POLL_MAX_DELAY_MS,
    );
    return exponential + Math.floor(Math.random() * ENROLLMENT_POLL_JITTER_MS);
}

export const ENROLLMENT_POLL_IDLE_DELAY_MS = ENROLLMENT_POLL_BASE_DELAY_MS;
