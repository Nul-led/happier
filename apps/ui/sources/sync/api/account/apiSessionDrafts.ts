import {
    SESSION_DRAFT_ROUTE_LIST,
    SESSION_DRAFT_ROUTE_MUTATE,
    SESSION_DRAFT_ROUTE_READ,
    SESSION_DRAFT_V2_ROUTE_LIST,
    SESSION_DRAFT_V2_ROUTE_MUTATE,
    SESSION_DRAFT_V2_ROUTE_READ,
    SessionDraftEpochUnavailableResponseV2Schema,
    SessionDraftListRequestV2Schema,
    SessionDraftListResponseV2Schema,
    SessionDraftMutateRequestV1Schema,
    SessionDraftMutateRequestV2Schema,
    SessionDraftMutateResponseV2Schema,
    SessionDraftReadRequestV1Schema,
    SessionDraftReadRequestV2Schema,
    SessionDraftReadResponseV2Schema,
    SessionDraftStoredContentEnvelopeV1Schema,
    isSessionDraftAddressV1,
    isSessionDraftContentV1,
    restoreSupportedPredecessorNewSessionDraftPayloadV2,
    type SessionDraftAddressV2,
    type SupportedPredecessorNewSessionDraftContentV1,
} from '@happier-dev/protocol';

import type { SessionDraftRepositoryTransport } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { SessionDraftEpochUnavailableError, isSessionDraftEpochUnavailableError } from '@/sync/ops/sessionDrafts/sessionDraftEpochError';

/** Statuses a Home without the V2 draft epoch returns for these exact paths. */
const EPOCH_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedPredecessorV1Content(
    content: SupportedPredecessorNewSessionDraftContentV1,
): boolean {
    if (SessionDraftStoredContentEnvelopeV1Schema.safeParse(content).success) return true;
    return content.t === 'plain'
        && restoreSupportedPredecessorNewSessionDraftPayloadV2(content.v) !== null;
}

function normalizeSupportedPredecessorRecord(value: unknown): unknown {
    if (!isRecord(value) || !isRecord(value.content) || value.content.t !== 'plain') return value;
    const payload = restoreSupportedPredecessorNewSessionDraftPayloadV2(value.content.v);
    return payload ? { ...value, content: { t: 'plain', v: payload } } : value;
}

/** Lift only the strict response positions owned by the Session-draft routes. */
function normalizeSupportedPredecessorResponse(value: unknown): unknown {
    if (!isRecord(value)) return value;
    if (Array.isArray(value.items)) {
        return { ...value, items: value.items.map(normalizeSupportedPredecessorRecord) };
    }
    if (value.status === 'present' || value.status === 'deleted' || value.status === 'updated') {
        return { ...value, record: normalizeSupportedPredecessorRecord(value.record) };
    }
    if (value.status === 'conflict' && isRecord(value.current) && value.current.status !== 'absent') {
        return { ...value, current: normalizeSupportedPredecessorRecord(value.current) };
    }
    return value;
}

async function postJson(params: Readonly<{
    request: (path: string, init?: RequestInit) => Promise<Response>;
    path: string;
    body: unknown;
    epoch: 'v1' | 'v2';
}>): Promise<unknown> {
    const response = await params.request(params.path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.body),
    });
    let raw: unknown;
    try {
        raw = await response.json();
    } catch {
        raw = null;
    }
    if (!response.ok) {
        // An unsupported V2 operation keeps the local draft; it is never retried
        // through V1 or coerced onto another address.
        if ((params.epoch === 'v2' && EPOCH_UNAVAILABLE_STATUSES.has(response.status))
            || (response.status === 409 && SessionDraftEpochUnavailableResponseV2Schema.safeParse(raw).success)) {
            throw new SessionDraftEpochUnavailableError();
        }
        throw new Error(`Session draft request failed (${response.status})`);
    }
    return raw;
}

/**
 * One transport over both route epochs. Compatible content retains V1 writes;
 * successor addresses or new-session intent use V2 at the same service owner.
 */
