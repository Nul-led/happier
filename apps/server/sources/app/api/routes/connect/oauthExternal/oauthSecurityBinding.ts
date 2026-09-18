import {
    resolveOAuthRuntimeByIdInTx,
    resolveRuntimeInTx,
} from "@/app/auth/providers/identityProviderCatalog";
import type { OAuthFlowProvider } from "@/app/oauth/providers/types";
import { inTx, type Tx } from "@/storage/inTx";
import type { OAuthSecurityBinding } from "./oauthExternalSchemas";
import { OAuthProviderConfigurationChangedError } from "./oauthExternalErrors";

/** Resolves only the runtime bound by the server-held attempt/pending, never a newer replacement. */
export async function resolveOAuthSecurityBinding(input: Readonly<{
    env: NodeJS.ProcessEnv;
    providerId: string;
    binding: OAuthSecurityBinding | undefined;
    purpose: OAuthSecurityBinding["purpose"];
    stage: "oauth_callback" | "oauth_finalize";
}>): Promise<Readonly<{ provider: OAuthFlowProvider; securityBinding: OAuthSecurityBinding }> | null> {
    return await inTx(async (tx) => await resolveOAuthSecurityBindingInTx(tx, input));
}

export async function resolveOAuthSecurityBindingInTx(tx: Tx, input: Readonly<{
    env: NodeJS.ProcessEnv;
    providerId: string;
    binding: OAuthSecurityBinding | undefined;
    purpose: OAuthSecurityBinding["purpose"];
    stage: "oauth_callback" | "oauth_finalize";
}>): Promise<Readonly<{ provider: OAuthFlowProvider; securityBinding: OAuthSecurityBinding }> | null> {
    if (!input.binding) {
        // Released server-v0.2.11 / preview.2 (98ea8fb76733b1dd785d38c31360179cafa84824)
        // and the current ../0.2 predecessor authored ordinary Home records without a reference.
        // Remove after legacy writers are drained plus the maximum attempt/pending TTL. Keep this
        // lookup inside the caller transaction so finalization observes one atomic current state.
        if (input.purpose !== null) return null;
        const current = await resolveOAuthRuntimeByIdInTx(tx, input.env, input.providerId);
        if (!current || current.reference.source === "managed" || current.reference.context.kind !== "home") return null;
        return {
            provider: current.provider,
            securityBinding: { provider: current.reference, connection: null, admission: null, purpose: null },
        };
    }
    if (input.binding.provider.id !== input.providerId || input.binding.purpose !== input.purpose) return null;
    const runtime = await resolveRuntimeInTx(tx, {
        env: input.env,
        reference: input.binding.provider,
        purpose: input.purpose === "identity_connection_test"
            ? "identity_connection_test"
            : input.stage,
    });
    if (!runtime.ok || !runtime.module.oauth) return null;
    const status = runtime.module.oauth.resolveStatus(input.env);
    if (!status.configured || (!status.enabled && input.purpose !== "identity_connection_test")) return null;
    return { provider: runtime.module.oauth, securityBinding: input.binding };
}

/** Rechecks at each final mutation boundary; the route consumes stale pending state after rollback. */
export async function requireCurrentOAuthPendingRuntime(input: Readonly<{
    providerId: string;
    pendingKey: string;
    binding: OAuthSecurityBinding | undefined;
    purpose: OAuthSecurityBinding["purpose"];
}>): Promise<OAuthFlowProvider> {
    const resolved = await resolveOAuthSecurityBinding({
        ...input, env: process.env, stage: "oauth_finalize",
    });
    if (!resolved) throw new OAuthProviderConfigurationChangedError(input.pendingKey);
    return resolved.provider;
}

export async function requireCurrentOAuthPendingRuntimeInTx(tx: Tx, input: Readonly<{
    providerId: string;
    pendingKey: string;
    binding: OAuthSecurityBinding | undefined;
    purpose: OAuthSecurityBinding["purpose"];
}>): Promise<OAuthFlowProvider> {
    const resolved = await resolveOAuthSecurityBindingInTx(tx, {
        ...input,
        env: process.env,
        stage: "oauth_finalize",
    });
    if (!resolved) throw new OAuthProviderConfigurationChangedError(input.pendingKey);
    return resolved.provider;
}
