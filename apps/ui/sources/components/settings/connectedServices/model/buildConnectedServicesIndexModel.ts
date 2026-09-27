import {
    buildQualifiedPluginContributionKey,
    isConnectedServiceCredentialHealthStatusUsable,
    normalizeConnectedServiceCredentialHealthStatus,
    type ConnectedServiceId,
    type PluginContributionIdentityV1,
    type QualifiedConnectedAccountGroupV4,
    type QualifiedConnectedAccountProfileV4,
} from '@happier-dev/protocol';

import type { ConnectedServiceRegistryEntry } from '@/sync/domains/connectedServices/connectedServiceRegistry';
import {
    compareAccountHealthSeverity,
    deriveAccountHealth,
    worstAccountHealth,
    type AccountHealth,
} from '@/sync/domains/connectedServices/deriveAccountHealth';
import {
    resolveConnectedServiceDefaultProfileId,
    resolveQualifiedConnectedAccountDefaultId,
} from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import type { ConnectedAccountUiNegotiation } from '@/sync/domains/connectedServices/resolveConnectedAccountUiNegotiation';

/** A released V2 service record as the profile projection carries it. */
export type ConnectedServicesIndexLegacyService = Readonly<{
    serviceId: string;
    profiles?: ReadonlyArray<Readonly<{
        profileId: string;
        status?: unknown;
        kind?: unknown;
        providerEmail?: string | null;
        providerAccountId?: string | null;
    }>>;
}>;

export type ConnectedServicesIndexAccount =
    | Readonly<{
        kind: 'qualified';
        accountId: string;
        status: unknown;
        profile: QualifiedConnectedAccountProfileV4;
    }>
    | Readonly<{
        kind: 'legacy';
        accountId: string;
        status: unknown;
        legacyServiceId: ConnectedServiceId;
        identityLabel: string | null;
    }>;

/** One service on the index: its identity, its accounts and its state. */
export type ConnectedServicesIndexSheet = Readonly<{
    serviceKey: string;
    service: PluginContributionIdentityV1;
    /** The descriptor, or the generated built-in fallback while no machine publishes one. */
    entry: ConnectedServiceRegistryEntry | null;
    legacyServiceId: ConnectedServiceId | null;
    label: string;
    /** Whether the service page can be opened (it needs an executable or generated owner). */
    canOpen: boolean;
    /** Worst health first, then a stable id order. */
    accounts: readonly ConnectedServicesIndexAccount[];
    connectedCount: number;
    groupCount: number;
    defaultAccountId: string | null;
    health: AccountHealth;
    /** The first account whose credential needs a new sign-in. */
    attentionAccountId: string | null;
    /** Bounded, product-safe state copy (blocked, unavailable, loading) or null when healthy. */
    statusLine: string | null;
    supportDetails: string | null;
}>;

/** A service the user can add a first account to. */
export type ConnectedServicesIndexConnectable = Readonly<{
    serviceKey: string;
    service: PluginContributionIdentityV1;
    entry: ConnectedServiceRegistryEntry;
    label: string;
}>;

export type ConnectedServicesIndexModel = Readonly<{
    sheets: readonly ConnectedServicesIndexSheet[];
    connectable: readonly ConnectedServicesIndexConnectable[];
}>;

function sameService(
    left: Readonly<{ pluginId: string; localId: string }>,
    right: Readonly<{ pluginId: string; localId: string }>,
): boolean {
    return left.pluginId === right.pluginId && left.localId === right.localId;
}

function healthOf(status: unknown): AccountHealth {
    return deriveAccountHealth({
        status: normalizeConnectedServiceCredentialHealthStatus(status),
        capacityPct: null,
    });
}

function isUsable(status: unknown): boolean {
    return isConnectedServiceCredentialHealthStatusUsable(
        normalizeConnectedServiceCredentialHealthStatus(status),
    );
}

function sortAccounts(
    accounts: readonly ConnectedServicesIndexAccount[],
): readonly ConnectedServicesIndexAccount[] {
    return [...accounts].sort((left, right) => {
        const rank = compareAccountHealthSeverity(healthOf(left.status), healthOf(right.status));
        return rank !== 0 ? rank : left.accountId.localeCompare(right.accountId);
    });
}

/**
 * Projects the Connected services index: one sheet per service that has accounts (or a state worth
 * showing), and the services a first account can still be added to.
 *
 * Accounts and pools are Account-level data, so a service with accounts is listed even when no
 * machine currently publishes its descriptor (an offline machine must not make accounts vanish); its
 * name then comes from the generated built-in fallback. Services without accounts come only from the
 * published descriptors, because only an online machine can add an account.
 */
