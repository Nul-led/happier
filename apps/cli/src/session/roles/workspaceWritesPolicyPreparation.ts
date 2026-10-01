import type { ActionExecutorContext } from '@happier-dev/protocol';
import type { RuntimeConfigUpdateOutcomeV1 } from '@/agent/runtime/turns/runtimeTurnOperations';

/** Native preparation may tighten early, but relaxation waits for owner-state dispatch. */
export function createWorkspaceWritesPolicyPreparation(params: Readonly<{
  update: (workspaceWrites: 'allow' | 'deny') => Promise<RuntimeConfigUpdateOutcomeV1 | void>;
}>) {
  return async (workspaceWrites: 'allow' | 'deny', actionContext?: ActionExecutorContext) => {
    if (workspaceWrites === 'allow' && actionContext) return { ok: true as const };
    const result = await params.update(workspaceWrites);
    if (result?.status === 'applied') return { ok: true as const };
    return { ok: false as const, errorCode: result?.reason?.includes('role_policy_restart_required')
      ? 'role_policy_restart_required' : 'role_policy_unenforceable' };
  };
}
