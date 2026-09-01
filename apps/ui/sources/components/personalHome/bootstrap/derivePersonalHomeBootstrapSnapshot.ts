import type {
    PersonalHomeBootstrapSnapshot,
    PersonalHomeFacts,
} from './personalHomeBootstrapTypes';

function runtimeIsHealthy(facts: PersonalHomeFacts): boolean {
    const runtime = facts.relayRuntime;
    if (!runtime?.installed) return false;
    if (runtime.status === 'needs-repair' || runtime.status === 'unhealthy' || runtime.serviceActive === false) return false;
    return runtime.healthy === true || runtime.status === 'healthy';
}

function daemonIsReady(facts: PersonalHomeFacts): boolean {
    const daemon = facts.daemon;
    return daemon?.serviceInstalled === true
        && daemon.daemonRunning === true
        && daemon.needsAuth !== true
        && !daemon.error
        && Boolean(daemon.machineId)
        && daemon.daemonMachineRegistered !== false
        // A daemon that has not proven it serves THIS Personal Home (URL and account identity)
        // is never ready for it; the prepare-computer operation must verify or re-pair.
        && daemon.servesPersonalHome === true;
}

function daemonState(facts: PersonalHomeFacts): PersonalHomeBootstrapSnapshot['daemonState'] {
    if (daemonIsReady(facts)) return 'ready';
    if (facts.daemon == null) return 'not-started';
    if (facts.daemon.error || facts.daemon.needsAuth) return 'blocked';
    return 'pending';
}

function homeBlockedDetail(facts: PersonalHomeFacts): { message: string; code?: string } | null {
    if (facts.relayRuntime?.error) return { message: facts.relayRuntime.error, code: 'runtime' };
    if (facts.relayRuntime?.status === 'needs-repair' || facts.relayRuntime?.status === 'unhealthy') {
        return { message: 'Your local Home needs attention before it can start.', code: 'runtime_unhealthy' };
    }
    if (facts.localHomeAuth === 'invalid') return { message: 'Home authentication needs attention.', code: 'home_auth_invalid' };
    return null;
}

/**
 * Derives the bootstrap presentation from host facts only. This function intentionally has no
 * persistence or I/O: relaunching the app therefore resumes from the first missing invariant.
 */
