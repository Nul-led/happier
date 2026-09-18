import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { resolveCliFeatureDecision } from '@/features/featureDecisionService';

export function getWorkflowRuntimeFeatureDecision(
  env: NodeJS.ProcessEnv,
  serverSnapshot: CliServerFeaturesSnapshot | undefined,
) {
  return resolveCliFeatureDecision({
    featureId: 'workflows',
    env,
    serverSnapshot,
  });
}

export function isWorkflowRuntimeEnabled(
  env: NodeJS.ProcessEnv,
  serverSnapshot: CliServerFeaturesSnapshot | undefined,
): boolean {
  return getWorkflowRuntimeFeatureDecision(env, serverSnapshot).state === 'enabled';
}
