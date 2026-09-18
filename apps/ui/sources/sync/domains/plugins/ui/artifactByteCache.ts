import type { PluginUiArtifactDigestV1 } from '@happier-dev/protocol/plugins/ui';

import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

export type PluginUiPersistentArtifactIdentity = Readonly<{
    accountScope: ServerAccountScope;
    releaseVersion: string;
    pluginId: string;
    contributionId: string;
    tier: 'declarative' | 'hostedWeb' | 'reactNative';
    platform: string;
    artifactDigest: PluginUiArtifactDigestV1;
}>;

export type PluginUiPersistentArtifactFile = Readonly<{
    relativePath: string;
    digest: PluginUiArtifactDigestV1;
    byteSize: number;
    bytes: Uint8Array;
}>;

/**
 * One persisted Artifact record is always the Artifact-owned exact file graph:
 * every declared file plus the declared entry path. `bytes` is the entry
 * file's bytes, retained so a reader does not have to re-resolve the entry.
 * There is deliberately no single-file/entry-only shape beside this contract.
 */
export type PluginUiPersistentArtifactRecord = Readonly<{
    persistentIdentity: PluginUiPersistentArtifactIdentity;
    bytes: Uint8Array;
    entryRelativePath: string;
    files: readonly PluginUiPersistentArtifactFile[];
}>;

/**
 * A native frame receives only this opaque cache locator. It never receives an
 * app-private URI, an Account coordinate, or Artifact bytes.
 */
export type PluginUiPersistentArtifactNativeStorageLocator = Readonly<{
    namespace: 'happier-plugin-ui-artifacts-v1';
    accountKeyHash: string;
    artifactKeyHash: string;
}>;

/** A native handler's private stored-file reference, never a manifest path. */
export type PluginUiPersistentArtifactNativeStoredResource = Readonly<{
    storedFileName: string;
    digest: PluginUiArtifactDigestV1;
    byteSize: number;
}>;

export type PluginUiPersistentArtifactNativeResourceDescriptor = Readonly<{
    locator: PluginUiPersistentArtifactNativeStorageLocator;
    /** Aligned with the Artifact-owned declared-file input order. */
    resources: readonly PluginUiPersistentArtifactNativeStoredResource[];
}>;

export type PluginUiPersistentArtifactStore = Readonly<{
    read: (
        identity: PluginUiPersistentArtifactIdentity,
    ) => Promise<PluginUiPersistentArtifactRecord | null>;
    write: (
        record: PluginUiPersistentArtifactRecord,
    ) => Promise<PluginUiPersistentArtifactWriteDisposition>;
    remove: (identity: PluginUiPersistentArtifactIdentity) => Promise<void>;
    removeAccount: (scope: ServerAccountScope) => Promise<void>;
}>;

export type PluginUiPersistentArtifactWriteDisposition =
    | 'persisted'
    | 'notPersistedOversize'
    | 'notPersistedCapacity';

/**
 * Native-only extension of the one verified persistent Artifact cache. The
 * descriptor deliberately exposes hashed cache coordinates and stored names,
 * never an absolute path or file bytes.
 */
export type PluginUiPersistentArtifactNativeResourceStore = PluginUiPersistentArtifactStore & Readonly<{
    describeNativeResource: (input: Readonly<{
        identity: PluginUiPersistentArtifactIdentity;
        files: readonly Readonly<{
            relativePath: string;
            digest: PluginUiArtifactDigestV1;
            byteSize: number;
        }>[];
    }>) => Promise<PluginUiPersistentArtifactNativeResourceDescriptor | null>;
}>;

/**
 * PEP-ARTIFACTS r0.19: the one measured device/runtime-wide persistent byte
 * budget each physical byte owner enforces across every Account. The measured
 * largest positive corpora are 71.417 MiB on web and 243.127 MiB on
 * iOS/Android, so two retained generations fit with headroom.
 */
export const PLUGIN_UI_PERSISTENT_ARTIFACT_WEB_BYTE_BUDGET = 192 * 1024 * 1024;
export const PLUGIN_UI_PERSISTENT_ARTIFACT_NATIVE_BYTE_BUDGET = 640 * 1024 * 1024;

/**
 * One retained persistent record as its physical owner sees it. `locationKey`
 * is that owner's own record address (a cache URL prefix or a record directory
 * URI), so the policy never has to re-derive storage layout.
 */
export type PluginUiPersistentArtifactRetainedRecord = Readonly<{
    locationKey: string;
    /** Payload plus the persisted commit marker, charged to the same total. */
    chargedBytes: number;
    lastAccessedAt: number;
}>;

export type PluginUiPersistentArtifactRetentionPlan =
    | Readonly<{
        persist: true;
        evictLocationKeys: readonly string[];
    }>
    | Readonly<{
        persist: false;
        reason: 'oversize' | 'capacity';
        evictLocationKeys: readonly string[];
    }>;

