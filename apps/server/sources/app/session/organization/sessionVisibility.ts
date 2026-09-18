import type { Tx } from "@/storage/inTx";
import type { Prisma } from "@prisma/client";

import { buildSessionAccessWhere } from "@/app/session/access/sessionAccessWhere";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

export async function createVisibleUnarchivedOrganizationSessionWhere(tx: Tx, accountId: string, authentication: SessionAccessAuthentication): Promise<Prisma.SessionWhereInput> {
    return {
        AND: [await buildSessionAccessWhere({ tx, accountId, capability: 'readTranscript', mode: 'effective_access_v1', authentication }), { archivedAt: null }],
    };
}
