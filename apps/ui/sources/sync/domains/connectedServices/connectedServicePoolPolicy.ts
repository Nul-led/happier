import type { ConnectedServiceAuthGroupPolicyV1 } from '@happier-dev/protocol';

/** Whether a pool's policy permits automatic movement when an account runs out. */
export function isPoolUsageLimitSwitchEnabled(policy: ConnectedServiceAuthGroupPolicyV1): boolean {
    return policy.strategy !== 'manual' && policy.autoSwitch && policy.switchOn.usageLimit;
}
