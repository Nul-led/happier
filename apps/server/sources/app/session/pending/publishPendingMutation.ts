import { buildPendingChangedUpdate, eventRouter } from '@/app/events/eventRouter';
import {
    loadSessionTranscriptPublicationRecipientProjection,
    projectSessionTranscriptPublicationPendingProjection,
} from '@/app/session/sessionTranscriptPublicationPolicy';
import { db } from '@/storage/db';
import { randomKeyNaked } from '@/utils/keys/randomKeyNaked';
import { log } from '@/utils/logging/log';
import { mapPendingActivationAuthorization, type PendingActivationTarget } from './pendingActivationAuthorization';

export function buildPendingActivationRequestHint(
    activationTarget: PendingActivationTarget | undefined,
): Readonly<{ pendingActivationRequestId: string }> | undefined {
    return activationTarget ? { pendingActivationRequestId: activationTarget.requestId } : undefined;
}

export async function loadPendingActivationPublication(sessionId: string) {
    const row = await db.session.findUnique({
        where: { id: sessionId },
        select: {
            lastActiveAt: true,
            pendingActivationRequestId: true,
            pendingActivationRequestedAt: true,
            pendingActivationStatus: true,
            pendingActivationFailureCode: true,
        },
    });
    return row ? (mapPendingActivationAuthorization(row) ?? null) : null;
}

export async function emitPendingChanged(params: {
    sessionId: string;
    changedByAccountId: string;
    pendingCount: number;
    pendingBlockedCount?: number;
    pendingVersion: number;
    meaningfulActivityAt?: Date;
    participantCursors: Array<{ accountId: string; cursor: number }>;
    activationTarget?: PendingActivationTarget;
}): Promise<void> {
    const [session, pendingActivationAuthorization] = await Promise.all([
        loadSessionTranscriptPublicationRecipientProjection(params.sessionId),
        loadPendingActivationPublication(params.sessionId),
    ]);
    if (!session) return;
    const rawProjection = {
        pendingCount: params.pendingCount,
        ...(typeof params.pendingBlockedCount === 'number' ? { pendingBlockedCount: params.pendingBlockedCount } : {}),
        pendingVersion: params.pendingVersion,
        changedByAccountId: params.changedByAccountId,
        ...(params.meaningfulActivityAt ? { meaningfulActivityAt: params.meaningfulActivityAt } : {}),
        pendingActivationAuthorization,
    };
    const results = await Promise.allSettled(params.participantCursors.map(async ({ accountId, cursor }) => {
        const projection = projectSessionTranscriptPublicationPendingProjection(rawProjection, session, accountId);
        if (projection.kind === 'suppress') return;
        eventRouter.emitUpdate({
            userId: accountId,
            payload: buildPendingChangedUpdate(
                { sessionId: params.sessionId, ...projection.value },
                cursor,
                randomKeyNaked(12),
            ),
            recipientFilter: { type: 'all-interested-in-session', sessionId: params.sessionId },
        });
    }));
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') return;
        log(
            {
                module: 'session-pending-publication',
                level: 'warn',
                sessionId: params.sessionId,
                accountId: params.participantCursors[index]?.accountId ?? 'unknown',
            },
            'failed to emit pending-changed update',
            result.reason,
        );
    });
    if (params.activationTarget) {
        await emitPendingActivationHint({ ...params, activationTarget: params.activationTarget });
    }
}

/** The single emitter for lossy machine-scoped activation hints. Durable Session authorization is authoritative. */
export async function emitPendingActivationHint(params: {
    sessionId: string;
    changedByAccountId: string;
    pendingCount: number;
    pendingBlockedCount?: number;
    pendingVersion: number;
    meaningfulActivityAt?: Date;
    participantCursors: Array<{ accountId: string; cursor: number }>;
    activationTarget: PendingActivationTarget;
}): Promise<void> {
    const authorization = await loadPendingActivationPublication(params.sessionId);
    if (
        authorization?.status !== 'waiting'
        || authorization.requestId !== params.activationTarget.requestId
    ) return;
    const ownerCursor = params.participantCursors.find(
        ({ accountId }) => accountId === params.activationTarget.accountId,
    )?.cursor;
    if (typeof ownerCursor !== 'number') return;
    const hint = buildPendingActivationRequestHint(params.activationTarget);
    eventRouter.emitUpdate({
        userId: params.activationTarget.accountId,
        payload: buildPendingChangedUpdate(
            {
                sessionId: params.sessionId,
                pendingCount: params.pendingCount,
                ...(typeof params.pendingBlockedCount === 'number'
                    ? { pendingBlockedCount: params.pendingBlockedCount }
                    : {}),
                pendingVersion: params.pendingVersion,
                changedByAccountId: params.changedByAccountId,
                ...(params.meaningfulActivityAt ? { meaningfulActivityAt: params.meaningfulActivityAt } : {}),
                pendingActivationAuthorization: authorization,
                ...hint,
            },
            ownerCursor,
            randomKeyNaked(12),
        ),
        recipientFilter: { type: 'user-machine-scoped-only' },
    });
}
