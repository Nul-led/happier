import * as React from 'react';

import type {
    SessionAccessAccountSummaryV1,
    SessionResponsibilityCandidateV1,
} from '@happier-dev/protocol';
import {
    SessionResponsibilityError,
    listSessionResponsibilityCandidates,
    readSessionResponsibleAccount,
    setSessionResponsibleAccount,
    type SessionResponsibilityMutationFailure,
} from '@/sync/api/session/apiSessionResponsibility';
import { storage, useSessionListRenderableWithServerScope } from '@/sync/domains/state/storage';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { useSessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';

export type SessionResponsibilityAvailability =
    /** No cached scoped Session exists yet; preserve the section's row geometry. */
    | 'loading'
    /** This server did not project responsibility; never render "No one". */
    | 'unsupported'
    /** Projected and readable, but this Account may not change it. */
    | 'read_only'
    | 'editable';

export type SessionResponsibilityCandidatesState = Readonly<{
    loading: boolean;
    failed: boolean;
    candidates: readonly SessionResponsibilityCandidateV1[];
    nextCursor: string | null;
}>;

export type SessionResponsibilityController = Readonly<{
    availability: SessionResponsibilityAvailability;
    /** `undefined` only while unsupported; `null` is an authoritative "nobody". */
    responsibleAccountId: string | null | undefined;
    /** Safe current summary from the Session projection/Action response, retained while stale. */
    responsibleAccount: SessionAccessAccountSummaryV1 | null;
    pending: boolean;
    failure: SessionResponsibilityMutationFailure | null;
    /** One in-context explanation for this Account's committed assignment-triggered Follow. */
    assignmentAutoFollowed: boolean;
    candidates: SessionResponsibilityCandidatesState;
    loadCandidates: (input?: Readonly<{ query?: string; cursor?: string }>) => Promise<void>;
    setResponsibleAccount: (accountId: string | null) => Promise<boolean>;
    /** Fixed canonical-self option; derived from the authenticated Account, never page one. */
    canAssignToSelf: boolean;
}>;

const EMPTY_CANDIDATES: SessionResponsibilityCandidatesState = {
    loading: false,
    failed: false,
    candidates: [],
    nextCursor: null,
};

/**
 * The one scoped owner of the responsibility fact for a mounted Session surface.
 *
 * Candidate search and `session.responsibility.set` share its exact
 * Home/credential/currentness state: one `scope`, one target key, one
 * revision guard. There is one controller per mounted qualified Session;
 * the section creates it and hands it to the picker, so there is no duplicate
 * request/mutation controller and no direct HTTP UI caller. The shared UI
 * Action executor is the only mutation entry, so the real UI honors Action
 * availability and the user's shared confirmation setting.
 *
 * The current assignee's display identity comes from the canonical Session
 * projection (`responsibleAccount`) and the authoritative Action response,
 * retained as last-good during refresh/offline. It is never a side effect of
 * loading the editable candidate list: candidate failure, an unrequested later
 * page or search filtering cannot erase the displayed current assignee, and no
 * responsibility-specific profile request is issued. Never renders the raw id.
 */
export function useSessionResponsibilityController(
    sessionId: string,
    scope: ServerAccountScope,
): SessionResponsibilityController {
    const session = useSessionListRenderableWithServerScope(scope.serverId, sessionId);
    const collaborationAvailability = useSessionCollaborationAvailability(scope.serverId);
    const targetKey = JSON.stringify([scope.serverId, scope.accountId, sessionId]);
    const currentTarget = React.useRef(targetKey);
    currentTarget.current = targetKey;
    // The exact target is only live while this controller is mounted. Without
    // this, a surface that navigated away or unmounted left `currentTarget`
    // equal to its last address, so a retained picker could still commit a
    // mutation against the Session the user had already left.
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const responsibleAccountId = session?.responsibleAccountId;
    const projectedSummary = (session as { responsibleAccount?: SessionAccessAccountSummaryV1 | null } | null | undefined)?.responsibleAccount ?? null;
    const [pending, setPending] = React.useState(false);
    const [failure, setFailure] = React.useState<SessionResponsibilityMutationFailure | null>(null);
    const [assignmentAutoFollowed, setAssignmentAutoFollowed] = React.useState(false);
    const [candidates, setCandidates] = React.useState<SessionResponsibilityCandidatesState>(EMPTY_CANDIDATES);
    // Last-good safe projection survives refresh/offline/candidate failure.
    const [lastGoodSummary, setLastGoodSummary] = React.useState<SessionAccessAccountSummaryV1 | null>(null);
    const requestRevision = React.useRef(0);
    const mutationInFlight = React.useRef(false);
    const mutationRevision = React.useRef(0);

    React.useEffect(() => {
        requestRevision.current += 1;
        setCandidates(EMPTY_CANDIDATES);
        setFailure(null);
        setAssignmentAutoFollowed(false);
        setPending(false);
        mutationRevision.current += 1;
        mutationInFlight.current = false;
        setLastGoodSummary(null);
    }, [targetKey]);

    // Prefer the canonical projection; retain last-good while stale/unavailable.
    React.useEffect(() => {
        if (responsibleAccountId === undefined) return;
        if (responsibleAccountId === null) {
            setLastGoodSummary(null);
            return;
        }
        if (projectedSummary && projectedSummary.accountId === responsibleAccountId) {
            setLastGoodSummary(projectedSummary);
        }
    }, [responsibleAccountId, projectedSummary]);

    React.useEffect(() => {
        if (responsibleAccountId !== scope.accountId) {
            setAssignmentAutoFollowed(false);
        }
    }, [responsibleAccountId, scope.accountId]);

    const availability: SessionResponsibilityAvailability = session == null
        ? 'loading'
        : responsibleAccountId === undefined || collaborationAvailability !== 'full_collaboration'
            ? 'unsupported'
        : session?.access?.capabilities.assignResponsibility === true
            ? 'editable'
            : 'read_only';

    // Capability/access loss clears private candidate data; the surface closes
    // or becomes read-only with a localized "Access changed" result.
    React.useEffect(() => {
        if (availability === 'editable') return;
        requestRevision.current += 1;
        setCandidates(EMPTY_CANDIDATES);
    }, [availability]);

    const isCurrent = React.useCallback(
        () => mounted.current && currentTarget.current === targetKey,
        [targetKey],
    );

    const loadCandidates = React.useCallback(async (input?: Readonly<{ query?: string; cursor?: string }>) => {
        if (availability !== 'editable') return;
        const revision = ++requestRevision.current;
        setCandidates((current) => ({
            ...current,
            // Previous results stay visible while a search refreshes rather than
            // flashing an empty list or a skeleton wall.
            loading: true,
            failed: false,
        }));
        try {
            const page = await listSessionResponsibilityCandidates(scope, {
                sessionId,
                ...(input?.query ? { query: input.query } : {}),
                ...(input?.cursor ? { cursor: input.cursor } : {}),
            }, {
                availability: collaborationAvailability,
                isCurrent,
            });
            if (requestRevision.current !== revision || !isCurrent()) return;
            setCandidates((current) => ({
                loading: false,
                failed: false,
                candidates: input?.cursor ? [...current.candidates, ...page.candidates] : page.candidates,
                nextCursor: page.nextCursor,
            }));
            setFailure((current) => current === 'session_access_authentication_required'
                || current === 'session_access_authentication_unavailable'
                ? null
                : current);
        } catch (error) {
            if (requestRevision.current !== revision || !isCurrent()) return;
            const authenticationFailed = error instanceof SessionResponsibilityError
                && (error.failure === 'session_access_authentication_required'
                    || error.failure === 'session_access_authentication_unavailable');
            setCandidates((current) => authenticationFailed
                ? { ...EMPTY_CANDIDATES, failed: true }
                : {
                    ...current,
                    loading: false,
                    failed: true,
                    // A failed initial/search request must retry from the start
                    // even while last-good rows remain visible. Only a failed
                    // continuation retains its opaque cursor for exact retry.
                    nextCursor: input?.cursor ?? null,
                });
            if (authenticationFailed) {
                setFailure(error.failure);
            }
        }
    }, [scope.serverId, scope.accountId, sessionId, availability, collaborationAvailability, isCurrent, targetKey]);

    const setResponsibleAccount = React.useCallback(async (accountId: string | null): Promise<boolean> => {
        if (availability !== 'editable' || mutationInFlight.current || !isCurrent()) return false;
        mutationInFlight.current = true;
        const mutation = ++mutationRevision.current;
        const isMutationCurrent = () => mutationRevision.current === mutation && isCurrent();
        setPending(true);
        setFailure(null);
        setAssignmentAutoFollowed(false);
        try {
            const result = await setSessionResponsibleAccount(scope, {
                sessionId,
                responsibleAccountId: accountId,
            }, {
                availability: collaborationAvailability,
                isCurrent: isMutationCurrent,
            });
            if (!isMutationCurrent()) return false;
            // Consume the authoritative id/summary plus this exact transition's
            // transient auto-Follow result. `changed=false` is an acknowledged
            // no-op with no write/wake/baseline/handoff; `changed=true` hands
            // the committed previous/new transition once to Lane 09 server-side.
            // The auto-Follow result drives one in-context explanation only and
            // is never persisted as assignment origin or inferred client-side.
            if (result.responsibleAccount !== undefined) {
                setLastGoodSummary(result.responsibleAccount);
            } else if (result.responsibleAccountId === null) {
                setLastGoodSummary(null);
            }
            storage.getState().applySessionResponsibleAccount(
                sessionId,
                result.responsibleAccountId,
                scope,
                result.responsibleAccount ?? null,
            );
            setAssignmentAutoFollowed(
                result.autoFollowed === true && result.responsibleAccountId === scope.accountId,
            );
            return true;
        } catch (error) {
            if (!isMutationCurrent()) return false;
            const failureKind = error instanceof SessionResponsibilityError ? error.failure : 'unknown';
            setFailure(failureKind);
            if (failureKind === 'session_access_authentication_required'
                || failureKind === 'session_access_authentication_unavailable') {
                // Team authentication loss revokes the basis on which private
                // candidate identities were disclosed. Invalidate any in-flight
                // page and clear the last accepted page immediately.
                requestRevision.current += 1;
                setCandidates(EMPTY_CANDIDATES);
            }
            if (failureKind === 'assignee-unavailable' || failureKind === 'forbidden') {
                // The chosen person's access changed between the picker and the
                // commit, or our own capability was revoked: refresh candidates
                // and Session rather than guessing.
                void loadCandidates();
            }
            if (failureKind === 'unknown') {
                try {
                    const reconciled = await readSessionResponsibleAccount(scope, sessionId, { isCurrent: isMutationCurrent });
                    if (isMutationCurrent()) {
                        setLastGoodSummary(reconciled.responsibleAccount);
                        storage.getState().applySessionResponsibleAccount(
                            sessionId,
                            reconciled.responsibleAccountId,
                            scope,
                            reconciled.responsibleAccount,
                        );
                    }
                } catch {
                    // Preserve the last accepted projection and the original
                    // unknown outcome. A later reconnect/change refresh can
                    // reconcile it; never replay a mutation from this branch.
                }
            }
            return false;
        } finally {
            if (mutationRevision.current === mutation) {
                mutationInFlight.current = false;
                if (isCurrent()) setPending(false);
            }
        }
    }, [loadCandidates, sessionId, scope.serverId, scope.accountId, availability, collaborationAvailability, isCurrent, targetKey]);

    // "Assign to me" is a fixed canonical-self option derived from the
    // authenticated Home Account plus current Session-read eligibility. It never
    // waits for, searches, or assumes membership in candidate page one. The
    // server repeats the target check in the mutation transaction.
    // The actor views this Session, so they read it; active status is the
    // authenticated Account itself. Hide only when already assigned to self or
    // not editable.
    const canAssignToSelf = availability === 'editable' && responsibleAccountId !== undefined;

    const responsibleAccount = responsibleAccountId === undefined || responsibleAccountId === null
        ? null
        : lastGoodSummary && lastGoodSummary.accountId === responsibleAccountId
            ? lastGoodSummary
            : projectedSummary && projectedSummary.accountId === responsibleAccountId
                ? projectedSummary
                : null;

    return {
        availability,
        responsibleAccountId,
        responsibleAccount: responsibleAccount ?? null,
        pending,
        failure,
        assignmentAutoFollowed,
        candidates,
        loadCandidates,
        setResponsibleAccount,
        canAssignToSelf,
    };
}
