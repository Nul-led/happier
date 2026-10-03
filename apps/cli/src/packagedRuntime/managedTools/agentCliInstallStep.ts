import type { StepPrinter } from '@happier-dev/cli-common/output';

import type { AgentCliInstallInvocationResult } from './invokeAgentCliInstall';

type AgentCliInstallOk = Extract<AgentCliInstallInvocationResult, { ok: true }>;

/** How an install mode reads to a person ("via a managed release binary"), never the internal id. */
export function describeAgentCliInstallMode(installMode: AgentCliInstallOk['plan']['installMode']): string {
  if (installMode === 'github_release_binary') return 'a managed release binary';
  if (installMode === 'managed_package') return 'a managed package';
  if (installMode === 'vendor_recipe') return "the vendor's installer";
  return String(installMode).replace(/_/gu, ' ');
}

function describeInstalledAgentCli(title: string, result: AgentCliInstallOk): string {
  if (result.alreadyInstalled) return `${title} (already installed)`;
  if (result.plan.installMode === 'vendor_recipe') return `Installed ${title}`;
  return `Installed ${title} via ${describeAgentCliInstallMode(result.plan.installMode)}`;
}

/**
 * Shows one agent CLI install as a terminal step: "Installing <title>" while it runs, then the outcome
 * (✓ with what was done, or x). The install reports failure as a result rather than throwing, so the
 * caller still prints the error details and log path after the step.
 */
export async function runAgentCliInstallStep(
  steps: StepPrinter,
  title: string,
  install: () => Promise<AgentCliInstallInvocationResult>,
): Promise<AgentCliInstallInvocationResult> {
  const label = `Installing ${title}`;
  steps.start(label);
  let result: AgentCliInstallInvocationResult;
  try {
    result = await install();
  } catch (error) {
    steps.stop('x', label);
    throw error;
  }
  if (result.ok) steps.stop('✓', describeInstalledAgentCli(title, result));
  else steps.stop('x', label);
  return result;
}