export function derivePersonalHomeBootstrapSnapshot(facts: PersonalHomeFacts): PersonalHomeBootstrapSnapshot {
    if (!facts.hostIsDesktop || !facts.isDesktopMainWindow) {
        return {
            shouldGateShell: false,
            homeReady: true,
            daemonReady: daemonIsReady(facts),
            phase: 'ready',
            daemonState: daemonIsReady(facts) ? 'ready' : 'not-started',
            action: 'none',
        };
    }

    // An explicit selection is already the durable user decision. Keep the local
    // runtime untouched and let the selected Home own the normal shell.
    if (facts.explicitlySelectedOtherHome) {
        return {
            shouldGateShell: false,
            homeReady: facts.completedPersonalHomeProfile != null,
            daemonReady: daemonIsReady(facts),
            phase: 'ready',
            daemonState: daemonState(facts),
            action: 'none',
        };
    }

    // A profile carrying Lane 03's durable readiness classification must bypass this first-run
    // gate even when the managed runtime or daemon is temporarily offline.
    const alreadyCompleted = facts.completedPersonalHomeProfile != null;
    const runtimeReady = runtimeIsHealthy(facts) || alreadyCompleted;
    const identityReady = facts.localHomeIdentity != null || alreadyCompleted;
    const authReady = (facts.localHomeAuth === 'present' && facts.localHomeReachability === 'reachable') || alreadyCompleted;
    const signupClosed = facts.anonymousSignup === 'disabled' || alreadyCompleted;
    const daemonReady = daemonIsReady(facts);

    const installedPurpose = facts.relayRuntime?.purpose ?? null;
    const installedRuntimeNeedsExplicitChoice = !alreadyCompleted
        && installedPurpose?.kind !== 'personal-home'
        && (
            facts.relayRuntime?.dataPresent === true
            || facts.relayRuntime?.installed === true
        );
    if (installedRuntimeNeedsExplicitChoice) {
        return {
            shouldGateShell: true,
            homeReady: false,
            daemonReady,
            phase: 'blocked',
            daemonState: daemonState(facts),
            action: 'choose-existing-runtime',
            detail: {
                message: 'An existing local Home needs a choice before setup can continue.',
                code: 'existing_runtime',
                retryable: false,
            },
        };
    }

    // Erase intentionally retains the runtime registration so its explicit managed origin remains
    // available, but clears the Home's data and policy. This is not an automatic bootstrap
    // continuation: recreating a Personal Home is a new user decision made through Retry.
    const erasedPersonalHomeAwaitingRetry = !alreadyCompleted
        && facts.relayRuntime?.installed === true
        && facts.relayRuntime.dataPresent === false
        && facts.relayRuntime.purpose?.kind === 'personal-home'
        && facts.anonymousSignup === 'unknown';
    if (erasedPersonalHomeAwaitingRetry) {
        return {
            shouldGateShell: true,
            homeReady: false,
            daemonReady,
            phase: 'blocked',
            daemonState: daemonState(facts),
            action: 'retry',
            detail: {
                message: 'Your Personal Home was erased. Try again to create a new one.',
                code: 'personal_home_erased',
                retryable: true,
            },
        };
    }

    if (!runtimeReady) {
        const detail = homeBlockedDetail(facts);
        return {
            shouldGateShell: true,
            homeReady: false,
            daemonReady,
            phase: detail ? 'blocked' : 'ensuring-home',
            daemonState: daemonState(facts),
            action: detail ? 'retry' : 'none',
            ...(detail ? { detail: { ...detail, retryable: true } } : {}),
        };
    }

    if (!identityReady || !authReady) {
        const detail = homeBlockedDetail(facts);
        return {
            shouldGateShell: true,
            homeReady: false,
            daemonReady,
            phase: detail ? 'blocked' : 'ensuring-home',
            daemonState: daemonState(facts),
            action: detail ? 'retry' : 'none',
            ...(detail ? { detail: { ...detail, retryable: true } } : {}),
        };
    }

    if (!signupClosed) {
        const detail = facts.anonymousSignup === 'unknown' ? null : homeBlockedDetail(facts);
        return {
            shouldGateShell: true,
            homeReady: false,
            daemonReady,
            phase: detail ? 'blocked' : 'ensuring-home',
            daemonState: daemonState(facts),
            action: detail ? 'retry' : 'none',
            ...(detail ? { detail: { ...detail, retryable: true } } : {}),
        };
    }

    // Endpoint verification alone is not profile adoption. The candidate must be the canonical
    // URL-selected profile for the exact observed Home identity before first-run setup releases.
    const candidateIdentity = facts.candidateLocalProfile?.serverIdentityId?.trim() || null;
    const observedIdentity = facts.localHomeIdentity?.trim() || null;
    if (
        !alreadyCompleted
        && (!candidateIdentity || !observedIdentity || candidateIdentity !== observedIdentity)
    ) {
        return {
            shouldGateShell: true,
            homeReady: false,
            daemonReady,
            phase: 'ensuring-home',
            daemonState: daemonState(facts),
            action: 'none',
        };
    }

    // Durable readiness classification is secondary once the endpoint, identity, token auth and
    // signup closure are verified. Keep the shell released and retry the canonical non-focusing
    // adoption operation from inside the normal shell.
    if (!alreadyCompleted) {
        return {
            shouldGateShell: false,
            homeReady: true,
            daemonReady,
            phase: 'ensuring-home',
            daemonState: daemonState(facts),
            action: 'retry',
        };
    }

    return {
        shouldGateShell: false,
        homeReady: true,
        daemonReady,
        phase: daemonReady ? 'ready' : 'preparing-computer',
        daemonState: daemonState(facts),
        action: 'none',
    };
}
