import {
    RemoveSessionAccessGrantRequestV1Schema,
    SessionAccessGrantSetActionInputV1Schema,
    SessionAccessGrantsListRequestV1Schema,
    type ActionId,
    type SessionAccessAccountSummaryV1,
    type SessionAccessGrantV1,
    type ReleasedDirectSessionShareProfileV1,
    type ReleasedDirectSessionShareV1,
    gainsSessionAccessDelegationCapabilityV1,
    projectSessionAccessGrantTransitionsV1,
} from '@happier-dev/protocol';
import { getSessionShares, createSessionShare, updateSessionShare, deleteSessionShare } from '@/sync/api/social/apiSharing';
import { createSessionSocialRequest, getSessionFriendsList } from '@/sync/api/social/createSessionSocialRequest';
import { searchUsersPageByUsername } from '@/sync/api/social/apiFriends';
import {
    readSessionSnapshotForAuthority,
    SessionSnapshotReadError,
} from '@/sync/runtime/orchestration/serverScopedRpc/readSessionSnapshotForAuthority';
import { runWithServerRequestAuthorityForServerAccountScope, type ServerAccountRequestAuthority } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { prepareLegacySessionShareRequest } from '@/sync/encryption/prepareLegacySessionShareRequest';
import { assertSessionSharingMutationAuthority } from '@/sync/domains/social/sessionSharingMutationAuthority';
import { SessionAccessApiError, type SessionAccessRequestOptions } from './sessionAccessApi';
import { captureEncryptionGenerationCurrentness } from '@/sync/encryption/encryption';

function principal(profile: ReleasedDirectSessionShareProfileV1): SessionAccessAccountSummaryV1 {
    return { kind: 'account', accountId: profile.id, username: profile.username, firstName: profile.firstName, lastName: profile.lastName, avatarUrl: profile.avatar };
}
function grant(share: ReleasedDirectSessionShareV1): SessionAccessGrantV1 {
    return { subject: { kind: 'account', accountId: share.sharedWithUser.id }, accessLevel: share.accessLevel, canApprovePermissions: share.canApprovePermissions };
}

/** Current UI -> released owner/direct-only sharing. Never synthesizes Team memberships or grants. */
export async function executeLegacySessionAccessAction(params: Readonly<{
    authority: ServerAccountRequestAuthority;
    actionId: ActionId;
    input: unknown;
    check: () => void;
    signal: AbortSignal;
}>): Promise<unknown> {
    const input = params.input as Record<string, unknown>;
    const { sessionId } = SessionAccessGrantsListRequestV1Schema.parse({ sessionId: input.sessionId });
    const credentials = params.authority.context.credentials;
    if (!credentials) throw new SessionAccessApiError('session_access_stale_scope');
    const encryptionCurrentness = captureEncryptionGenerationCurrentness(
        params.authority.context.encryption,
        { serverId: params.authority.scope.serverId },
    );
    const isCurrent = () => {
        params.check();
        if (!encryptionCurrentness.isCurrent()) {
            throw new SessionAccessApiError('session_access_stale_scope');
        }
        return true;
    };
    const options = { scope: params.authority.scope, signal: params.signal, isCurrent };
    const snapshot = await readSessionSnapshotForAuthority({ authority: params.authority, sessionId, isCurrent }).catch((error: unknown) => {
        if (error instanceof SessionSnapshotReadError && error.errorCode === 'stale_response') {
            throw new SessionAccessApiError('session_access_stale_scope');
        }
        throw error;
    });
    isCurrent();
    const access = snapshot.session.access;
    if (!access) throw new SessionAccessApiError('session_access_forbidden', 403);
    const ownerId = access.role === 'owner' ? params.authority.scope.accountId : snapshot.session.owner;
    if (!ownerId) throw new SessionAccessApiError('session_access_request_failed');
    const owner = principal(snapshot.session.ownerProfile ?? { id: ownerId, username: null, firstName: null, lastName: null, avatar: null });
    if (params.actionId === 'session.access.grants.list') {
        const effectiveAccess = { v: 1, level: access.level, capabilities: access.capabilities,
            sources: access.role === 'owner' ? [{ kind: 'owner' }] : [] };
        if (!access.capabilities.manageAccess) return { visibility: 'self', owner, effectiveAccess, primaryTeamId: null, grants: [] };
        const shares = await getSessionShares(credentials, sessionId, options);
        isCurrent();
        return { visibility: 'complete', owner, effectiveAccess, primaryTeamId: null,
            grants: shares.map(share => ({
                grant: grant(share),
                principal: principal(share.sharedWithUser),
                // A released owner/direct-only Home has no Team policy or required
                // floor; the transition rule itself is the one Protocol owner the
                // current server inspection also composes.
                allowedTransitions: projectSessionAccessGrantTransitionsV1({
                    current: { accessLevel: share.accessLevel, canApprovePermissions: share.canApprovePermissions },
                    canDelegate: access.capabilities.managePermissionDelegation,
                    requiredByTeamPolicy: false,
                }),
            })) };
    }
    assertSessionSharingMutationAuthority(snapshot.session, 'manageAccess');
    const shares = await getSessionShares(credentials, sessionId, options);
    isCurrent();
    if (params.actionId === 'session.access.grant.remove') {
        const parsed = RemoveSessionAccessGrantRequestV1Schema.parse(params.input);
        if (parsed.subject.kind !== 'account') throw new SessionAccessApiError('unsupported_action');
        const accountId = parsed.subject.accountId;
        const existing = shares.find(share => share.sharedWithUser.id === accountId);
        if (!existing) return { changed: false, subject: parsed.subject };
        await deleteSessionShare(credentials, sessionId, existing.id, options);
        isCurrent();
        return { changed: true, subject: parsed.subject };
    }
    if (params.actionId !== 'session.access.grant.set') throw new SessionAccessApiError('unsupported_action');
    const parsed = SessionAccessGrantSetActionInputV1Schema.parse(params.input);
    if (parsed.subject.kind !== 'account') throw new SessionAccessApiError('unsupported_action');
    const accountId = parsed.subject.accountId;
    const existing = shares.find(share => share.sharedWithUser.id === accountId);
    if (gainsSessionAccessDelegationCapabilityV1(existing ?? null, parsed) && !access.capabilities.managePermissionDelegation) {
        throw new SessionAccessApiError('session_access_permission_delegation_forbidden', 403);
    }
    const sessionEncryptionMode = snapshot.session.encryptionMode === 'plain' ? 'plain' : 'e2ee';
    if (existing && sessionEncryptionMode === 'plain') {
        const changed = existing.accessLevel !== parsed.accessLevel || existing.canApprovePermissions !== parsed.canApprovePermissions;
        if (!changed) return { changed: false, grant: grant(existing) };
        const saved = await updateSessionShare(credentials, sessionId, existing.id, { accessLevel: parsed.accessLevel, canApprovePermissions: parsed.canApprovePermissions }, options);
        isCurrent();
        return { changed: true, grant: grant(saved) };
    }
    const friends = await getSessionFriendsList(credentials, sessionId, options);
    isCurrent();
    const recipient = friends.find(friend => friend.id === accountId);
    if (!recipient) {
        // The released PATCH route can still update an established share after
        // the friendship edge disappears, while its POST upsert cannot. Keep
        // that released behavior even though key repair is no longer possible.
        if (!existing) throw new SessionAccessApiError('session_access_subject_ineligible', 400);
        const changed = existing.accessLevel !== parsed.accessLevel || existing.canApprovePermissions !== parsed.canApprovePermissions;
        if (!changed) return { changed: false, grant: grant(existing) };
        const saved = await updateSessionShare(credentials, sessionId, existing.id, { accessLevel: parsed.accessLevel, canApprovePermissions: parsed.canApprovePermissions }, options);
        isCurrent();
        return { changed: true, grant: grant(saved) };
    }
    const request = await prepareLegacySessionShareRequest({
        sessionEncryptionMode,
        callerDataKeyEnvelope: snapshot.callerDataKeyEnvelope,
        encryption: params.authority.context.encryption,
        recipient: { ...recipient, contentPublicKey: recipient.contentPublicKey ?? null, contentPublicKeySig: recipient.contentPublicKeySig ?? null },
        accessLevel: parsed.accessLevel,
        canApprovePermissions: parsed.canApprovePermissions,
    });
    isCurrent();
    const saved = await createSessionShare(credentials, sessionId, request, options);
    isCurrent();
    return { changed: true, grant: grant(saved) };
}

