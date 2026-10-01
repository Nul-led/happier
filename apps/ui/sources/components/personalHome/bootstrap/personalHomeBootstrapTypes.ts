import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { SystemTaskRunState } from '@/components/systemTasks/types';
import type { ThisComputerConnection } from '@/sync/domains/server/relayDrift/thisComputerConnection';

export type PersonalHomeBootstrapPhase =
    | 'checking'
    | 'ensuring-home'
    | 'preparing-computer'
    | 'blocked'
    | 'ready';

export type NormalizedSetupDetail = Readonly<{
    code?: string;
    message: string;
    retryable: boolean;
    /** Set when the failure is a fact about this computer's daemon; recovery copy names it. */
    thisComputer?: ThisComputerConnection;
}>;

export type RelayRuntimeStatusSnapshot = Readonly<{
    /** Canonical loopback origin read from the runtime-status owner. */
    relayUrl: string;
    installed: boolean;
    dataPresent?: boolean;
    healthy?: boolean | null;
    serviceActive?: boolean | null;
    status?: 'absent' | 'installing' | 'stopped' | 'healthy' | 'unhealthy' | 'needs-repair';
    purpose?: Readonly<{ kind: 'personal-home'; canonicalServerUrl: string }>
        | Readonly<{ kind: 'generic' }>
        | null;
    anonymousSignupEnabled?: boolean | null;
    error?: string | null;
}>;

export type LocalDaemonStatus = Readonly<{
    serviceInstalled: boolean;
    daemonRunning: boolean;
    needsAuth: boolean;
    machineId: string | null;
    daemonMachineRegistered?: boolean | null;
    error?: string | null;
    /** Raw daemon readback binding, used only for the Personal Home target-verification projection. */
    daemonServerUrl?: string | null;
    daemonComparableKey?: string | null;
    daemonAccountId?: string | null;
    /**
     * Personal Home target-verification projection: true only when the daemon's connected URL
     * and account identity are proven to serve this Personal Home. Absent/false means readiness
     * is unproven and the prepare-computer operation must run or retry.
     */
    servesPersonalHome?: boolean | null;
}>;

export type PersonalHomeFacts = Readonly<{
    hostIsDesktop: boolean;
    isDesktopMainWindow: boolean;
    /** A durable, explicit selection of a different Home releases first-run Personal Home setup. */
    explicitlySelectedOtherHome: boolean;
    /**
     * R10 D4: the implicitly selected Home the app already holds credentials for (a 0.2 Cloud user,
     * say). While present, a Personal Home is created only after the user chooses it.
     */
    signedInOtherHome?: Readonly<{ serverId: string; label: string }> | null;
    completedPersonalHomeProfile: ServerProfile | null;
    candidateLocalProfile: ServerProfile | null;
    relayRuntime: RelayRuntimeStatusSnapshot | null;
    localHomeReachability: 'unknown' | 'unreachable' | 'reachable';
    localHomeIdentity: string | null;
    localHomeAuth: 'missing' | 'present' | 'invalid' | 'unknown';
    anonymousSignup: 'enabled' | 'disabled' | 'unknown';
    daemon: LocalDaemonStatus | null;
    activeTask: SystemTaskRunState | null;
}>;

export type PersonalHomeBootstrapSnapshot = Readonly<{
    shouldGateShell: boolean;
    homeReady: boolean;
    daemonReady: boolean;
    phase: PersonalHomeBootstrapPhase;
    daemonState: 'not-started' | 'pending' | 'ready' | 'blocked';
    action: 'none' | 'retry' | 'choose-existing-runtime' | 'choose-signed-in-home' | 'use-another-home' | 'open-details';
    /** The Home the user is already signed in to, named by the `choose-signed-in-home` decision. */
    signedInHomeLabel?: string;
    /** Facts already proven by the bootstrap owner; presentation may only count these. */
    progressMilestones?: Readonly<{
        runtimeHealthy: boolean;
        identityVerified: boolean;
        authenticated: boolean;
        signupClosed: boolean;
    }>;
    detail?: NormalizedSetupDetail;
}>;

export type PersonalHomeBootstrapOperation =
    | 'ensure-home-ready'
    | 'prepare-computer';
