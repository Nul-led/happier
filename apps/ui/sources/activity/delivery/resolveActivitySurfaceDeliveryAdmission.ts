import type { SessionActivityAttention } from '@/activity/attention/activityAttentionTypes';
import type { ActivitySurfacePrivacyMode } from '@/activity/attention/resolveActivitySurfacePolicy';
import { normalizeSessionAddress, sessionAddressKey } from '@/sync/domains/session/sessionAddress';

import type {
    ActivityAttentionDeliveryEventKind,
    ActivityAttentionSurface,
} from './activityAttentionDeliveryPlanTypes';
import { resolveActivityAttentionDeliveryPlan } from './resolveActivityAttentionDeliveryPlan';
import type { ExactHomeAccountSettingsResolver } from './useExactHomeAccountSettings';

type LocalSettingsLike = Readonly<Record<string, unknown>>;

/**
 * The exact Home a candidate belongs to. Activity candidates are Home-qualified
 * by the attention source; an unqualified candidate has no Account whose policy
 * could admit it.
 */
function resolveCandidateServerId(candidate: SessionActivityAttention): string | null {
    return normalizeSessionAddress(
        candidate.address?.serverId ?? candidate.serverId ?? candidate.session.serverId,
        candidate.sessionId,
    )?.serverId ?? null;
}

/** Opaque exact-address key; two Homes may legitimately carry the same Session ID. */
function candidateDeliveryKey(candidate: SessionActivityAttention): string {
    return sessionAddressKey({
        serverId: resolveCandidateServerId(candidate) ?? '',
        sessionId: candidate.sessionId,
    });
}

/**
 * The canonical attention event a candidate currently represents, read from the
 * attention owner's committed reasons rather than re-derived from session state.
 */
export function resolveActivityCandidateEventKind(
    candidate: SessionActivityAttention,
): ActivityAttentionDeliveryEventKind {
    if (candidate.reasons.hasPendingPermissionRequests) return 'permission_request';
    if (candidate.reasons.hasPendingUserActionRequests || candidate.reasons.hasBlockedPendingDelivery) {
        return 'user_action_request';
    }
    return 'ready';
}

export type ActivitySurfaceDeliveryAdmission = Readonly<{
    /** Candidates whose own Home admits this surface, in the input order. */
    candidates: readonly SessionActivityAttention[];
    /** Exact-Home privacy projection for an admitted candidate, otherwise `null`. */
    privacyModeFor: (candidate: SessionActivityAttention) => ActivitySurfacePrivacyMode | null;
    /** Stable identity of the admission result, so bridges resync on a policy mutation. */
    fingerprint: string;
}>;

/**
 * Evaluate every exact `serverId` + `sessionId` candidate through the canonical
 * Activity delivery-plan owner using that candidate's own Account policy.
 *
 * A Home with no resolvable scope or no persisted Account settings fails closed:
 * it neither renders nor registers, and never inherits the active Home's policy.
 */
export function resolveActivitySurfaceDeliveryAdmission(params: Readonly<{
    candidates: readonly SessionActivityAttention[];
    surface: ActivityAttentionSurface;
    resolveAccountSettings: ExactHomeAccountSettingsResolver;
    localSettings: LocalSettingsLike;
    now: Date;
}>): ActivitySurfaceDeliveryAdmission {
    const privacyModeByKey = new Map<string, ActivitySurfacePrivacyMode>();
    const admitted: SessionActivityAttention[] = [];
    const fingerprintEntries: string[] = [];

    for (const candidate of params.candidates) {
        const key = candidateDeliveryKey(candidate);
        const accountSettings = params.resolveAccountSettings(resolveCandidateServerId(candidate));
        const plan = accountSettings
            ? resolveActivityAttentionDeliveryPlan({
                accountSettings,
                localSettings: params.localSettings,
                event: resolveActivityCandidateEventKind(candidate),
                channel: params.surface,
                surface: params.surface,
                now: params.now,
            })
            : null;
        if (!plan || plan.delivery === 'suppress') {
            fingerprintEntries.push(JSON.stringify([key, false]));
            continue;
        }

        const privacyMode = plan.previewBehavior;
        privacyModeByKey.set(key, privacyMode);
        admitted.push(candidate);
        fingerprintEntries.push(JSON.stringify([key, true, privacyMode]));
    }

    return {
        candidates: admitted,
        privacyModeFor: (candidate) => privacyModeByKey.get(candidateDeliveryKey(candidate)) ?? null,
        fingerprint: JSON.stringify(fingerprintEntries.sort()),
    };
}
