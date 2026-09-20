import { isPublicSessionShareActive } from "@/app/share/publicSessionSharePublication";
import type { Tx } from "@/storage/inTx";
import {
    listCurrentSessionAudienceAccountsInTx,
    resolveEffectiveSessionAccess,
    resolveStructuralSessionAccess,
    resolveStructuralSessionAccessForAccountsInTx,
} from "./sessionAccess";
import type { SessionAccessAuthentication } from "./sessionAccessAuthentication";
import type { VerifiedEphemeralSessionRunnerPrincipal } from "@happier-dev/protocol/ephemeralRunner/principal";
import { readRunnerActivationAuthenticationInTx } from "@/app/ephemeralRunner/activationAuthentication";

export type SessionContextInjectionDecision =
    | Readonly<{ ok: true; destinationRuntimeAccountId: string }>
    | Readonly<{
        ok: false;
        reason:
            | "unavailable"
            | "same_session"
            | "configurer_not_allowed"
            | "destination_runtime_not_allowed"
            | "destination_audience_broader"
            | "destination_public";
    }>;

type DestinationSession = Readonly<{
    id: string;
    accountId: string;
    publicShare: Readonly<{ expiresAt: Date | null }> | null;
}>;

// Bound each census/batch allocation without imposing a total audience limit.
const AUDIENCE_PAGE_SIZE = 100;

/** Pairwise policy over transaction-loaded custody, separate from the author. */
async function evaluateSessionContextPairInTx(
    tx: Tx,
    sourceSessionId: string,
    destination: DestinationSession,
    admission:
        | Readonly<{ kind: "content_free_structural_authoring" }>
        | Readonly<{ kind: "runtime_principal"; authentication: SessionAccessAuthentication }>,
): Promise<SessionContextInjectionDecision> {
    const runtimeAccess = admission.kind === "runtime_principal"
        ? await resolveEffectiveSessionAccess(tx, {
            accountId: destination.accountId,
            sessionId: sourceSessionId,
            authentication: admission.authentication,
        })
        : await resolveStructuralSessionAccess(tx, {
            accountId: destination.accountId,
            sessionId: sourceSessionId,
        });
    if (runtimeAccess?.capabilities.readTranscript !== true) {
        return { ok: false, reason: "destination_runtime_not_allowed" };
    }
    if (isPublicSessionShareActive(destination.publicShare)) {
        return { ok: false, reason: "destination_public" };
    }

    let afterAccountId: string | undefined;
    for (;;) {
        const audience = await listCurrentSessionAudienceAccountsInTx({
            tx,
            sessionId: destination.id,
            afterAccountId,
            limit: AUDIENCE_PAGE_SIZE,
        });
        const last = audience.at(-1);
        if (!last) break;
        const sourceAccess = await resolveStructuralSessionAccessForAccountsInTx(tx, {
            sessionId: sourceSessionId,
            accountIds: audience.map(({ accountId }) => accountId),
        });
        if (audience.some(({ accountId }) => sourceAccess.get(accountId)?.capabilities.readTranscript !== true)) {
            return { ok: false, reason: "destination_audience_broader" };
        }
        if (audience.length < AUDIENCE_PAGE_SIZE) break;
        afterAccountId = last.accountId;
    }
    return { ok: true, destinationRuntimeAccountId: destination.accountId };
}

/**
 * Re-evaluates the content-flow pair from current structural access facts.
 *
 * This is the access-transition entry point: no request credential exists while
 * a grant/audience mutation is being committed, so it deliberately performs no
 * author or runtime-principal check. It still delegates the complete custody,
 * destination-audience and public-link decision to the same pairwise owner used
 * by authoring and runtime admission.
 */
export async function evaluateCurrentSessionContextPairInTx(
    tx: Tx,
    input: Readonly<{
        sourceSessionId: string;
        destinationSessionId: string;
    }>,
): Promise<SessionContextInjectionDecision> {
    if (input.sourceSessionId === input.destinationSessionId) {
        return { ok: false, reason: "same_session" };
    }
    const sessions = await tx.session.findMany({
        where: { id: { in: [input.sourceSessionId, input.destinationSessionId] } },
        select: { id: true, accountId: true, publicShare: { select: { expiresAt: true } } },
    });
    const source = sessions.find(({ id }) => id === input.sourceSessionId);
    const destination = sessions.find(({ id }) => id === input.destinationSessionId);
    if (!source || !destination) return { ok: false, reason: "unavailable" };
    return await evaluateSessionContextPairInTx(
        tx,
        source.id,
        destination,
        { kind: "content_free_structural_authoring" },
    );
}

/**
 * Authorize one Follow source relation without writing grants, keys or the edge.
 * Both Sessions come from this Home's transaction; execution identity comes only
 * from destination custody. Source-key readiness is a separate runtime decision.
 */
