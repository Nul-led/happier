/**
 * One-shot custody for an administration OAuth handoff, which has to survive the return document.
 *
 * The three administration starts — a Home managed identity provider Test, a GitHub App
 * installation verification and a GitHub App manifest setup — open the authorize URL through
 * `openExternalUrl`, which on web is `window.open(url, '_blank', 'noopener,noreferrer')`: a new
 * document with its own module registry. Module-local custody is therefore already gone by the
 * time `/oauth/<provider>` runs there, and a cold native restart loses it too, so a valid result
 * handle and the exact `returnTo` were discarded and the return fell back to the generic
 * administration error.
 *
 * This is the same non-secret pending-intent custody `pendingTerminalConnect` and
 * `pendingNotificationNav` already use in this domain. The record carries a return path, the
 * originating scope and an attempt or registration id the Home itself issued — never a credential,
 * a token or a result handle.
 *
 * One slot, because a person starts one administration handoff at a time and the return consumes
 * it once. A read that does not match the caller's exact key leaves the record in place, so an
 * unrelated return can never retire somebody else's handoff.
 */
export type PendingIdentityProviderTestRecord = Readonly<{
    kind: 'home';
    serverId: string;
    accountId: string;
    providerId: string;
    attemptId: string;
    returnTo: string;
}>;

export type PendingGitHubAppVerificationRecord = Readonly<{
    registrationId: string;
    returnTo: string;
}>;

export type PendingGitHubAppManifestSetupRecord =
    | Readonly<{ kind: 'home'; serverId: string }>
    | Readonly<{ kind: 'team'; serverId: string; teamId: string }>;

export type PendingAdministrationOAuth =
    | Readonly<{ kind: 'identity_provider_test'; test: PendingIdentityProviderTestRecord }>
    | Readonly<{ kind: 'github_app_verification'; verification: PendingGitHubAppVerificationRecord }>
    | Readonly<{ kind: 'github_app_manifest_setup'; setup: PendingGitHubAppManifestSetupRecord }>;

export type PendingAdministrationOAuthPersistence = Readonly<{
    read: () => string | null | undefined;
    write: (value: string) => boolean;
    clear: () => void;
}>;

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
    return value && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : {};
}

export function parsePendingAdministrationOAuth(raw: string | null | undefined): PendingAdministrationOAuth | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    const record = asRecord(parsed);
    if (record.kind === 'identity_provider_test') {
        const test = asRecord(record.test);
        const serverId = text(test.serverId);
        const accountId = text(test.accountId);
        const providerId = text(test.providerId);
        const attemptId = text(test.attemptId);
        const returnTo = text(test.returnTo);
        if (!serverId || !accountId || !providerId || !attemptId || !returnTo) return null;
        return {
            kind: 'identity_provider_test',
            test: { kind: 'home', serverId, accountId, providerId, attemptId, returnTo },
        };
    }
    if (record.kind === 'github_app_verification') {
        const verification = asRecord(record.verification);
        const registrationId = text(verification.registrationId);
        const returnTo = text(verification.returnTo);
        if (!registrationId || !returnTo) return null;
        return { kind: 'github_app_verification', verification: { registrationId, returnTo } };
    }
    if (record.kind === 'github_app_manifest_setup') {
        const setup = asRecord(record.setup);
        const serverId = text(setup.serverId);
        if (!serverId) return null;
        if (setup.kind === 'team') {
            const teamId = text(setup.teamId);
            return teamId
                ? { kind: 'github_app_manifest_setup', setup: { kind: 'team', serverId, teamId } }
                : null;
        }
        if (setup.kind === 'home') {
            return { kind: 'github_app_manifest_setup', setup: { kind: 'home', serverId } };
        }
        return null;
    }
    return null;
}

export function createPendingAdministrationOAuthOwner(persistence: PendingAdministrationOAuthPersistence) {
    const peek = (): PendingAdministrationOAuth | null => parsePendingAdministrationOAuth(persistence.read());
    return {
        setPendingAdministrationOAuth(value: PendingAdministrationOAuth): void {
            persistence.write(JSON.stringify(value));
        },
        peekPendingAdministrationOAuth: peek,
        consumePendingAdministrationOAuth<Kind extends PendingAdministrationOAuth['kind']>(
            kind: Kind,
            matches?: (value: Extract<PendingAdministrationOAuth, { kind: Kind }>) => boolean,
        ): Extract<PendingAdministrationOAuth, { kind: Kind }> | null {
            const current = peek();
            if (!current || current.kind !== kind) return null;
            const typed = current as Extract<PendingAdministrationOAuth, { kind: Kind }>;
            if (matches && !matches(typed)) return null;
            persistence.clear();
            return typed;
        },
        clearPendingAdministrationOAuth(): void {
            persistence.clear();
        },
    };
}