export function buildConnectedServicesIndexModel(input: Readonly<{
    transport: ConnectedAccountUiNegotiation;
    entries: readonly ConnectedServiceRegistryEntry[];
    qualifiedAccounts: readonly QualifiedConnectedAccountProfileV4[];
    qualifiedGroups: readonly QualifiedConnectedAccountGroupV4[];
    legacyServices: readonly ConnectedServicesIndexLegacyService[];
    defaultAccountByServiceKey: Readonly<Record<string, string | undefined>>;
    resolveLabel: (entry: ConnectedServiceRegistryEntry | null) => string;
    /** Generated built-in entry for a qualified service no machine publishes, or null. */
    resolveFallbackEntry: (service: PluginContributionIdentityV1) => ConnectedServiceRegistryEntry | null;
    presentDiagnostics: (entry: ConnectedServiceRegistryEntry) => Readonly<{ primary: string | null; supportDetails: string | null }>;
    loadingLabel: string;
}>): ConnectedServicesIndexModel {
    const sheets: ConnectedServicesIndexSheet[] = [];
    const connectable: ConnectedServicesIndexConnectable[] = [];
    const seen = new Set<string>();

    const buildSheet = (
        service: PluginContributionIdentityV1,
        entry: ConnectedServiceRegistryEntry | null,
        published: boolean,
    ): ConnectedServicesIndexSheet | 'connectable' => {
        const serviceKey = buildQualifiedPluginContributionKey(service);
        const legacyServiceId = entry?.legacyServiceId ?? null;
        let accounts: ConnectedServicesIndexAccount[] = [];
        if (input.transport === 'advertised-v4') {
            accounts = input.qualifiedAccounts
                .filter((account) => sameService(account.ref.service, service))
                .map((profile) => ({
                    kind: 'qualified' as const,
                    accountId: profile.ref.accountId,
                    status: profile.status,
                    profile,
                }));
        } else if (input.transport === 'legacy' && legacyServiceId) {
            const legacy = input.legacyServices.find((candidate) => candidate.serviceId === legacyServiceId);
            accounts = (legacy?.profiles ?? []).map((profile) => ({
                kind: 'legacy' as const,
                accountId: profile.profileId,
                status: profile.status,
                legacyServiceId,
                identityLabel: profile.providerEmail ?? profile.providerAccountId ?? null,
            }));
        }
        const groupCount = input.transport === 'advertised-v4'
            ? input.qualifiedGroups.filter((group) => sameService(group.ref.service, service)).length
            : 0;
        const diagnostics = entry && published
            ? input.presentDiagnostics(entry)
            : { primary: null, supportDetails: null };
        const canOpen = published
            ? entry?.executable === true
                || (input.transport === 'legacy' && Boolean(legacyServiceId) && !entry?.projectedDescriptor)
            : entry !== null;

        if (
            published
            && input.transport !== 'indeterminate'
            && accounts.length === 0
            && groupCount === 0
            && canOpen
            && diagnostics.primary === null
        ) {
            return 'connectable';
        }

        const connectedIds = accounts
            .filter((account) => isUsable(account.status))
            .map((account) => account.accountId);
        const defaultAccountId = input.transport === 'advertised-v4'
            ? resolveQualifiedConnectedAccountDefaultId({
                service,
                legacyServiceId,
                connectedAccountIds: connectedIds,
                defaultAccountByServiceKey: input.defaultAccountByServiceKey,
            })
            : legacyServiceId
                ? resolveConnectedServiceDefaultProfileId({
                    serviceId: legacyServiceId,
                    connectedProfileIds: connectedIds,
                    defaultProfileByServiceId: input.defaultAccountByServiceKey,
                })
                : null;
        const sorted = sortAccounts(accounts);
        return {
            serviceKey,
            service,
            entry,
            legacyServiceId,
            label: input.resolveLabel(entry),
            canOpen,
            accounts: sorted,
            connectedCount: connectedIds.length,
            groupCount,
            defaultAccountId,
            health: worstAccountHealth(sorted.map((account) => healthOf(account.status))),
            attentionAccountId: sorted.find(
                (account) => normalizeConnectedServiceCredentialHealthStatus(account.status) === 'needs_reauth',
            )?.accountId ?? null,
            statusLine: diagnostics.primary
                ?? (input.transport === 'indeterminate' ? input.loadingLabel : null),
            supportDetails: diagnostics.supportDetails,
        };
    };

    for (const entry of input.entries) {
        if (!entry.service) continue;
        const serviceKey = buildQualifiedPluginContributionKey(entry.service);
        if (seen.has(serviceKey)) continue;
        seen.add(serviceKey);
        const result = buildSheet(entry.service, entry, true);
        if (result === 'connectable') {
            connectable.push({ serviceKey, service: entry.service, entry, label: input.resolveLabel(entry) });
        } else {
            sheets.push(result);
        }
    }

    if (input.transport === 'advertised-v4') {
        const orphanServices = [
            ...input.qualifiedAccounts.map((account) => account.ref.service),
            ...input.qualifiedGroups.map((group) => group.ref.service),
        ];
        for (const service of orphanServices) {
            const serviceKey = buildQualifiedPluginContributionKey(service);
            if (seen.has(serviceKey)) continue;
            seen.add(serviceKey);
            const sheet = buildSheet(service, input.resolveFallbackEntry(service), false);
            if (sheet !== 'connectable') sheets.push(sheet);
        }
    }

    sheets.sort((left, right) => {
        const rank = compareAccountHealthSeverity(left.health, right.health);
        return rank !== 0 ? rank : left.label.localeCompare(right.label);
    });
    connectable.sort((left, right) => left.label.localeCompare(right.label));
    return { sheets, connectable };
}
