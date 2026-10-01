import type { AgentCliRuntimeDescriptor } from '@happier-dev/cli-common/agents';
import type { AgentCatalogEntry } from '@/agent/catalog/types';
import type { CapabilitiesInvokeResponse } from '@/capabilities/types';
import { invokeAgentCliInstall as invokeSharedProviderCliInstall } from '@/packagedRuntime/managedTools/invokeAgentCliInstall';

export async function invokeAgentCliInstallCapability(
    agentId: AgentCatalogEntry['id'],
    params?: Record<string, unknown>,
    runtimeSpec?: AgentCliRuntimeDescriptor,
): Promise<CapabilitiesInvokeResponse> {
    if (params?.dryRun !== true) {
        return { ok: false, error: { message: 'Use an agent install job for software changes.', code: 'unsupported-method' } };
    }
    const sharedParams = {
        ...(params?.intent === 'update' ? { intent: 'update' as const } : {}),
        ...(typeof params?.skipIfInstalled === 'boolean' ? { skipIfInstalled: params.skipIfInstalled } : {}),
        ...(typeof params?.platform === 'string' && params.platform.trim().length > 0 ? { platform: params.platform.trim() } : {}),
    };
    const result = await invokeSharedProviderCliInstall({
        agentId,
        runtimeSpec,
        params: { ...sharedParams, dryRun: true },
        env: process.env,
        nodePlatform: process.platform,
    });
    if (!result.ok) return {
        ok: false,
        error: { message: result.errorMessage, code: result.errorCode },
        ...(result.logPath ? { logPath: result.logPath } : {}),
    };
    return { ok: true, result: { plan: result.plan, alreadyInstalled: result.alreadyInstalled, logPath: result.logPath ?? null } };
}
