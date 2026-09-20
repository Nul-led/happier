export type SessionLiveTranscriptReason =
    | 'visible'
    | 'explicitTranscriptConsumer'
    | 'voicePrimaryAction'
    | 'voiceTracked'
    | 'voiceReadback'
    | 'voiceBoundTarget'
    | 'scmSameSession';

/**
 * A mounted SCM consumer's Session address plus the project facts its scope matching needs.
 *
 * `serverId` is the exact Home the surface was opened for. Two Homes can host the same Session id
 * and the same machine/root tuple, so a scope that carries a Home only matches a subject that
 * carries the same one; an unqualified side still matches by id alone, exactly as
 * `isSessionSurfaceVisible` resolves an unscoped visible surface.
 *
 * The key is required even though the value may be `null`: every mounted producer resolves a Home
 * today, and the leniency below widens the match, so omitting the Home must be a stated decision a
 * reader can see rather than a silently missing field.
 */
export type SessionRealtimeScmScope = Readonly<{
    serverId: string | null;
    sessionId?: string | null;
    canonicalProjectKey?: string | null;
    machineScopeId?: string | null;
    repoRoot?: string | null;
    needsMutationTranscript?: boolean;
}>;

export type SessionNeedsLiveTranscriptInput = Readonly<{
    sessionId: string;
    /**
     * Exact Home of the subject Session. Required for the same reason as
     * `SessionRealtimeScmScope['serverId']`: a subject with no Home widens the SCM
     * match, so `null` has to be a stated answer rather than an omitted field.
     */
    serverId: string | null;
    isVisible?: boolean;
    explicitTranscriptConsumerSessionIds?: ReadonlyArray<string>;
    voicePrimaryActionSessionId?: string | null;
    voiceTrackedSessionIds?: ReadonlyArray<string>;
    voiceReadbackSessionIds?: ReadonlyArray<string>;
    voiceBoundTargetSessionIds?: ReadonlyArray<string>;
    scmMountedScopes?: ReadonlyArray<SessionRealtimeScmScope>;
}>;

export type SessionNeedsLiveTranscriptDecision = Readonly<{
    active: boolean;
    reasons: readonly SessionLiveTranscriptReason[];
}>;

function normalizeText(value: unknown): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
}

function includesSessionId(values: ReadonlyArray<string> | undefined, sessionId: string): boolean {
    return values?.some((value) => normalizeText(value) === sessionId) === true;
}

function pushReason(reasons: SessionLiveTranscriptReason[], reason: SessionLiveTranscriptReason): void {
    if (!reasons.includes(reason)) reasons.push(reason);
}

/** Same Home, or one side that never learned its Home. */
function isSameRealtimeScmHome(left: string | null | undefined, right: string | null | undefined): boolean {
    const normalizedLeft = normalizeText(left);
    const normalizedRight = normalizeText(right);
    if (!normalizedLeft || !normalizedRight) return true;
    return normalizedLeft === normalizedRight;
}

function isSameCanonicalProjectScope(
    sessionScope: SessionRealtimeScmScope | null | undefined,
    mountedScope: SessionRealtimeScmScope,
): boolean {
    const sessionProjectKey = normalizeText(sessionScope?.canonicalProjectKey);
    const mountedProjectKey = normalizeText(mountedScope.canonicalProjectKey);
    if (!sessionProjectKey || !mountedProjectKey || sessionProjectKey !== mountedProjectKey) return false;
    return isSameRealtimeScmHome(sessionScope?.serverId, mountedScope.serverId);
}

export function sessionNeedsLiveTranscript(input: SessionNeedsLiveTranscriptInput): SessionNeedsLiveTranscriptDecision {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) return { active: false, reasons: [] };

    const reasons: SessionLiveTranscriptReason[] = [];
    if (input.isVisible === true) pushReason(reasons, 'visible');
    if (includesSessionId(input.explicitTranscriptConsumerSessionIds, sessionId)) {
        pushReason(reasons, 'explicitTranscriptConsumer');
    }
    if (normalizeText(input.voicePrimaryActionSessionId) === sessionId) {
        pushReason(reasons, 'voicePrimaryAction');
    }
    if (includesSessionId(input.voiceTrackedSessionIds, sessionId)) {
        pushReason(reasons, 'voiceTracked');
    }
    if (includesSessionId(input.voiceReadbackSessionIds, sessionId)) {
        pushReason(reasons, 'voiceReadback');
    }
    if (includesSessionId(input.voiceBoundTargetSessionIds, sessionId)) {
        pushReason(reasons, 'voiceBoundTarget');
    }

    // Hidden sessions in the same canonical project scope intentionally do NOT become full
    // transcript consumers: their SCM mutation signal is delivered from the durable projection
    // path (see sessionScmMutationSignalWanted) so their transcripts stay projection-only.
    for (const scope of input.scmMountedScopes ?? []) {
        if (scope.needsMutationTranscript !== true) continue;
        if (normalizeText(scope.sessionId) !== sessionId) continue;
        if (!isSameRealtimeScmHome(scope.serverId, input.serverId)) continue;
        pushReason(reasons, 'scmSameSession');
    }

    return { active: reasons.length > 0, reasons };
}

export function isSessionFullContentConsumerActive(input: SessionNeedsLiveTranscriptInput): boolean {
    return sessionNeedsLiveTranscript(input).active;
}

export type SessionScmMutationSignalInput = Readonly<{
    sessionId: string;
    /** Exact Home of the subject Session; `null` is a stated answer, never an omission. */
    serverId: string | null;
    sessionScmScope?: SessionRealtimeScmScope | null;
    scmMountedScopes?: ReadonlyArray<SessionRealtimeScmScope>;
}>;

/**
 * Whether a mounted SCM consumer wants workspace-mutation signals from this session.
 *
 * This intentionally covers hidden sessions in the same canonical project scope: instead of
 * hydrating their full live transcript (decrypt + reducer + store apply per streaming tick),
 * the realtime socket path feeds their skipped durable messages to the workspace-mutation
 * ingestion side channel when this predicate matches.
 */
export function sessionScmMutationSignalWanted(input: SessionScmMutationSignalInput): boolean {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) return false;

    for (const scope of input.scmMountedScopes ?? []) {
        if (scope.needsMutationTranscript !== true) continue;
        if (normalizeText(scope.sessionId) === sessionId
            && isSameRealtimeScmHome(scope.serverId, input.serverId)) return true;
        if (isSameCanonicalProjectScope(input.sessionScmScope, scope)) return true;
    }
    return false;
}
