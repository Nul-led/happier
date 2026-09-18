import {
    bindSessionAccessActionHttpRequestV1,
    getActionSpec,
    isSessionAccessActionIdV1,
    SessionGrantMutationV1Schema,
    UserRecipientEnvelopeResponseSchema,
    SessionAccessGrantsListResponseV1Schema,
    SetSessionAccessGrantResponseV1Schema,
    RemoveSessionAccessGrantResponseV1Schema,
    SetSessionAccessContextResponseV1Schema,
    SessionPublicLinkGetActionResultV1Schema,
    SessionPublicLinkRemoveActionResultV1Schema,
    SessionPublicLinkSettingsV1Schema,
    projectSessionPublicLinkActionResultV1,
    type ActionId,
    type PrincipalRefV1,
    type SessionGrantIntentV1,
    type SessionGrantMutationV1,
} from '@happier-dev/protocol';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import { runWithServerRequestAuthorityForServerAccountScope } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { runWithServerAccountScopeRequestGuard } from '@/sync/runtime/orchestration/serverScopedRpc/serverAccountScopeRequestGuard';
import { readSessionSnapshotForAuthority, SessionSnapshotReadError } from '@/sync/runtime/orchestration/serverScopedRpc/readSessionSnapshotForAuthority';
import { readTransferableSessionDataKey } from '@/sync/encryption/readTransferableSessionDataKey';
import { encryptDataKeyForRecipientV0, verifyRecipientContentPublicKeyBinding } from '@/sync/encryption/directShareEncryption';
import { encryptDataKeyForPublicShare } from '@/sync/encryption/publicShareEncryption';
import { generateSessionPublicLinkBearer } from '@/sync/domains/social/sessionPublicLinkPublication';
import type { ServerAccountRequestAuthority } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { captureEncryptionGenerationCurrentness } from '@/sync/encryption/encryption';
import { readSessionAccessHttpFailureCode } from './sessionAccessHttpFailure';

export class SessionAccessApiError extends Error {
    constructor(readonly code: string, readonly status?: number) {
        super(code);
        this.name = 'SessionAccessApiError';
    }
}

/** Preserve the Protocol-owned typed Session-access error at every HTTP consumer. */
export function createSessionAccessApiErrorFromResponse(
    payload: unknown,
    status: number,
): SessionAccessApiError {
    return new SessionAccessApiError(readSessionAccessHttpFailureCode(payload, status), status);
}

export type SessionAccessRequestOptions = Readonly<{
    scope: ServerAccountScope;
    availability: SessionCollaborationAvailability;
    isCurrent?: () => boolean;
    signal?: AbortSignal;
    /**
     * Observes the bearer this trusted host generated for a new publication.
     *
     * The public Action result never carries the bearer, and the Home stores
     * only its hash, so the generating device is the one place it can be kept.
     * It is reported before dispatch so the mounted host retains the same
     * bearer while this executor performs its one exact physical replay after
     * an ambiguous response.
     */
    onPublicLinkBearerIssued?: (token: string) => void;
}>;

