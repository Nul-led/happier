import type { HomeSettingEntryV1, HomeSettingsProjectionV1 } from '@happier-dev/protocol/home/governance';

import {
    SERVER_RETENTION_DOMAIN_METADATA,
    getServerRetentionDomainMetadata,
    type ServerRetentionDomainMetadata,
} from '@/sync/domains/server/retention/serverRetentionDomainMetadata';

import { isHomeSettingWritable, parseHomeSettingText } from './homeSettingDeclaration';

/**
 * The Data page's reading of the registry's retention family (plan §3.6).
 *
 * Everything here comes from `home.settings.get`: the global switch and dry-run flag
 * (`family: 'retention'`), and per domain a mode key and a days key (`family: 'retention.user' |
 * 'retention.system'`, `group` = the domain id). The Home says which group a domain is in; the app's
 * retention metadata owner names it and orders it.
 */
export const HOME_RETENTION_ENABLED_KEY = 'HAPPIER_SERVER_RETENTION__ENABLED';
export const HOME_RETENTION_DRY_RUN_KEY = 'HAPPIER_SERVER_RETENTION__DRY_RUN';

export const HOME_RETENTION_KEEP = 'keep_forever';

export type HomeRetentionDeleteMode = 'delete_older_than' | 'delete_inactive';

export type HomeRetentionDomain = Readonly<{
    id: string;
    group: 'user' | 'system';
    mode: HomeSettingEntryV1;
    days: HomeSettingEntryV1 | null;
    /** The deleting value the mode key accepts, from its declared values. */
    deleteMode: HomeRetentionDeleteMode | null;
    metadata: ServerRetentionDomainMetadata | null;
}>;

export type HomeRetentionSettings = Readonly<{
    enabled: HomeSettingEntryV1 | null;
    dryRun: HomeSettingEntryV1 | null;
    user: readonly HomeRetentionDomain[];
    system: readonly HomeRetentionDomain[];
}>;

function domainOrder(id: string): number {
    const index = SERVER_RETENTION_DOMAIN_METADATA.findIndex((entry) => entry.key === id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function readDeleteMode(mode: HomeSettingEntryV1): HomeRetentionDeleteMode | null {
    const values = mode.declaration?.bounds?.values ?? [];
    if (values.includes('delete_inactive')) return 'delete_inactive';
    if (values.includes('delete_older_than')) return 'delete_older_than';
    return null;
}

export function selectHomeRetentionSettings(settings: HomeSettingsProjectionV1): HomeRetentionSettings {
    let enabled: HomeSettingEntryV1 | null = null;
    let dryRun: HomeSettingEntryV1 | null = null;
    const byDomain = new Map<string, { group: 'user' | 'system'; mode?: HomeSettingEntryV1; days?: HomeSettingEntryV1 }>();
    for (const entry of settings.entries) {
        if (entry.key === HOME_RETENTION_ENABLED_KEY) enabled = entry;
        else if (entry.key === HOME_RETENTION_DRY_RUN_KEY) dryRun = entry;
        const declaration = entry.declaration;
        if (!declaration || declaration.section !== 'data' || !declaration.group) continue;
        const group = declaration.family === 'retention.user' ? 'user' : declaration.family === 'retention.system' ? 'system' : null;
        if (!group) continue;
        const domain = byDomain.get(declaration.group) ?? { group };
        if (declaration.type === 'enum') domain.mode = entry;
        else if (declaration.type === 'int') domain.days = entry;
        byDomain.set(declaration.group, domain);
    }
    const domains: HomeRetentionDomain[] = [];
    for (const [id, domain] of byDomain) {
        if (!domain.mode) continue;
        domains.push(Object.freeze({
            id,
            group: domain.group,
            mode: domain.mode,
            days: domain.days ?? null,
            deleteMode: readDeleteMode(domain.mode),
            metadata: getServerRetentionDomainMetadata(id),
        }));
    }
    domains.sort((a, b) => domainOrder(a.id) - domainOrder(b.id));
    return Object.freeze({
        enabled,
        dryRun,
        user: domains.filter((domain) => domain.group === 'user'),
        system: domains.filter((domain) => domain.group === 'system'),
    });
}

/** Whether the domain currently deletes (its effective mode is its deleting value). */
export function homeRetentionDomainDeletes(domain: HomeRetentionDomain): boolean {
    return domain.mode.value !== HOME_RETENTION_KEEP && domain.mode.value !== null;
}

export function homeRetentionDomainDays(domain: HomeRetentionDomain): number | null {
    const value = domain.days?.value;
    return typeof value === 'number' ? value : null;
}

/** Whether the owner can change this domain: both of its keys are Home-editable and unfixed. */
export function isHomeRetentionDomainWritable(domain: HomeRetentionDomain): boolean {
    return isHomeSettingWritable(domain.mode) && (domain.days === null || isHomeSettingWritable(domain.days));
}

export type HomeRetentionChoice =
    | Readonly<{ mode: 'keep' }>
    | Readonly<{ mode: 'delete'; daysText: string }>;

export type HomeRetentionWrite =
    | Readonly<{ ok: true; values: Readonly<Record<string, unknown>>; changed: boolean }>
    | Readonly<{ ok: false; error: 'daysRequired' | 'daysInvalid' }>;

/**
 * The write a domain choice asks for. A deleting mode always travels with its days, because the
 * Home refuses one without the other; keeping forever writes the mode alone.
 */
export function buildHomeRetentionWrite(domain: HomeRetentionDomain, choice: HomeRetentionChoice): HomeRetentionWrite {
    if (choice.mode === 'keep') {
        const changed = homeRetentionDomainDeletes(domain);
        return Object.freeze({ ok: true, values: changed ? { [domain.mode.key]: HOME_RETENTION_KEEP } : {}, changed });
    }
    if (!domain.deleteMode || !domain.days) return Object.freeze({ ok: false, error: 'daysInvalid' });
    const parsed = parseHomeSettingText(domain.days, choice.daysText);
    if (!parsed.ok) return Object.freeze({ ok: false, error: parsed.reason === 'required' ? 'daysRequired' : 'daysInvalid' });
    const changed = !homeRetentionDomainDeletes(domain) || parsed.value !== domain.days.value;
    return Object.freeze({
        ok: true,
        values: changed ? { [domain.mode.key]: domain.deleteMode, [domain.days.key]: parsed.value } : {},
        changed,
    });
}
