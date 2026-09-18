/** Exact consumer reference check for a managed GitHub identity connection. */
export function isExactGitHubIdentityInstallationBinding(input: Readonly<{
    providerInstallationId: string | null;
    connectionInstallationId: string;
}>): boolean {
    return input.providerInstallationId !== null
        && input.providerInstallationId === input.connectionInstallationId;
}