async function materializeDirectAccountEnvelope(params: Readonly<{
    authority: ServerAccountRequestAuthority;
    check(): void;
    sessionId: string;
    mutation: SessionGrantMutationV1;
}>): Promise<Readonly<{
    mutation: SessionGrantMutationV1;
    retainedEnvelopeFallback: boolean;
    checkCurrentness: () => void;
}>> {
    if (params.mutation.subject.kind !== 'account') {
        return { mutation: params.mutation, retainedEnvelopeFallback: false, checkCurrentness: params.check };
    }
    const encryption = params.authority.context.encryption;
    const encryptionCurrentness = captureEncryptionGenerationCurrentness(encryption, {
        serverId: params.authority.scope.serverId,
    });
    const checkEncryptionScope = () => {
        params.check();
        if (!encryptionCurrentness.isCurrent()) {
            throw new SessionAccessApiError('session_access_stale_scope');
        }
    };
    const snapshot = await readSessionSnapshotForAuthority({
        authority: params.authority,
        sessionId: params.sessionId,
        isCurrent: () => { checkEncryptionScope(); return true; },
    }).catch((error: unknown) => {
        if (error instanceof SessionSnapshotReadError && error.errorCode === 'stale_response') {
            throw new SessionAccessApiError('session_access_stale_scope');
        }
        throw error;
    });
    checkEncryptionScope();
    if ((snapshot.session.encryptionMode ?? 'e2ee') === 'plain') {
        return { mutation: params.mutation, retainedEnvelopeFallback: false, checkCurrentness: checkEncryptionScope };
    }

    const response = await params.authority.request(`/v1/user/${encodeURIComponent(params.mutation.subject.accountId)}`);
    checkEncryptionScope();
    const payload: unknown = await response.json();
    checkEncryptionScope();
    if (!response.ok) throw new SessionAccessApiError(response.status === 404 ? 'session_access_subject_not_found' : 'session_access_request_failed', response.status);
    const recipientProjection = UserRecipientEnvelopeResponseSchema.safeParse(payload);
    if (!recipientProjection.success) throw new SessionAccessApiError('unsupported_action');
    const recipient = recipientProjection.data.user;
    const readiness = recipient.recipientEnvelopeReadiness;
    if (readiness.status === 'unavailable') {
        // The canonical admission permits key-free access while recipient setup
        // or repair is required. Keep that authoritative reason with its owner:
        // no key is opened/sealed here, and no unavailable Account becomes ready.
        return { mutation: params.mutation, retainedEnvelopeFallback: false, checkCurrentness: checkEncryptionScope };
    }
    if (!recipient.publicKey || !recipient.contentPublicKey || !recipient.contentPublicKeySig) {
        throw new SessionAccessApiError('recipient_key_unavailable');
    }
    if (!verifyRecipientContentPublicKeyBinding({
        signingPublicKeyHex: recipient.publicKey,
        contentPublicKeyB64: recipient.contentPublicKey,
        contentPublicKeySigB64: recipient.contentPublicKeySig,
    })) throw new SessionAccessApiError('session_access_invalid_recipient_envelope');
    const sessionDataKey = await readTransferableSessionDataKey({
        callerDataKeyEnvelope: snapshot.callerDataKeyEnvelope,
        encryption,
    });
    checkEncryptionScope();
    if (!sessionDataKey) {
        // Revocation deliberately leaves a recipient tuple inert. Only the
        // physical transaction can prove that tuple is still structurally valid
        // and reusable; a missing/invalid tuple returns recipient_envelope_required
        // and is projected back to the public host error below.
        return { mutation: params.mutation, retainedEnvelopeFallback: true, checkCurrentness: checkEncryptionScope };
    }
    const encryptedDataKey = encryptDataKeyForRecipientV0(sessionDataKey, recipient.contentPublicKey);
    checkEncryptionScope();
    return {
        mutation: {
            ...params.mutation,
            accountEnvelopeInput: {
                v: 1,
                encryptedDataKey,
            },
        },
        retainedEnvelopeFallback: false,
        checkCurrentness: checkEncryptionScope,
    };
}

/**
 * Materializes the trusted-host publication material for a new public link.
 *
 * A public link is publication, not an access grant: the bearer is generated
 * here and the Home keeps only its hash, so the wrapped Session key is sealed
 * to that bearer by this host before the already-bound request is dispatched.
 * The public Action input stays bearer-free and key-free.
 */