/**
 * Home-scoped Account discovery for the access editor.
 *
 * `sessionId` is carried for the released Session-scoped fallback transport
 * only; with an exact `scope` the collaboration-directory request is already Home-bound, so the
 * New Session draft — which has no Session yet — uses the same owner.
 */
export async function searchSessionAccessAccountPage(options: SessionAccessRequestOptions & Readonly<{
    sessionId?: string;
    query: string;
    cursor?: string | null;
}>) {
    const sessionId = options.sessionId ?? '';
    return await runWithServerRequestAuthorityForServerAccountScope({ scope: options.scope,
        activeRequest: async () => { throw new SessionAccessApiError('session_access_stale_scope'); },
    }, async authority => {
        const credentials = authority.context.credentials;
        if (!credentials || options.signal?.aborted || options.isCurrent?.() === false) throw new SessionAccessApiError('session_access_stale_scope');
        const page = options.availability === 'direct_only'
            ? { users: await getSessionFriendsList(credentials, sessionId, options), nextCursor: null }
            : await searchUsersPageByUsername(credentials, options.query, {
                request: createSessionSocialRequest(credentials, sessionId, options),
                retry: 'none',
                purpose: 'collaboration',
                ...(options.cursor ? { cursor: options.cursor } : {}),
            });
        if (options.signal?.aborted || options.isCurrent?.() === false) throw new SessionAccessApiError('session_access_stale_scope');
        const query = options.query.trim().toLocaleLowerCase();
        return {
            rows: page.users
                .filter(profile => options.availability !== 'direct_only' || [profile.username, profile.firstName, profile.lastName]
                    .some(value => value?.toLocaleLowerCase().includes(query)))
                .map(profile => principal({ ...profile, avatar: profile.avatar?.url ?? null })),
            nextCursor: page.nextCursor,
        };
    });
}

/** Released bounded-array compatibility for the few callers that do not own a
 * pagination surface. New Access UI consumes `searchSessionAccessAccountPage`. */
export async function searchSessionAccessAccounts(
    options: SessionAccessRequestOptions & Readonly<{ sessionId?: string; query: string }>,
) {
    return (await searchSessionAccessAccountPage(options)).rows;
}
