import { isDaemonOfAnotherAccount, isDaemonOnActiveRelay } from '@/sync/domains/server/relayDrift/relayDriftModel';

export function computeThisComputerMismatches(params: Readonly<{
    activeRelayUrl: string | null;
    activeLocalRelayUrl: string | null;
    daemonComparableKey: string | null;
    daemonAccountId: string | null;
    uiAccountId: string | null;
    needsAuth: boolean;
    machineId: string | null;
    machineRegistered: boolean | null;
}>): Readonly<{
    serverMismatch: boolean;
    accountMismatch: boolean;
    pairingRequired: boolean;
}> {
    // The relay and account comparisons are the drift owner's; this checklist only projects them.
    const serverMismatch = isDaemonOnActiveRelay({
        activeRelayUrl: params.activeRelayUrl,
        activeLocalRelayUrl: params.activeLocalRelayUrl,
        daemonRelayUrl: params.daemonComparableKey,
    }) === false;

    const accountMismatch = isDaemonOfAnotherAccount({
        daemonAccountId: params.daemonAccountId,
        appAccountId: params.uiAccountId,
    });

    const pairingRequired = params.needsAuth
        || params.machineRegistered === false
        || !String(params.machineId ?? '').trim();

    return {
        serverMismatch,
        accountMismatch,
        pairingRequired,
    };
}
