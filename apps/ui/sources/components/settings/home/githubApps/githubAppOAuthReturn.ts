import {
    consumePendingAdministrationOAuth,
    setPendingAdministrationOAuth,
    type PendingGitHubAppManifestSetupRecord,
} from '@/sync/domains/pending/pendingAdministrationOAuth';

type PendingGitHubAppReturn = Readonly<{
    registrationId: string;
    returnTo: string;
}>;

/**
 * Where a manifest-assisted registration should land when GitHub returns.
 *
 * Neither variant carries a finished path, because the registration id only
 * exists after the exchange; the callback owner builds the destination from the
 * exact administration tree the setup was started in.
 */
export type PendingGitHubAppManifestSetup = PendingGitHubAppManifestSetupRecord;

/**
 * Both handoffs are held by the shared administration OAuth custody owner rather than module
 * state: GitHub is reached through `openExternalUrl`, which on web opens a new `noopener`
 * document, so the return route runs with an empty module registry.
 */
export function recordPendingGitHubAppVerification(value: PendingGitHubAppReturn): void {
    setPendingAdministrationOAuth({ kind: 'github_app_verification', verification: { ...value } });
}

export function consumePendingGitHubAppVerification(registrationId: string): PendingGitHubAppReturn | null {
    return consumePendingAdministrationOAuth(
        'github_app_verification',
        (pending) => pending.verification.registrationId === registrationId,
    )?.verification ?? null;
}

export function recordPendingGitHubAppManifestSetup(value: PendingGitHubAppManifestSetup): void {
    setPendingAdministrationOAuth({ kind: 'github_app_manifest_setup', setup: value });
}

export function consumePendingGitHubAppManifestSetup(): PendingGitHubAppManifestSetup | null {
    return consumePendingAdministrationOAuth('github_app_manifest_setup')?.setup ?? null;
}
