import { afterTx, type Tx } from "@/storage/inTx";
import { notifySessionHumanPresenceAccessChanged } from "@/app/session/humanPresence/sessionHumanPresenceService";
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import { tombstoneSessionDraftForLifecycleInTx } from "@/app/account/sessionDrafts/sessionDraftService";
import { removeAccountSessionFollowsOnAccessLossInTx } from "@/app/session/follow/accountFollowService";
import { removeUnsafeSessionFollowEdgesForAccessChangeInTx } from "@/app/session/follow/sessionFollowEdgeService";
import { projectSessionEffectiveAccessV1, type EffectiveSessionAccess } from "./sessionAccess";
import { clearSessionResponsibilityIfNoReadAccessInTx } from "./sessionResponsibilityService";

export interface SessionAccessTransitionEffects {
    readonly changedAccountIds: readonly string[];
    readonly grantedAccountIds: readonly string[];
    readonly revokedAccountIds: readonly string[];
    readonly accountCursors: ReadonlyMap<string, number>;
}

function readTranscript(access: EffectiveSessionAccess | null): boolean {
    return access?.capabilities.readTranscript === true;
}

function accessFingerprint(access: EffectiveSessionAccess | null): string {
    if (!access) return "none";
    const capabilities = Object.entries(access.capabilities)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([capability, allowed]) => `${capability}=${allowed ? 1 : 0}`)
        .join(",");
    return `${access.level}|${capabilities}`;
}

/** Shared effective-access lifecycle effects for grant and native membership mutations. */
export async function applySessionAccessTransitionEffectsInTx(
    tx: Tx,
    params: Readonly<{
        sessionId: string;
        before: ReadonlyMap<string, EffectiveSessionAccess | null>;
        after: ReadonlyMap<string, EffectiveSessionAccess | null>;
        /** A changed direct projection needs refresh even when stronger access survives. */
        directGrantChangedAccountId?: string;
    }>,
): Promise<SessionAccessTransitionEffects> {
    const changedAccountIds: string[] = [];
    const grantedAccountIds: string[] = [];
    const revokedAccountIds: string[] = [];
    const accountCursors = new Map<string, number>();
    let anyEffectiveAccessChanged = false;

    for (const [accountId, beforeAccess] of params.before) {
        const afterAccess = params.after.get(accountId) ?? null;
        const effectiveAccessChanged =
            accessFingerprint(beforeAccess) !== accessFingerprint(afterAccess);
        // A weaker Group grant may disappear while stronger Direct authority
        // survives. Refresh the ordinary projection so its old context cannot
        // outlive that membership; presence still reacts only to capabilities.
        const projectionChanged = JSON.stringify(beforeAccess ? projectSessionEffectiveAccessV1(beforeAccess) : null)
            !== JSON.stringify(afterAccess ? projectSessionEffectiveAccessV1(afterAccess) : null);
        if (!projectionChanged && accountId !== params.directGrantChangedAccountId) continue;
        if (effectiveAccessChanged) anyEffectiveAccessChanged = true;

        changedAccountIds.push(accountId);
        if (!readTranscript(beforeAccess) && readTranscript(afterAccess)) {
            grantedAccountIds.push(accountId);
        }
        if (readTranscript(beforeAccess) && !readTranscript(afterAccess)) {
            revokedAccountIds.push(accountId);
            // Only a final loss of read access retires the collaborator's own draft.
            // An Edit-to-View downgrade keeps it: the Session is still readable and
            // the draft is that person's data.
            await tombstoneSessionDraftForLifecycleInTx(tx, { accountId, sessionId: params.sessionId });
        }
        const cursor = await markAccountChanged(tx, {
            accountId,
            kind: "session",
            entityId: params.sessionId,
        });
        accountCursors.set(accountId, cursor);
    }

    if (revokedAccountIds.length > 0) {
        await removeAccountSessionFollowsOnAccessLossInTx(tx, {
            sessionId: params.sessionId,
            accountIds: revokedAccountIds,
        });
    }

    // A changed Session may be either side of a Follow edge. Re-evaluate the
    // complete pair after the mutation: source-access loss by any destination
    // audience member and destination-audience broadening are both unsafe,
    // while an atomic audience contraction that leaves the final pair safe is
    // retained. The Follow service delegates this to Lane 04's one pair owner.
    if (anyEffectiveAccessChanged) {
        await removeUnsafeSessionFollowEdgesForAccessChangeInTx(tx, {
            sessionId: params.sessionId,
        });
    }

    // Responsibility is a workflow fact layered on current access, so this one
    // transaction also maintains its invariant. The helper re-evaluates every
    // remaining source itself: losing one overlapping grant keeps the assignment,
    // and only a final loss of read access clears it.
    if (revokedAccountIds.length > 0) {
        await clearSessionResponsibilityIfNoReadAccessInTx({ tx, sessionId: params.sessionId });
    }
    if (anyEffectiveAccessChanged) {
        // Presence rechecks the whole room itself, so only the Session identity is
        // meaningful at this seam.
        afterTx(tx, () => notifySessionHumanPresenceAccessChanged({ sessionId: params.sessionId }));
    }

    return { changedAccountIds, grantedAccountIds, revokedAccountIds, accountCursors };
}