async function materializePublicLinkCreateMaterial(params: Readonly<{
    authority: ServerAccountRequestAuthority;
    check(): void;
    sessionId: string;
}>): Promise<Readonly<{
    token: string;
    encryptedDataKey?: string;
    checkCurrentness: () => void;
}>> {
    const encryption = params.authority.context.encryption;
    const encryptionCurrentness = captureEncryptionGenerationCurrentness(encryption, {
        serverId: params.authority.scope.serverId,
    });
    const checkEncryptionScope = () => {
        params.check();
        if (!encryptionCurrentness.isCurrent()) {
            throw new SessionAccessApiError('session_access_stale_scope');
        }
    };
    const snapshot = await readSessionSnapshotForAuthority({
        authority: params.authority,
        sessionId: params.sessionId,
        isCurrent: () => { checkEncryptionScope(); return true; },
    }).catch((error: unknown) => {
        if (error instanceof SessionSnapshotReadError && error.errorCode === 'stale_response') {
            throw new SessionAccessApiError('session_access_stale_scope');
        }
        throw error;
    });
    checkEncryptionScope();
    // Authority stays with the Home transaction and with the mounted host's own
    // capability check; this leaf adds no second access decision.
    const token = generateSessionPublicLinkBearer();
    if ((snapshot.session.encryptionMode ?? 'e2ee') === 'plain') {
        return { token, checkCurrentness: checkEncryptionScope };
    }
    const sessionDataKey = await readTransferableSessionDataKey({
        callerDataKeyEnvelope: snapshot.callerDataKeyEnvelope,
        encryption,
    });
    checkEncryptionScope();
    if (!sessionDataKey) throw new SessionAccessApiError('session_data_key_unavailable');
    const encryptedDataKey = await encryptDataKeyForPublicShare(sessionDataKey, token);
    checkEncryptionScope();
    return { token, encryptedDataKey, checkCurrentness: checkEncryptionScope };
}

/**
 * Public links are an independently released publication boundary with their
 * own feature decision, so the gated Team/Group collaboration availability
 * must not withdraw them.
 */
function isSessionPublicLinkActionId(actionId: ActionId): boolean {
    return actionId === 'session.public_link.get'
        || actionId === 'session.public_link.create'
        || actionId === 'session.public_link.remove';
}

function isReleasedDirectSessionAccessActionId(actionId: ActionId): boolean {
    return actionId === 'session.access.grants.list'
        || actionId === 'session.access.grant.set'
        || actionId === 'session.access.grant.remove';
}

function isSessionAccessActionAvailable(
    availability: SessionCollaborationAvailability,
    actionId: ActionId,
): boolean {
    if (isSessionPublicLinkActionId(actionId)) return true;
    if (availability === 'full_collaboration') return true;
    return availability === 'direct_only' && isReleasedDirectSessionAccessActionId(actionId);
}

