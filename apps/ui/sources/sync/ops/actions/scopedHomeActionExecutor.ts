import { createHomeDomainActionExecutorForScope } from '@/sync/api/home/homeDomainActions';
import {
    serverAccountScopeKeySuffix,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';
import { randomUUID } from '@/platform/randomUUID';

import { createDefaultActionExecutor } from './defaultActionExecutor';
import { createFrontDoorActionExecute } from './frontDoorRuntimeActionExecutor';

/**
 * One Action front door for one exact Home and Account.
 *
 * Home-governance, Team, identity-provider, and managed GitHub clients all use
 * this owner. Their HTTP leaves know only how to carry a declared Action row;
 * admission, settings, approval, provenance, and output validation therefore
 * cannot be bypassed by one administration surface growing its own adapter.
 */
const executorsByScope = new Map<
    string,
    ReturnType<typeof createFrontDoorActionExecute>
>();

export function scopedHomeActionExecutor(
    scope: ServerAccountScope,
): ReturnType<typeof createFrontDoorActionExecute> {
    const key = serverAccountScopeKeySuffix(scope);
    const existing = executorsByScope.get(key);
    if (existing) return existing;

    const executeFrontDoor = createFrontDoorActionExecute(createDefaultActionExecutor({
        homeDomainAction: createHomeDomainActionExecutorForScope(scope),
    }));
    const execute: ReturnType<typeof createFrontDoorActionExecute> = async (actionId, input, context) => (
        await executeFrontDoor(actionId, input, {
            ...context,
            // Deferred approvals need a durable identity for the admitted
            // request. Domain clients deliberately do not own approval custody,
            // so their shared front door supplies one attempt identity unless a
            // caller already carries a stronger stable request key.
            actionRequestId: context?.actionRequestId ?? randomUUID(),
        })
    );
    executorsByScope.set(key, execute);
    return execute;
}

export function resetScopedHomeActionExecutorsForTests(): void {
    executorsByScope.clear();
}
