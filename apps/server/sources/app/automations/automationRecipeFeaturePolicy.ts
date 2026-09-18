import { isServerFeatureEnabledForRequest } from "@/app/features/catalog/serverFeatureGate";

export type AutomationRecipeFeaturePolicy = Readonly<{
    workflowsEnabled: boolean;
}>;

/** Thin projection of the canonical server feature decision for Automation recipe owners. */
export function resolveAutomationRecipeFeaturePolicy(
    env: NodeJS.ProcessEnv = process.env,
): AutomationRecipeFeaturePolicy {
    return {
        workflowsEnabled: isServerFeatureEnabledForRequest("workflows", env),
    };
}