/** Descriptor-owned current transport; released direct sharing is selected only by availability. */
export async function executeSessionAccessHttpAction(params: SessionAccessRequestOptions & Readonly<{
    actionId: ActionId;
    input: unknown;
}>): Promise<unknown> {
    if (!isSessionAccessActionAvailable(params.availability, params.actionId)) {
        throw new SessionAccessApiError('unsupported_action');
    }
    const spec = getActionSpec(params.actionId);
    if (!spec.serverTransport || !spec.outputSchema) throw new SessionAccessApiError('unsupported_action');
    if (!isSessionAccessActionIdV1(params.actionId)) throw new SessionAccessApiError('unsupported_action');
    const publicInput = spec.inputSchema.parse(params.input);
    if (params.availability === 'direct_only'
        && (params.actionId === 'session.access.grant.set' || params.actionId === 'session.access.grant.remove')
        && (publicInput as { subject: PrincipalRefV1 }).subject.kind !== 'account') {
        // The released compatibility transport owns direct Account shares only.
        // Reject current Team/Group subjects before resolving credentials or
        // reading the Session so a gated capability cannot leak into that path.
        throw new SessionAccessApiError('unsupported_action');
    }
    const mutation = spec.sideEffectClass !== 'none' && spec.sideEffectClass !== 'read';
    // An already-aborted request proves this host never handed bytes to the
    // transport. After dispatch, cancellation can no longer prove that.
    if (params.signal?.aborted) throw new SessionAccessApiError('cancelled');
    // The typed family binder is the one place an Action input becomes a
    // request, so this leaf keeps no route table of its own.
    return await runWithServerAccountScopeRequestGuard({
        scope: params.scope,
        isCurrent: params.isCurrent,
        signal: params.signal,
        staleError: () => new SessionAccessApiError('session_access_stale_scope'),
    }, async ({ check, signal }) => {
        check();
        return await runWithServerRequestAuthorityForServerAccountScope({
            scope: params.scope,
            activeRequest: async () => { throw new SessionAccessApiError('session_access_stale_scope'); },
        }, async authority => {
            check();
            if (params.availability === 'direct_only' && params.actionId.startsWith('session.access.')) {
                const { executeLegacySessionAccessAction } = await import('./sessionAccessLegacyAdapter');
                const value = await executeLegacySessionAccessAction({ authority, actionId: params.actionId, input: publicInput, check, signal });
                check();
                return spec.outputSchema!.parse(value);
            }
            const publicBound = bindSessionAccessActionHttpRequestV1(params.actionId, publicInput);
            let physicalMutation: SessionGrantMutationV1 | null = null;
            let publicLinkMaterial: Readonly<{ token: string; encryptedDataKey?: string }> | null = null;
            let retainedEnvelopeFallback = false;
            let checkMaterializationCurrentness = check;
            if (params.actionId === 'session.public_link.create') {
                const { sessionId } = publicInput as { sessionId: string };
                const materialized = await materializePublicLinkCreateMaterial({ authority, check, sessionId });
                publicLinkMaterial = materialized.encryptedDataKey === undefined
                    ? { token: materialized.token }
                    : { token: materialized.token, encryptedDataKey: materialized.encryptedDataKey };
                checkMaterializationCurrentness = materialized.checkCurrentness;
                params.onPublicLinkBearerIssued?.(materialized.token);
            }
            if (params.actionId === 'session.access.grant.set') {
                const { sessionId, ...grant } = publicInput as Record<string, unknown> & { sessionId: string };
                const materialized = await materializeDirectAccountEnvelope({
                    authority,
                    check,
                    sessionId,
                    mutation: SessionGrantMutationV1Schema.parse(grant),
                });
                physicalMutation = materialized.mutation;
                retainedEnvelopeFallback = materialized.retainedEnvelopeFallback;
                checkMaterializationCurrentness = materialized.checkCurrentness;
            }
            // The public Action remains key-free and bearer-free. Only this
            // trusted execution host extends the already-bound physical request
            // with recipient ciphertext or publication material.
            const physicalExtras = physicalMutation?.accountEnvelopeInput
                ? { accountEnvelopeInput: physicalMutation.accountEnvelopeInput }
                : publicLinkMaterial;
            const bound = physicalExtras && publicBound.body && typeof publicBound.body === 'object'
                ? { ...publicBound, body: { ...publicBound.body, ...physicalExtras } }
                : publicBound;
            checkMaterializationCurrentness();
            const requestInit: RequestInit = {
                method: bound.method,
                ...(bound.body === undefined ? {} : {
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bound.body),
                }),
                signal,
            };
            let requestIssued = false;
            let response: Response;
            try {
                response = await authority.request(
                    bound.path,
                    requestInit,
                    { onIssued: () => { requestIssued = true; } },
                );
            } catch (error) {
                if (params.actionId === 'session.public_link.create'
                    && requestIssued
                    && !signal?.aborted) {
                    try {
                        // The server's public-link owner is value-idempotent.
                        // Replay this already-materialized request once so the
                        // token and wrapped key remain byte-identical; never
                        // regenerate either after an ambiguous response.
                        checkMaterializationCurrentness();
                        response = await authority.request(bound.path, requestInit);
                    } catch {
                        throw new SessionAccessApiError('outcome_unknown');
                    }
                } else if (mutation && requestIssued) {
                    throw new SessionAccessApiError('outcome_unknown');
                } else {
                    if (signal?.aborted) throw new SessionAccessApiError('cancelled');
                    throw error;
                }
            }
            check();
            const payload: unknown = await response.json().catch(() => null);
            check();
            if (!response.ok) {
                if (params.actionId === 'session.public_link.remove'
                    && response.status === 404
                    && (payload as Readonly<Record<string, unknown>> | null)?.error === 'Share not found') {
                    // The desired state already holds; publication removal is idempotent.
                    return spec.outputSchema!.parse({ changed: false });
                }
                const responseError = createSessionAccessApiErrorFromResponse(payload, response.status);
                throw new SessionAccessApiError(
                    retainedEnvelopeFallback && responseError.code === 'recipient_envelope_required'
                        ? 'session_data_key_unavailable'
                        : responseError.code,
                    response.status,
                );
            }
            try {
                if (params.actionId === 'session.public_link.remove') {
                    // The released owner acknowledges removal with `success`;
                    // anything else leaves the committed outcome unproven.
                    if ((payload as Readonly<Record<string, unknown>> | null)?.success !== true) {
                        throw new SessionAccessApiError('outcome_unknown');
                    }
                    return spec.outputSchema!.parse({ changed: true });
                }
                const value = params.actionId === 'session.public_link.get' || params.actionId === 'session.public_link.create'
                    ? projectSessionPublicLinkActionResultV1(payload) : payload;
                return spec.outputSchema!.parse(value);
            } catch (error) {
                if (!mutation) throw error;
                // A 2xx status proves the Home accepted the request, but an
                // unusable acknowledgement cannot prove what it committed.
                throw new SessionAccessApiError('outcome_unknown');
            }
        });
    });
}

