import { artifactPluginCollectionHostReferenceAdapter } from "@/app/artifacts/artifactHostReference";
import {
    connectedAccountPluginCollectionHostReferenceAdapter,
} from "@/app/api/routes/connect/qualifiedConnectedAccounts/pluginCollectionHostReferenceAdapter";
import { machinePluginCollectionHostReferenceAdapter } from "@/app/machines/pluginCollectionHostReferenceAdapter";
import {
    messagePluginCollectionHostReferenceAdapter,
    resolveSessionHostReferenceForAuthenticationInTx,
    sessionPluginCollectionHostReferenceAdapter,
} from "@/app/session/pluginCollectionHostReferenceAdapter";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";
import type { Tx } from "@/storage/inTx";

import { accountPluginCollectionHostReferenceAdapter } from "./accountHostReference";
import {
    createPluginCollectionHostReferenceResolver,
    type PluginCollectionHostReferenceKind,
    type PluginCollectionHostReferenceAdapters,
} from "./hostReferences";

/**
 * The server mutation owner resolves host identities in its own transaction.
 * Domain adapters remain the only readers of their public Account-scoped
 * identities; absent domain adapters fail closed in the shared resolver.
 */
export const pluginCollectionHostReferenceResolver = createPluginCollectionHostReferenceResolver({
    account: accountPluginCollectionHostReferenceAdapter,
    machine: machinePluginCollectionHostReferenceAdapter,
    session: sessionPluginCollectionHostReferenceAdapter,
    message: messagePluginCollectionHostReferenceAdapter,
    artifact: artifactPluginCollectionHostReferenceAdapter,
    connectedAccount: connectedAccountPluginCollectionHostReferenceAdapter,
} satisfies PluginCollectionHostReferenceAdapters);

/** Request-bound resolver: only the Session domain varies because its Team access is credential-qualified. */
export async function resolvePluginCollectionHostReferenceForAuthenticationInTx(input: Readonly<{
    tx: Tx;
    accountId: string;
    hostKind: PluginCollectionHostReferenceKind;
    targetId: string;
    authentication: SessionAccessAuthentication;
}>) {
    if (input.hostKind === "session") {
        return await resolveSessionHostReferenceForAuthenticationInTx({
            tx: input.tx,
            accountId: input.accountId,
            targetId: input.targetId,
            authentication: input.authentication,
        });
    }
    return await pluginCollectionHostReferenceResolver.resolveInTx(input);
}
