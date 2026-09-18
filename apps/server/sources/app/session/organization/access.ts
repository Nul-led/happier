import { inTx } from "@/storage/inTx";
import { buildSessionAccessWhere } from "@/app/session/access/sessionAccessWhere";
import { createVisibleUnarchivedOrganizationSessionWhere } from "./sessionVisibility";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

export async function canAccessSyncedSessionForOrganization(params: Readonly<{
    accountId: string;
    sessionId: string;
    authentication: SessionAccessAuthentication;
}>): Promise<boolean> {
    return await inTx(async (tx) => {
        const row = await tx.session.findFirst({
            where: {
                AND: [{ id: params.sessionId }, await buildSessionAccessWhere({ tx, accountId: params.accountId, capability: 'readTranscript', mode: 'effective_access_v1', authentication: params.authentication })],
            },
            select: { id: true },
    });
    return Boolean(row);
    });
}

export async function canAccessVisibleUnarchivedSessionForOrganization(params: Readonly<{
    accountId: string;
    sessionId: string;
    authentication: SessionAccessAuthentication;
}>): Promise<boolean> {
    return await inTx(async (tx) => {
        const row = await tx.session.findFirst({
            where: {
                id: params.sessionId,
                ...await createVisibleUnarchivedOrganizationSessionWhere(tx, params.accountId, params.authentication),
            },
            select: { id: true },
    });
    return Boolean(row);
    });
}
