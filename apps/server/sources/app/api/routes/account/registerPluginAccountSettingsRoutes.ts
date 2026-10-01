import {
    PluginAccountSettingsMutationRequestV1Schema,
    PluginAccountSettingsMutationResponseV1Schema,
    PluginAccountSettingsReadResponseV1Schema,
    PluginIdSchema,
} from "@happier-dev/protocol";
import { z } from "zod";

import { mutatePluginDeclarativeSettingsInTx, readPluginDeclarativeSettingsInTx } from "@/app/kv/pluginDeclarativeSettingsStorage";
import { asServerProtocolZod } from "@/app/api/utils/protocolComposableZodAdapter";
import type { Fastify } from "../../types";
import { registerReservedAccountScopedKvRowRoutes } from "./registerReservedAccountScopedKvRowRoutes";

/** Plugin field semantics remain with the plugin Settings domain. */
export function registerPluginAccountSettingsRoutes(app: Fastify): void {
    registerReservedAccountScopedKvRowRoutes(app, {
        path: "/v1/account/plugin-settings/:pluginId",
        paramsSchema: z.object({ pluginId: asServerProtocolZod(PluginIdSchema) }).strict(),
        mutationSchema: PluginAccountSettingsMutationRequestV1Schema,
        readResponseSchema: PluginAccountSettingsReadResponseV1Schema,
        mutationResponseSchema: PluginAccountSettingsMutationResponseV1Schema,
        unavailableError: "plugin_account_settings_storage_unavailable",
        read: (tx, { accountId, params }) => readPluginDeclarativeSettingsInTx(tx, { accountId, pluginId: params.pluginId }),
        mutate: (tx, { accountId, params, ...input }) => mutatePluginDeclarativeSettingsInTx(tx, { accountId, pluginId: params.pluginId, ...input }),
    });
}
