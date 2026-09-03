import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
    resolveManagedServerLightPathEnvValue,
    resolvePersonalHomeRuntimeLayout,
} from '@happier-dev/cli-common/firstPartyRuntime';
import {
    HomeConnectionDescriptorV1Schema,
    type HomeConnectionEndpointV1,
} from '@happier-dev/protocol';
import { compareAndSetSimpleCache, readFromSimpleCache } from '@/storage/cache/simpleCache';

export type HomeConnectionDescriptorContinuity = Readonly<{
    revision: number;
    contentKey: string;
}>;

export type HomeConnectionDescriptorContinuityStore = Readonly<{
    read: () => Promise<HomeConnectionDescriptorContinuity | null>;
    write: (continuity: HomeConnectionDescriptorContinuity) => Promise<HomeConnectionDescriptorContinuityWriteResult>;
}>;

export type HomeConnectionDescriptorContinuityWriteResult = Readonly<{
    status: 'committed' | 'unchanged' | 'superseded';
    continuity: HomeConnectionDescriptorContinuity;
}>;

export class HomeConnectionDescriptorContinuityMalformedError extends Error {
    constructor() {
        super('Home connection descriptor continuity is malformed');
        this.name = 'HomeConnectionDescriptorContinuityMalformedError';
    }
}

export const HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY = 'home.connection-descriptor.continuity.v1';

export function resolveHomeConnectionDescriptorContinuityPath(irohEndpointKeyPath: string): string {
    return join(dirname(irohEndpointKeyPath), 'home.descriptor.json');
}

/**
 * Selects the server lifecycle's durable descriptor-continuity path once at
 * startup. Managed Personal Home consumes its canonical runtime layout and a
 * general file-backed server uses its already-owned light data directory.
 * Full PostgreSQL/MySQL servers use the existing namespaced `simpleCache`
 * owner, so the same full relay can publish as both Home and Account Service
 * without fabricating Personal Home filesystem state.
 */
type HomeConnectionDescriptorContinuityStoreDependencies = Readonly<{
    readSimpleCache: (key: string) => Promise<string | null>;
    compareAndSetSimpleCache: (key: string, expectedValue: string | null, nextValue: string) => Promise<boolean>;
}>;

const defaultStoreDependencies: HomeConnectionDescriptorContinuityStoreDependencies = {
    readSimpleCache: readFromSimpleCache,
    compareAndSetSimpleCache,
};

export function createHomeConnectionDescriptorContinuityStoreForServer(
    env: NodeJS.ProcessEnv,
    dependencies: HomeConnectionDescriptorContinuityStoreDependencies = defaultStoreDependencies,
): HomeConnectionDescriptorContinuityStore | null {
    const managedPurpose = String(env.HAPPIER_MANAGED_RELAY_PURPOSE ?? '').trim();
    if (managedPurpose === 'personal-home') {
        return createFileHomeConnectionDescriptorContinuityStore(
            resolveHomeConnectionDescriptorContinuityPath(
                resolvePersonalHomeRuntimeLayout({ env }).irohEndpointKeyPath,
            ),
        );
    }

    const dbProvider = String(env.HAPPIER_DB_PROVIDER ?? env.HAPPY_DB_PROVIDER ?? '').trim();
    if (dbProvider === 'postgres' || dbProvider === 'mysql') {
        return createSimpleCacheHomeConnectionDescriptorContinuityStore(dependencies);
    }
    if (dbProvider === 'sqlite' || dbProvider === 'pglite') {
        const dataDir = resolveManagedServerLightPathEnvValue(
            env,
            'HAPPIER_SERVER_LIGHT_DATA_DIR',
            'HAPPY_SERVER_LIGHT_DATA_DIR',
        ).trim();
        if (!dataDir) return null;
        return createFileHomeConnectionDescriptorContinuityStore(
            join(dataDir, 'runtime', 'home.descriptor.json'),
        );
    }
    return null;
}

const CONTENT_KEY_PATTERN = /^v1:([in]):([0-9a-f]{64})$/;
const SIMPLE_CACHE_VALUE_MAX_LENGTH = 191;

export function createHomeConnectionDescriptorContentKey(params: Readonly<{
    homeServerIdentityId: string;
    canonicalServerUrl: string;
    endpoints: readonly HomeConnectionEndpointV1[];
}>): string {
    const canonicalContent = JSON.stringify([
        params.homeServerIdentityId,
        params.canonicalServerUrl,
        params.endpoints,
    ]);
    const irohMarker = params.endpoints.some((endpoint) => endpoint.kind === 'iroh') ? 'i' : 'n';
    return `v1:${irohMarker}:${createHash('sha256').update(canonicalContent).digest('hex')}`;
}

export function homeConnectionDescriptorContentKeyCarriesIroh(contentKey: string | undefined): boolean {
    return contentKey?.startsWith('v1:i:') === true && CONTENT_KEY_PATTERN.test(contentKey);
}

