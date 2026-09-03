import type { Context } from "@/context";
import { inTx } from "@/storage/inTx";
import type { PreparedIdentityConnection } from "./identityProviders/types";
import { findIdentityProviderById } from "./identityProviders/registry";

type ExternalIdentityConnectionParams = {
    providerId: string;
    ctx: Context;
    profile: unknown;
    accessToken: string;
    refreshToken?: string;
    preferredUsername?: string | null;
};

export async function prepareExternalIdentityConnection(
    params: ExternalIdentityConnectionParams,
): Promise<PreparedIdentityConnection> {
    const providerId = params.providerId.toString().trim().toLowerCase();
    const provider = findIdentityProviderById(process.env, providerId);
    if (!provider) throw new Error("unsupported-provider");
    return await provider.prepareConnect({
        ctx: params.ctx,
        profile: params.profile,
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        preferredUsername: params.preferredUsername,
    });
}

export async function connectExternalIdentity(params: ExternalIdentityConnectionParams): Promise<void> {
    const prepared = await prepareExternalIdentityConnection(params);
    await inTx(prepared.connectInTx);
}

export async function disconnectExternalIdentity(params: { providerId: string; ctx: Context }): Promise<void> {
    const providerId = params.providerId.toString().trim().toLowerCase();
    const provider = findIdentityProviderById(process.env, providerId);
    if (!provider) throw new Error("unsupported-provider");
    return await provider.disconnect({ ctx: params.ctx });
}
