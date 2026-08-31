import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Minimum public descriptor continuity metadata for the managed Personal Home
 * Iroh endpoint, persisted as one small atomic JSON file adjacent to the
 * canonical Iroh endpoint key (`<dataDir>/runtime/iroh/endpoint.key`).
 *
 * Purpose: detect endpoint-key loss and identity drift, and keep the
 * descriptor revision positive-monotonic across restarts when the endpoint
 * id, relay URLs, or direct addresses change. This is deliberately not a
 * database/table/registry and carries no credentials — every field is public
 * descriptor metadata.
 */

export const HOME_IROH_ENDPOINT_CONTINUITY_FILENAME = 'endpoint.descriptor.json';
export const HOME_IROH_ENDPOINT_CONTINUITY_VERSION = 1;

export type HomeIrohEndpointContinuityV1 = Readonly<{
    v: typeof HOME_IROH_ENDPOINT_CONTINUITY_VERSION;
    homeServerIdentityId: string;
    canonicalServerUrl: string;
    endpointId: string;
    relayUrls: readonly string[];
    directAddresses: readonly string[];
    revision: number;
}>;

export type ReadHomeIrohEndpointContinuityResult =
    | Readonly<{ state: 'absent' }>
    | Readonly<{ state: 'present'; continuity: HomeIrohEndpointContinuityV1 }>
    | Readonly<{ state: 'unreadable' }>;

export function resolveHomeIrohEndpointContinuityPath(irohEndpointKeyPath: string): string {
    return join(dirname(irohEndpointKeyPath), HOME_IROH_ENDPOINT_CONTINUITY_FILENAME);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseContinuity(raw: string): HomeIrohEndpointContinuityV1 | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    // Tolerant of unknown additive fields; strict on every known field so a
    // corrupted continuity record can never silently reset identity history.
    if (record.v !== HOME_IROH_ENDPOINT_CONTINUITY_VERSION) return null;
    if (!isNonEmptyString(record.homeServerIdentityId)) return null;
    if (!isNonEmptyString(record.canonicalServerUrl)) return null;
    if (!isNonEmptyString(record.endpointId)) return null;
    if (!isStringArray(record.relayUrls)) return null;
    if (!isStringArray(record.directAddresses)) return null;
    const revision = record.revision;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
    return {
        v: HOME_IROH_ENDPOINT_CONTINUITY_VERSION,
        homeServerIdentityId: record.homeServerIdentityId,
        canonicalServerUrl: record.canonicalServerUrl,
        endpointId: record.endpointId,
        relayUrls: Object.freeze([...record.relayUrls]),
        directAddresses: Object.freeze([...record.directAddresses]),
        revision,
    };
}

export async function readHomeIrohEndpointContinuity(
    continuityPath: string,
): Promise<ReadHomeIrohEndpointContinuityResult> {
    let raw: string;
    try {
        raw = await readFile(continuityPath, 'utf-8');
    } catch (error) {
        if ((error as { code?: unknown })?.code === 'ENOENT') {
            return { state: 'absent' };
        }
        return { state: 'unreadable' };
    }
    const continuity = parseContinuity(raw);
    return continuity ? { state: 'present', continuity } : { state: 'unreadable' };
}

/**
 * Atomically replaces the continuity file (temp file + rename) with
 * restrictive parent/file permissions where the platform supports them
 * (POSIX); Windows ignores the POSIX modes and keeps its own ACL defaults.
 */
export async function writeHomeIrohEndpointContinuity(
    continuityPath: string,
    continuity: HomeIrohEndpointContinuityV1,
): Promise<void> {
    await mkdir(dirname(continuityPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${continuityPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, `${JSON.stringify(continuity)}\n`, {
            encoding: 'utf-8',
            mode: 0o600,
        });
        await rename(temporaryPath, continuityPath);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
