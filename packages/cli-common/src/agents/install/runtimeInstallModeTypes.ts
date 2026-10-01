import type { InstallAgentCliResult, AgentCliInstallPlan } from '../install.js';
import type { AgentCliRuntimeDescriptor } from '../resolution.js';
import type { ManagedInstallDeps } from './managedInstall.js';
import type { RuntimeInstallLifecycleContext } from './runtimeInstallLifecycleContext.js';
import type { AgentInstallProgressCallback } from '../installProgress.js';

export type RuntimeInstallModeHandlerParams = Readonly<{
    runtimeSpec: AgentCliRuntimeDescriptor;
    plan: AgentCliInstallPlan;
    env: NodeJS.ProcessEnv;
    lifecycleContext: RuntimeInstallLifecycleContext;
    signal?: AbortSignal;
    onProgress?: AgentInstallProgressCallback;
    deps: ManagedInstallDeps;
}>;

export type RuntimeInstallModeHandlerEntry = Readonly<{
    matchesPlan: (plan: AgentCliInstallPlan) => boolean;
    run: (params: RuntimeInstallModeHandlerParams) => Promise<InstallAgentCliResult>;
}>;
