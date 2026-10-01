import {
    PluginAccountStorageMutationRequestV1Schema,
    PluginAccountStorageMutationResponseV1Schema,
    PluginAccountStorageReadResponseV1Schema,
    PluginIdSchema,
} from "@happier-dev/protocol";
import { z } from "zod";

import { mutatePluginAccountStorageInTx, readPluginAccountStorageInTx } from "@/app/kv/pluginAccountStorage";
import { readAccountStoredContentCompatibilityForHttpRequest } from "@/app/clientCompatibility/accountStoredContentCompatibility";
import { asServerProtocolZod } from "@/app/api/utils/protocolComposableZodAdapter";
import type { Fastify } from "../../types";
import { registerReservedAccountScopedKvRowRoutes } from "./registerReservedAccountScopedKvRowRoutes";

/** Account-KV keeps its existing stored-content compatibility admission. */
export function registerPluginAccountStorageRoutes(app: Fastify): void {
    registerReservedAccountScopedKvRowRoutes(app, {
        path: "/v1/account/plugin-storage/:pluginId",
        paramsSchema: z.object({ pluginId: asServerProtocolZod(PluginIdSchema) }).strict(),
        mutationSchema: PluginAccountStorageMutationRequestV1Schema,
        readResponseSchema: PluginAccountStorageReadResponseV1Schema,
        mutationResponseSchema: PluginAccountStorageMutationResponseV1Schema,
        unavailableError: "plugin_account_storage_unavailable",
        available: request => readAccountStoredContentCompatibilityForHttpRequest(request).supportsPluginDataProtocol,
        read: (tx, { accountId, params }) => readPluginAccountStorageInTx(tx, { accountId, pluginId: params.pluginId }),
        mutate: (tx, { accountId, params, ...input }) => mutatePluginAccountStorageInTx(tx, { accountId, pluginId: params.pluginId, ...input }),
    });
}