/**
 * The single retention decision shared by every physical Plugin UI byte owner:
 * one global cross-Account byte-LRU. Last access is the only ordering fact, so
 * there is deliberately no TTL or age expiry, no per-Account quota, and no
 * file-count quota. An artifact larger than the whole budget stays usable for
 * the current verified load but is never adopted into persistent storage.
 */
export function planPluginUiPersistentArtifactRetention(input: Readonly<{
    budgetBytes: number;
    incomingLocationKey: string;
    incomingChargedBytes: number;
    retained: readonly PluginUiPersistentArtifactRetainedRecord[];
    /** Existing mounted native registrations whose physical bytes must remain readable. */
    protectedLocationKeys?: ReadonlySet<string>;
}>): PluginUiPersistentArtifactRetentionPlan {
    const protectedLocationKeys = input.protectedLocationKeys ?? new Set<string>();
    const replaced = input.retained.filter((record) => record.locationKey === input.incomingLocationKey);
    const others = input.retained.filter((record) => record.locationKey !== input.incomingLocationKey);
    if (input.incomingChargedBytes > input.budgetBytes) {
        // Reclaim whatever already occupies that exact address so a rejected
        // adoption can never leave charged bytes no reader can commit to.
        return Object.freeze({
            persist: false,
            reason: 'oversize',
            evictLocationKeys: Object.freeze(replaced
                .filter((record) => !protectedLocationKeys.has(record.locationKey))
                .map((record) => record.locationKey)),
        });
    }
    if (protectedLocationKeys.has(input.incomingLocationKey)) {
        return Object.freeze({ persist: false, reason: 'capacity', evictLocationKeys: Object.freeze([]) });
    }
    const leastRecentlyAccessedFirst = others
        .filter((record) => !protectedLocationKeys.has(record.locationKey))
        .sort((left, right) => (
            left.lastAccessedAt - right.lastAccessedAt
            || (left.locationKey < right.locationKey ? -1 : left.locationKey > right.locationKey ? 1 : 0)
        ));
    const evictLocationKeys: string[] = [];
    let total = others.reduce((sum, record) => sum + record.chargedBytes, 0) + input.incomingChargedBytes;
    for (const candidate of leastRecentlyAccessedFirst) {
        if (total <= input.budgetBytes) break;
        total -= candidate.chargedBytes;
        evictLocationKeys.push(candidate.locationKey);
    }
    if (total > input.budgetBytes) {
        // Do not discard unrelated inactive bytes when the protected mounted
        // set still makes persistence impossible. The verified incoming graph
        // remains usable through the existing current-load transport.
        return Object.freeze({ persist: false, reason: 'capacity', evictLocationKeys: Object.freeze([]) });
    }
    return Object.freeze({ persist: true, evictLocationKeys: Object.freeze(evictLocationKeys) });
}

/**
 * Last-access stamps for the byte-LRU. Wall-clock time supplies ordering across
 * restarts while the in-process floor keeps same-millisecond accesses strictly
 * ordered. The value is only ever compared with other stamps, never with the
 * current time: this is eviction ordering, not a TTL.
 */
export function createPluginUiPersistentArtifactAccessClock(): () => number {
    let previous = 0;
    return () => {
        const now = Date.now();
        previous = now > previous ? now : previous + 1;
        return previous;
    };
}

/**
 * Serialize one physical owner's operations so a scan/commit/eviction remains
 * one decision even when independent Account lifetimes finish concurrently.
 * This is process-local ordering only, not a worker, lease, or byte owner.
 */
export function createPluginUiPersistentArtifactOperationQueue(): <T>(
    operation: () => Promise<T>,
) => Promise<T> {
    let tail: Promise<void> = Promise.resolve();
    return <T>(operation: () => Promise<T>) => {
        const result = tail.then(operation, operation);
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
}

/** A persisted stamp that predates the byte-LRU sorts as the oldest entry. */
export function readPluginUiPersistentArtifactAccessStamp(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function encodeIdentityPart(value: string): string {
    return `${new TextEncoder().encode(value).byteLength}:${value}`;
}

export function derivePluginUiPersistentArtifactKey(
    identity: PluginUiPersistentArtifactIdentity,
): string {
    return [
        identity.accountScope.serverId,
        identity.accountScope.accountId,
        identity.pluginId,
        identity.releaseVersion,
        identity.contributionId,
        identity.tier,
        identity.platform,
        identity.artifactDigest,
    ].map(encodeIdentityPart).join('');
}

export function derivePluginUiPersistentArtifactAccountKey(scope: ServerAccountScope): string {
    return [scope.serverId, scope.accountId].map(encodeIdentityPart).join('');
}
