import type { Session } from '@/sync/domains/state/storageTypes';

export type PendingChangedSessionPatch = Pick<Session, 'pendingCount' | 'pendingVersion'>
    & Pick<Partial<Session>, 'pendingBlockedCount' | 'meaningfulActivityAt' | 'pendingActivationAuthorization'>;

export function buildPendingChangedSessionPatch(body: Readonly<{
    pendingCount: number;
    pendingVersion: number;
    pendingBlockedCount?: unknown;
    meaningfulActivityAt?: unknown;
    pendingActivationAuthorization?: Session['pendingActivationAuthorization'];
}>): PendingChangedSessionPatch {
    const pendingBlockedCount = typeof body.pendingBlockedCount === 'number' && Number.isFinite(body.pendingBlockedCount)
        ? Math.max(0, Math.trunc(body.pendingBlockedCount))
        : undefined;
    const meaningfulActivityAt = typeof body.meaningfulActivityAt === 'number' && Number.isFinite(body.meaningfulActivityAt)
        ? body.meaningfulActivityAt
        : undefined;
    return {
        pendingCount: body.pendingCount,
        pendingVersion: body.pendingVersion,
        ...(pendingBlockedCount === undefined ? {} : { pendingBlockedCount }),
        ...(meaningfulActivityAt === undefined ? {} : { meaningfulActivityAt }),
        ...(Object.prototype.hasOwnProperty.call(body, 'pendingActivationAuthorization')
            ? { pendingActivationAuthorization: body.pendingActivationAuthorization ?? null }
            : {}),
    };
}