export function createApiSessionDraftsTransport(params: Readonly<{
    /** Exact Home/Account request captured by the canonical scoped-request owner. */
    request: (path: string, init?: RequestInit) => Promise<Response>;
}>): SessionDraftRepositoryTransport {
    const epochOf = (address: SessionDraftAddressV2): 'v1' | 'v2' => (
        isSessionDraftAddressV1(address) ? 'v1' : 'v2'
    );
    return {
        read: async (address: SessionDraftAddressV2) => {
            const epoch = epochOf(address);
            const request = epoch === 'v1'
                ? SessionDraftReadRequestV1Schema.parse({ address })
                : SessionDraftReadRequestV2Schema.parse({ address });
            let raw: unknown;
            try {
                raw = await postJson({
                request: params.request,
                path: epoch === 'v1' ? SESSION_DRAFT_ROUTE_READ : SESSION_DRAFT_V2_ROUTE_READ,
                body: request,
                epoch,
                });
            } catch (error) {
                if (epoch !== 'v1' || !isSessionDraftEpochUnavailableError(error)) throw error;
                raw = await postJson({ request: params.request, path: SESSION_DRAFT_V2_ROUTE_READ, body: request, epoch: 'v2' });
            }
            const parsed = SessionDraftReadResponseV2Schema.safeParse(normalizeSupportedPredecessorResponse(raw));
            if (!parsed.success) throw new Error('Invalid session draft response');
            return parsed.data;
        },
        list: async (request) => {
            const body = SessionDraftListRequestV2Schema.parse(request);
            let raw: unknown;
            try {
                raw = await postJson({ request: params.request, path: SESSION_DRAFT_V2_ROUTE_LIST, body, epoch: 'v2' });
            } catch (error) {
                if (request.addressKinds || !isSessionDraftEpochUnavailableError(error)) throw error;
                raw = await postJson({ request: params.request, path: SESSION_DRAFT_ROUTE_LIST, body, epoch: 'v1' });
            }
            const parsed = SessionDraftListResponseV2Schema.safeParse(normalizeSupportedPredecessorResponse(raw));
            if (!parsed.success) throw new Error('Invalid session draft response');
            return parsed.data;
        },
        mutate: async (request, compatibility) => {
            const epoch = epochOf(request.address) === 'v1' && isSessionDraftContentV1(request.content) ? 'v1' : 'v2';
            const body = epoch === 'v1'
                ? SessionDraftMutateRequestV1Schema.parse(request)
                : SessionDraftMutateRequestV2Schema.parse(request);
            let raw: unknown;
            try {
                raw = await postJson({
                request: params.request,
                path: epoch === 'v1' ? SESSION_DRAFT_ROUTE_MUTATE : SESSION_DRAFT_V2_ROUTE_MUTATE,
                body,
                epoch,
                });
            } catch (error) {
                if (epoch === 'v1' && isSessionDraftEpochUnavailableError(error)) {
                    raw = await postJson({ request: params.request, path: SESSION_DRAFT_V2_ROUTE_MUTATE, body, epoch: 'v2' });
                } else if (
                    epoch === 'v2'
                    && request.address.kind === 'newSession'
                    && compatibility
                    && isSupportedPredecessorV1Content(compatibility.supportedPredecessorV1Content)
                    && isSessionDraftEpochUnavailableError(error)
                ) {
                    raw = await postJson({
                        request: params.request,
                        path: SESSION_DRAFT_ROUTE_MUTATE,
                        body: {
                            address: request.address,
                            expectedRevision: request.expectedRevision,
                            content: compatibility.supportedPredecessorV1Content,
                        },
                        epoch: 'v1',
                    });
                } else {
                    throw error;
                }
            }
            const parsed = SessionDraftMutateResponseV2Schema.safeParse(normalizeSupportedPredecessorResponse(raw));
            if (!parsed.success) throw new Error('Invalid session draft response');
            return parsed.data;
        },
    };
}
