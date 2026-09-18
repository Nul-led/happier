import {
    SessionAccessErrorCodeV1Schema,
    type SessionAccessErrorCodeV1,
} from '@happier-dev/protocol';

export type SessionAccessHttpFailureCode =
    | SessionAccessErrorCodeV1
    | 'unsupported_action'
    | 'session_access_request_failed';

/**
 * Classifies only the shared Session-access HTTP envelope.
 *
 * A disabled canonical feature gate deliberately returns the exact legacy
 * `{ error: "not_found" }` 404. Current domain routes instead name their
 * missing-Session result in the strict Session-access error union. Keeping
 * this distinction here prevents individual grant/responsibility consumers
 * from turning every 404 into either an update requirement or a missing row.
 */
export function readSessionAccessHttpFailureCode(
    payload: unknown,
    status: number,
): SessionAccessHttpFailureCode {
    const record = typeof payload === 'object' && payload !== null
        ? payload as Readonly<Record<string, unknown>>
        : {};
    if (status === 404 && record.error === 'not_found') return 'unsupported_action';
    const code = SessionAccessErrorCodeV1Schema.safeParse(record.error);
    return code.success ? code.data : 'session_access_request_failed';
}