export async function mayInjectSessionContextInTx(
    tx: Tx,
    input: Readonly<{
        configuringAccountId: string;
        sourceSessionId: string;
        destinationSessionId: string;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionContextInjectionDecision> {
    if (input.sourceSessionId === input.destinationSessionId) {
        return { ok: false, reason: "same_session" };
    }
    const sessions = await tx.session.findMany({
        where: { id: { in: [input.sourceSessionId, input.destinationSessionId] } },
        select: { id: true, accountId: true, publicShare: { select: { expiresAt: true } } },
    });
    const source = sessions.find(({ id }) => id === input.sourceSessionId);
    const destination = sessions.find(({ id }) => id === input.destinationSessionId);
    if (!source || !destination) return { ok: false, reason: "unavailable" };

    const [sourceAccess, destinationAccess] = await Promise.all([
        resolveEffectiveSessionAccess(tx, {
            accountId: input.configuringAccountId,
            sessionId: source.id,
            authentication: input.authentication,
        }),
        resolveEffectiveSessionAccess(tx, {
            accountId: input.configuringAccountId,
            sessionId: destination.id,
            authentication: input.authentication,
        }),
    ]);
    if (sourceAccess?.capabilities.readTranscript !== true || destinationAccess?.capabilities.submitAgentInput !== true) {
        return { ok: false, reason: "configurer_not_allowed" };
    }
    return await evaluateSessionContextPairInTx(
        tx,
        source.id,
        destination,
        { kind: "content_free_structural_authoring" },
    );
}

/**
 * One verified Follow runtime principal. The current member is the ordinary
 * destination runtime admitted through its exact current publisher/Session
 * binding; Lane 13's verified restricted-Runner principal joins this union
 * only when that composed flow lands (Lane 04 Plan 01 §6.7). A raw Account id
 * is never a principal: it must arrive from verified runtime authentication.
 */
export type SessionFollowRuntimePrincipalV1 =
    | Readonly<{
        kind: "destination_runtime";
        destinationRuntimeAccountId: string;
        authentication: SessionAccessAuthentication;
    }>
    | VerifiedEphemeralSessionRunnerPrincipal;

/**
 * Runtime Follow source-read admission (Lane 04 Plan 01 §6.7). `edge` is the
 * transaction-loaded current 09D row, never caller-supplied authorization, and
 * `principal` is the verified runtime principal from the current admission.
 * Admits only the edge's own source, rechecks current destination custody
 * against the principal, and consumes the same shared pairwise calculation as
 * authoring: runtime source read, the complete destination audience, and
 * public-link exclusion. No configuring actor, key readiness, or persisted
 * verdict exists here.
 */
export async function assertSessionFollowSourceReadInTx(
    tx: Tx,
    input: Readonly<{
        principal: SessionFollowRuntimePrincipalV1;
        sourceSessionId: string;
        edge: Readonly<{ sourceSessionId: string; destinationSessionId: string }>;
    }>,
): Promise<SessionContextInjectionDecision> {
    if (input.sourceSessionId === input.edge.destinationSessionId) {
        return { ok: false, reason: "same_session" };
    }
    if (input.sourceSessionId !== input.edge.sourceSessionId) {
        return { ok: false, reason: "unavailable" };
    }
    const sessions = await tx.session.findMany({
        where: { id: { in: [input.edge.sourceSessionId, input.edge.destinationSessionId] } },
        select: { id: true, accountId: true, publicShare: { select: { expiresAt: true } } },
    });
    const source = sessions.find(({ id }) => id === input.edge.sourceSessionId);
    const destination = sessions.find(({ id }) => id === input.edge.destinationSessionId);
    if (!source || !destination) return { ok: false, reason: "unavailable" };
    const destinationRuntimeAccountId = input.principal.kind === "destination_runtime"
        ? input.principal.destinationRuntimeAccountId
        : input.principal.accountId;
    if (destination.accountId !== destinationRuntimeAccountId) {
        return { ok: false, reason: "destination_runtime_not_allowed" };
    }
    const authentication = await resolveSessionFollowRuntimePrincipalAuthenticationInTx(tx, input.principal);
    return await evaluateSessionContextPairInTx(tx, source.id, destination, {
        kind: "runtime_principal",
        authentication,
    });
}

/**
 * The credential a runtime Follow principal actually holds.
 *
 * A destination runtime carries the credential its request was admitted with.
 * A Runner holds no request credential of its own: its authority is the
 * activation the creator authorized, so the server-owned activation snapshot is
 * the only honest evidence for it. Synthesizing an evidence-free automation
 * credential here silently denies every restricted-Team source the activation
 * was explicitly authorized to read.
 */
export async function resolveSessionFollowRuntimePrincipalAuthenticationInTx(
    tx: Tx,
    principal: SessionFollowRuntimePrincipalV1,
    env: NodeJS.ProcessEnv = process.env,
): Promise<SessionAccessAuthentication> {
    return principal.kind === "destination_runtime"
        ? principal.authentication
        : await readRunnerActivationAuthenticationInTx(tx, principal, env);
}
