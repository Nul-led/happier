import { isServerFeatureEnabledForHome, type HomeConfigSource } from "@/app/features/catalog/serverFeatureGate";

export type AutomationRecipeFeaturePolicy = Readonly<{
    workflowsEnabled: boolean;
}>;

/**
 * Thin projection of the canonical server feature decision for Automation recipe owners, on the
 * Home-effective configuration (pass the transaction when called inside one).
 */
export async function resolveAutomationRecipeFeaturePolicy(
    source?: HomeConfigSource,
): Promise<AutomationRecipeFeaturePolicy> {
    return {
        workflowsEnabled: await isServerFeatureEnabledForHome("workflows", source),
    };
}
