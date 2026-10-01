import type { RelayDriftBanner } from '@/components/settings/server/relayDriftTypes';
import type { ThisComputerConnection } from '@/sync/domains/server/relayDrift/thisComputerConnection';

export type ThisComputerSetupPreflight = Readonly<{
    activeRelayUrl: string | null;
    activeWebappUrl: string | null;
    activeLocalRelayUrl: string | null;
    /** Identity of the Home this computer is being set up for; scopes its credential reads. */
    activeServerId: string | null;
    localCliReady?: boolean;
    /** Initial authoritative status read is pending; absent fixtures keep their prior semantics. */
    checking?: boolean;
    serviceInstalled: boolean;
    daemonRunning: boolean;
    machineId: string | null;
    needsAuth: boolean;
    daemonServerUrl: string | null;
    daemonComparableKey: string | null;
    daemonAccountId: string | null;
    daemonMachineRegistered: boolean | null;
    uiAccountId: string | null;
    serverMismatch: boolean;
    accountMismatch: boolean;
    pairingRequired: boolean;
    relayDriftBanner: RelayDriftBanner | null;
    /** The shared description of this computer's daemon (null while unknown or absent). */
    thisComputerConnection: ThisComputerConnection | null;
}>;
