type PendingGitHubAppReturn = Readonly<{
    registrationId: string;
    returnTo: string;
}>;

const pendingVerificationByRegistrationId = new Map<string, PendingGitHubAppReturn>();
/**
 * Where a manifest-assisted registration should land when GitHub returns.
 *
 * Neither variant carries a finished path, because the registration id only
 * exists after the exchange; the callback owner builds the destination from the
 * exact administration tree the setup was started in.
 */
export type PendingGitHubAppManifestSetup =
    | Readonly<{ kind: 'home'; serverId: string }>
    | Readonly<{ kind: 'team'; serverId: string; teamId: string }>;

let pendingManifestSetup: PendingGitHubAppManifestSetup | null = null;

export function recordPendingGitHubAppVerification(value: PendingGitHubAppReturn): void {
    pendingVerificationByRegistrationId.set(value.registrationId, value);
}

export function consumePendingGitHubAppVerification(registrationId: string): PendingGitHubAppReturn | null {
    const pending = pendingVerificationByRegistrationId.get(registrationId) ?? null;
    if (pending) pendingVerificationByRegistrationId.delete(registrationId);
    return pending;
}

export function recordPendingGitHubAppManifestSetup(value: PendingGitHubAppManifestSetup): void {
    pendingManifestSetup = value;
}

export function consumePendingGitHubAppManifestSetup(): PendingGitHubAppManifestSetup | null {
    const pending = pendingManifestSetup;
    pendingManifestSetup = null;
    return pending;
}
