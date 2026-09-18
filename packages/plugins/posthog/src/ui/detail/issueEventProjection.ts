/**
 * The sampled-event boundary projector.
 *
 * PostHog's sampled exception events carry an open, customer-controlled properties bag.
 * This projector runs immediately after strict DTO parsing and before any controller
 * state, panel state, reference candidate, or publication is constructed, and it is the
 * only path by which a sampled event's content becomes usable.
 *
 * It is an allowlist, not a redaction pass: it copies the exact fields the Occurrences,
 * Stack Trace, and Affected Sessions views need and drops everything else, including
 * `distinct_id` and every property outside that list. Code variables are Tier-3
 * display-only data and are never projected here, so they cannot reach retained state,
 * a Composer reference, a log, or a model input through this seam.
 *
 * It deliberately does not invent nested field or count ceilings. A selected event's
 * Composer resolver separately fits whole semantic items against the canonical
 * reference-resolution schema and reports omissions caused by that real boundary.
 */

import { normalizeTriageSingleLineV1 } from '@happier-dev/triage-protocol/v1';

export type PosthogProjectedFrame = Readonly<{
    function?: string;
    source?: string;
    line?: number;
    column?: number;
    inApp?: boolean;
}>;

export type PosthogProjectedException = Readonly<{
    type?: string;
    value?: string;
    frames: readonly PosthogProjectedFrame[];
}>;

/** The complete set of sampled-event content the source may hold or render. */
export type PosthogProjectedIssueEvent = Readonly<{
    uuid: string;
    timestampMs?: number;
    /**
     * This row's own absolute offset in the frozen sampled query that produced it.
     *
     * It is provider geometry rather than provider content: the exact address the
     * selected-evidence reread and the code-variable reveal re-request, carried per row
     * because skipped siblings and envelope fitting both change list positions without
     * changing what the provider numbered. It is optional only so a mounted detail
     * paired with an older daemon still reads samples normally; a row without it
     * discloses no evidence rather than being addressed by its list index.
     */
    providerOffset?: number;
    /** `$session_id`, used only to derive Affected Sessions candidates. */
    sessionId?: string;
    /** `$current_url`, used only for the URL column and permalink inputs. */
    url?: string;
    exceptions: readonly PosthogProjectedException[];
}>;

type RawEventInput = Readonly<{
    uuid: string;
    timestampMs?: number;
    pageRowIndex: number;
    rawProperties: Readonly<Record<string, unknown>>;
}>;

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function readSafeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/**
 * One single-line display value, normalized by the shared Triage grammar owner.
 */
function readProjectedString(value: unknown): string | null {
    const raw = readString(value);
    if (raw === null) {
        return null;
    }
    const normalized = normalizeTriageSingleLineV1(raw);
    return normalized.length > 0 ? normalized : null;
}

function projectFrame(value: unknown): PosthogProjectedFrame | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const raw = value as Readonly<Record<string, unknown>>;
    const fn = readProjectedString(raw['function']);
    const source = readProjectedString(raw['source']);
    const line = readSafeInteger(raw['line']);
    const column = readSafeInteger(raw['column']);
    const inApp = typeof raw['in_app'] === 'boolean' ? raw['in_app'] : null;
    if (fn === null && source === null && line === null && column === null && inApp === null) {
        return null;
    }
    return {
        ...(fn === null ? {} : { function: fn }),
        ...(source === null ? {} : { source }),
        ...(line === null ? {} : { line }),
        ...(column === null ? {} : { column }),
        ...(inApp === null ? {} : { inApp }),
    };
}

function projectException(value: unknown): PosthogProjectedException | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const raw = value as Readonly<Record<string, unknown>>;
    const type = readProjectedString(raw['type']);
    const exceptionValue = readProjectedString(raw['value']);
    const frames: PosthogProjectedFrame[] = [];
    const stacktrace = raw['stacktrace'];
    if (typeof stacktrace === 'object' && stacktrace !== null && !Array.isArray(stacktrace)) {
        const rawFrames = (stacktrace as Readonly<Record<string, unknown>>)['frames'];
        if (Array.isArray(rawFrames)) {
            for (const rawFrame of rawFrames) {
                const frame = projectFrame(rawFrame);
                if (frame !== null) {
                    frames.push(frame);
                }
            }
        }
    }
    if (type === null && exceptionValue === null && frames.length === 0) {
        return null;
    }
    return {
        ...(type === null ? {} : { type }),
        ...(exceptionValue === null ? {} : { value: exceptionValue }),
        frames,
    };
}

function projectEvent(event: RawEventInput, pageOffset: number): PosthogProjectedIssueEvent {
    const properties = event.rawProperties;
    const sessionId = readProjectedString(properties['$session_id']);
    const url = readProjectedString(properties['$current_url']);
    const exceptions: PosthogProjectedException[] = [];
    const rawExceptions = properties['$exception_list'];
    if (Array.isArray(rawExceptions)) {
        for (const rawException of rawExceptions) {
            const projected = projectException(rawException);
            if (projected !== null) {
                exceptions.push(projected);
            }
        }
    }
    // Identity is never shortened: a truncated UUID would address a different event.
    return {
        uuid: event.uuid,
        ...(event.timestampMs === undefined ? {} : { timestampMs: event.timestampMs }),
        providerOffset: pageOffset + event.pageRowIndex,
        ...(sessionId === null ? {} : { sessionId }),
        ...(url === null ? {} : { url }),
        exceptions,
    };
}

/**
 * Projects one accepted page.
 *
 * `pageOffset` is the offset the source requested, not one the response echoed: it is the
 * number a later one-row reread reproduces, so each row's address is stated in the same
 * terms the reread will use.
 */
export function projectPosthogIssueEvents(
    events: readonly RawEventInput[],
    pageOffset: number,
): readonly PosthogProjectedIssueEvent[] {
    return events.map((event) => projectEvent(event, pageOffset));
}