/**
 * The mounted controller uses the normal Action executor with this exact
 * Account-bound family leaf, so every human Session-access and publication
 * intent honors Action availability and the user's confirmation setting and
 * reaches the Home through the one declared transport.
 */
export function createSessionAccessClient(options: SessionAccessRequestOptions & Readonly<{ sessionId: string }>) {
    async function execute(actionId: ActionId, input: unknown) {
        const { createDefaultActionExecutor } = await import('@/sync/ops/actions/defaultActionExecutor');
        let requestError: unknown;
        const executor = createDefaultActionExecutor({
            sessionAccessAction: async args => {
                try {
                    return await executeSessionAccessHttpAction({ ...options, actionId: args.actionId, input: args.input, signal: args.signal ?? options.signal });
                } catch (error) {
                    requestError = error;
                    throw error;
                }
            },
        });
        const result = await executor.execute(actionId, input, {
            surface: 'ui',
            // The mounted editor is the direct human interaction. Marking that
            // admission explicitly keeps the shared approval owner able to tell
            // it apart from a UI-carried agent or plugin request; it grants no
            // authority the Home would not already check.
            authority: 'present_user',
            serverId: options.scope.serverId,
            defaultSessionId: options.sessionId,
        });
        if (!result.ok) {
            if (requestError) throw requestError;
            throw new SessionAccessApiError(result.errorCode ?? 'session_access_request_failed');
        }
        return result.result;
    }
    return {
        /** The family's one dispatch entry for callers that own their own typed projection. */
        execute,
        list: async () => SessionAccessGrantsListResponseV1Schema.parse(await execute('session.access.grants.list', { sessionId: options.sessionId })),
        set: async (input: SessionGrantIntentV1) => SetSessionAccessGrantResponseV1Schema.parse(await execute('session.access.grant.set', { sessionId: options.sessionId, ...input })),
        remove: async (subject: PrincipalRefV1) => RemoveSessionAccessGrantResponseV1Schema.parse(await execute('session.access.grant.remove', { sessionId: options.sessionId, subject })),
        setContext: async (primaryTeamId: string | null) => SetSessionAccessContextResponseV1Schema.parse(await execute('session.access.context.set', { sessionId: options.sessionId, primaryTeamId })),
        getPublicLink: async () => SessionPublicLinkGetActionResultV1Schema.parse(
            await execute('session.public_link.get', { sessionId: options.sessionId }),
        ),
        createPublicLink: async (input: Readonly<{ expiresAt?: number; maxUses?: number; isConsentRequired: boolean }>) =>
            SessionPublicLinkSettingsV1Schema.parse(await execute('session.public_link.create', {
                sessionId: options.sessionId,
                ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
                ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
                isConsentRequired: input.isConsentRequired,
            })),
        removePublicLink: async () => SessionPublicLinkRemoveActionResultV1Schema.parse(
            await execute('session.public_link.remove', { sessionId: options.sessionId }),
        ),
    };
}