function parseLegacyContentKey(contentKey: string): string | null {
    try {
        const parsed: unknown = JSON.parse(contentKey);
        if (!Array.isArray(parsed) || parsed.length !== 3) return null;
        const [homeServerIdentityId, canonicalServerUrl, endpoints] = parsed;
        const descriptor = HomeConnectionDescriptorV1Schema.safeParse({
            v: 1,
            homeServerIdentityId,
            canonicalServerUrl,
            revision: 1,
            endpoints,
        });
        return descriptor.success
            ? createHomeConnectionDescriptorContentKey(descriptor.data)
            : null;
    } catch {
        return null;
    }
}

function normalizeContentKey(contentKey: string): string | null {
    return CONTENT_KEY_PATTERN.test(contentKey) ? contentKey : parseLegacyContentKey(contentKey);
}

function parseHomeConnectionDescriptorContinuity(value: unknown): HomeConnectionDescriptorContinuity {
    if (!value || typeof value !== 'object') {
        throw new HomeConnectionDescriptorContinuityMalformedError();
    }
    const record = value as Record<string, unknown>;
    const contentKey = typeof record.contentKey === 'string'
        ? normalizeContentKey(record.contentKey)
        : null;
    const continuity = Number.isSafeInteger(record.revision) && Number(record.revision) > 0
        && contentKey !== null
        ? { revision: Number(record.revision), contentKey }
        : null;
    if (!continuity) throw new HomeConnectionDescriptorContinuityMalformedError();
    return continuity;
}

function parseSerializedContinuity(raw: string): HomeConnectionDescriptorContinuity {
    try {
        return parseHomeConnectionDescriptorContinuity(JSON.parse(raw));
    } catch (error) {
        if (error instanceof HomeConnectionDescriptorContinuityMalformedError) throw error;
        throw new HomeConnectionDescriptorContinuityMalformedError();
    }
}

function serializeContinuity(continuity: HomeConnectionDescriptorContinuity): string {
    const normalized = parseHomeConnectionDescriptorContinuity(continuity);
    if (normalized.contentKey !== continuity.contentKey) {
        throw new HomeConnectionDescriptorContinuityMalformedError();
    }
    const serialized = JSON.stringify(normalized);
    if (serialized.length > SIMPLE_CACHE_VALUE_MAX_LENGTH) {
        throw new HomeConnectionDescriptorContinuityMalformedError();
    }
    return serialized;
}

function sameContinuity(
    a: HomeConnectionDescriptorContinuity,
    b: HomeConnectionDescriptorContinuity,
): boolean {
    return a.revision === b.revision && a.contentKey === b.contentKey;
}

export function createFileHomeConnectionDescriptorContinuityStore(
    path: string,
): HomeConnectionDescriptorContinuityStore {
    return {
        read: async () => await readHomeConnectionDescriptorContinuity(path),
        write: async (continuity) => {
            const current = await readHomeConnectionDescriptorContinuity(path);
            if (current && sameContinuity(current, continuity)) {
                return { status: 'unchanged', continuity: current };
            }
            if (current && current.revision >= continuity.revision) {
                return { status: 'superseded', continuity: current };
            }
            await writeHomeConnectionDescriptorContinuity(path, continuity);
            return { status: 'committed', continuity };
        },
    };
}

export function createSimpleCacheHomeConnectionDescriptorContinuityStore(
    dependencies: HomeConnectionDescriptorContinuityStoreDependencies = defaultStoreDependencies,
): HomeConnectionDescriptorContinuityStore {
    return {
        read: async () => {
            const raw = await dependencies.readSimpleCache(HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY);
            return raw === null ? null : parseSerializedContinuity(raw);
        },
        write: async (continuity) => {
            const nextValue = serializeContinuity(continuity);
            while (true) {
                const observedRaw = await dependencies.readSimpleCache(HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY);
                const observed = observedRaw === null ? null : parseSerializedContinuity(observedRaw);
                if (observed && sameContinuity(observed, continuity)) {
                    if (observedRaw === nextValue) return { status: 'unchanged', continuity: observed };
                    if (await dependencies.compareAndSetSimpleCache(
                        HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY,
                        observedRaw,
                        nextValue,
                    )) {
                        return { status: 'committed', continuity: observed };
                    }
                    continue;
                }
                if (observed && observed.revision >= continuity.revision) {
                    return { status: 'superseded', continuity: observed };
                }
                if (await dependencies.compareAndSetSimpleCache(
                    HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY,
                    observedRaw,
                    nextValue,
                )) {
                    return { status: 'committed', continuity };
                }
            }
        },
    };
}

export async function readHomeConnectionDescriptorContinuity(
    path: string,
): Promise<HomeConnectionDescriptorContinuity | null> {
    try {
        return parseSerializedContinuity(await readFile(path, 'utf8'));
    } catch (error) {
        if (
            error !== null
            && typeof error === 'object'
            && 'code' in error
            && error.code === 'ENOENT'
        ) {
            return null;
        }
        throw error;
    }
}

export async function writeHomeConnectionDescriptorContinuity(
    path: string,
    continuity: HomeConnectionDescriptorContinuity,
): Promise<void> {
    const serialized = serializeContinuity(continuity);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, `${serialized}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryPath, path);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
