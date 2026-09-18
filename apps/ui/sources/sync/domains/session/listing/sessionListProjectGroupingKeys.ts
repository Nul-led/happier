import { resolveAbsolutePath } from '@/utils/path/pathUtils';
import { normalizeNonEmptyString } from '@/utils/strings/normalizeNonEmptyString';
import { normalizeTrimmedString } from './normalizeTrimmedString';

function normalizePathForProjectGrouping(path: string): string {
    const withForwardSlashes = path.replace(/\\/g, '/');
    const leadingUncSlashes = withForwardSlashes.match(/^\/{2,}/)?.[0].length ?? 0;
    const uncPrefix = leadingUncSlashes >= 2 ? '//' : '';
    const rest = uncPrefix ? withForwardSlashes.slice(leadingUncSlashes) : withForwardSlashes;
    const normalized = uncPrefix + rest.replace(/\/+/g, '/');
    if (/^[a-zA-Z]:\/$/.test(normalized)) return normalized;
    if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1);
    return normalized;
}

export function normalizeSessionPathForProjectGrouping(pathInput: unknown, homeDirInput: unknown): string {
    const path = normalizeNonEmptyString(pathInput);
    if (!path) return '';

    const homeDirRaw = normalizeNonEmptyString(homeDirInput);
    const homeDir = homeDirRaw ? normalizePathForProjectGrouping(homeDirRaw) : null;
    const expanded = resolveAbsolutePath(path, homeDirRaw ?? undefined);

    return normalizePathForProjectGrouping(expanded);
}

export type SessionProjectGroupingKeyParts = Readonly<{
    machineGroupId: string;
    host: string | null;
    machineId: string | null;
    homeDir: string | null;
    pathKey: string;
}>;

export type SessionProjectGroupingKeyPartsWithMachineMetadata = SessionProjectGroupingKeyParts & Readonly<{
    displayPath: string | null;
}>;

export type SessionProjectGroupingIdentity = readonly [
    serverId: string | null,
    machineId: string | null,
    pathKey: string,
];

function normalizeHostForProjectGrouping(value: unknown): string | null {
    const host = normalizeNonEmptyString(value);
    return host ? host.toLowerCase().replace(/\.local$/, '') : null;
}

export function buildSessionProjectGroupingIdentity(
    serverIdInput: unknown,
    parts: Pick<SessionProjectGroupingKeyParts, 'machineId' | 'pathKey'>,
): SessionProjectGroupingIdentity {
    return [
        normalizeTrimmedString(serverIdInput) || null,
        parts.machineId,
        parts.pathKey,
    ];
}

/** Stable, reversible encoding of the exact Home/Machine/path tuple. */
export function sessionProjectGroupingIdentityKey(identity: SessionProjectGroupingIdentity): string {
    return JSON.stringify(identity);
}

export function resolveSessionProjectGroupingKeyParts(metadata: Readonly<{
    host?: unknown;
    machineId?: unknown;
    path?: unknown;
    homeDir?: unknown;
}> | null | undefined): SessionProjectGroupingKeyParts {
    const host = normalizeHostForProjectGrouping(metadata?.host);
    const machineId = normalizeNonEmptyString(metadata?.machineId);
    const homeDirRaw = normalizeNonEmptyString(metadata?.homeDir);
    const homeDir = homeDirRaw ? normalizePathForProjectGrouping(homeDirRaw) : null;
    const pathKey = normalizeSessionPathForProjectGrouping(metadata?.path, homeDir);
    const machineGroupId = machineId ? `id:${machineId}` : 'unknown';

    return {
        machineGroupId,
        host,
        machineId,
        homeDir,
        pathKey,
    };
}

export function resolveSessionProjectGroupingKeyPartsWithMachineMetadata(
    metadata: Readonly<{
        host?: unknown;
        machineId?: unknown;
        path?: unknown;
        homeDir?: unknown;
    }> | null | undefined,
    machineMetadata: Readonly<{
        host?: unknown;
        homeDir?: unknown;
    }> | null | undefined,
    displayPathInput?: unknown,
): SessionProjectGroupingKeyPartsWithMachineMetadata {
    const parts = resolveSessionProjectGroupingKeyParts(metadata);
    const host = normalizeHostForProjectGrouping(machineMetadata?.host) || parts.host;
    const homeDirRaw = normalizeTrimmedString(machineMetadata?.homeDir);
    const homeDir = homeDirRaw ? normalizePathForProjectGrouping(homeDirRaw) : parts.homeDir;
    const displayPath = normalizeTrimmedString(displayPathInput ?? metadata?.path) || null;
    const pathKey = normalizeSessionPathForProjectGrouping(displayPathInput ?? metadata?.path, homeDir);
    const machineGroupId = parts.machineId ? `id:${parts.machineId}` : 'unknown';

    return {
        machineGroupId,
        host,
        machineId: parts.machineId,
        homeDir,
        pathKey,
        displayPath,
    };
}
