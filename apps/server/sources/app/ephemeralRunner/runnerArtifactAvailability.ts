import {
    RunnerArtifactIdentityV1Schema,
    runnerArtifactTargetForPlatform,
    type RunnerArtifactIdentityV1,
    type RunnerArtifactTarget,
    type VerifiedRunnerArtifactV1,
} from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import { isRunnerArtifactTargetEligibleForPublication } from '@happier-dev/protocol/ephemeralRunner/runnerPackageLayout';
import { getReleaseProductPublication } from '@happier-dev/release-runtime/releaseProducts';
import { getReleaseRingCatalogEntry, type PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import { resolveReleaseAssetBundle } from '@happier-dev/release-runtime/assets';
import { fetchGitHubReleaseByTag, readGitHubReleaseHttpStatus } from '@happier-dev/release-runtime/github';
import { parseReleaseManifestV1 } from '@happier-dev/release-runtime/releaseManifest';
import { DEFAULT_MINISIGN_PUBLIC_KEY, resolveVerifiedReleaseArtifactDigest } from '@happier-dev/release-runtime/releaseArtifactVerification';
import { z } from 'zod';

export type RunnerArtifactUnavailableReasonV1 = 'publication_unavailable' | 'not_published' | 'target_not_published' | 'artifact_identity_mismatch';
export type RunnerArtifactAvailabilityResultV1 =
    | Readonly<{ ok: true; artifact: VerifiedRunnerArtifactV1 }>
    | Readonly<{ ok: false; reason: RunnerArtifactUnavailableReasonV1 }>;

export type RunnerArtifactSourceOptions = Readonly<{
    version?: string;
    channel?: PublicReleaseRingId;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    minisignPublicKeyFile?: string;
    publicationSnapshots?: RunnerArtifactPublicationSnapshotStore;
}>;

export type RunnerArtifactPublicationSnapshotStore = Readonly<{
    read: (key: string) => readonly VerifiedRunnerArtifactV1[] | undefined;
    write: (key: string, artifacts: readonly VerifiedRunnerArtifactV1[]) => void;
}>;

/**
 * Owns the server-process projection of already verified release publication.
 * Exact version aliases are immutable and serve activation admission. Rolling
 * aliases re-enter the release HTTP lifecycle on every caller read, then reuse
 * an already verified exact-version snapshot when the alias still names it.
 * Failed or empty reads stay retryable; no TTL or poller creates another
 * release-currentness policy.
 */
export function createRunnerArtifactPublicationSnapshotStore(): RunnerArtifactPublicationSnapshotStore {
    const snapshots = new Map<string, readonly VerifiedRunnerArtifactV1[]>();
    return {
        read: (key) => snapshots.get(key),
        write: (key, artifacts) => snapshots.set(key, artifacts),
    };
}

export const runnerArtifactPublicationSnapshots = createRunnerArtifactPublicationSnapshotStore();

const publication = getReleaseProductPublication('happier-runner');
const ReleaseSchema = z.object({
    tag_name: z.string(), draft: z.literal(false),
    assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })),
});
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The existing GitHub publication carries latest.json as an untrusted index.
 * Only its same-release signed checksums can establish an artifact digest.
 * Native Runner targets remain unavailable until their release owner supplies
 * authenticated stapled-app / Authenticode evidence; manifest flags prove neither.
 */
export async function readPublishedRunnerArtifacts(options: RunnerArtifactSourceOptions = {}): Promise<readonly VerifiedRunnerArtifactV1[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const repo = (process.env.HAPPIER_GITHUB_REPO ?? 'happier-dev/happier').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return [];
    const ring = getReleaseRingCatalogEntry(options.channel ?? 'stable');
    if (options.version !== undefined && !RELEASE_VERSION.test(options.version)) return [];
    const retained = options.version === undefined
        ? undefined
        : options.publicationSnapshots?.read(`${repo}\u0000${ring.id}\u0000${options.version}`);
    if (retained) return retained;
    const requestedTag = options.version
        ? `${publication.versionTagPrefix}${options.version}`
        : `${publication.rollingTagPrefix}-${ring.rollingReleaseSuffix}`;
    const headers = { 'user-agent': 'happier-release-runtime', accept: 'application/json' };
    async function read(url: string): Promise<string> {
        options.signal?.throwIfAborted();
        const response = await fetchImpl(url, { headers, signal: options.signal });
        if (!response.ok) throw new Error('Runner release unavailable');
        return response.text();
    }
    async function load(tag: string) {
        let releaseInput: unknown;
        try {
            releaseInput = await fetchGitHubReleaseByTag({
                githubRepo: repo,
                tag,
                userAgent: 'happier-release-runtime',
                fetchImpl,
                signal: options.signal,
            });
        } catch (error) {
            if (readGitHubReleaseHttpStatus(error) === 404) return null;
            throw error;
        }
        const release = ReleaseSchema.parse(releaseInput);
        if (release.tag_name !== tag) throw new Error('Runner release identity mismatch');
        const assetBase = `https://github.com/${repo}/releases/download/${tag}/`;
        const names = new Set<string>();
        for (const asset of release.assets) {
            if (names.has(asset.name) || !asset.name || asset.name.includes('/') || asset.name.includes('\\')
                || asset.browser_download_url !== `${assetBase}${asset.name}`) throw new Error('Runner release asset mismatch');
            names.add(asset.name);
        }
        const manifestAsset = release.assets.find((asset) => asset.name === 'latest.json');
        if (!manifestAsset) throw new Error('Runner manifest unavailable');
        const manifest = parseReleaseManifestV1(JSON.parse(await read(manifestAsset.browser_download_url)));
        if (manifest.product !== 'happier-runner') throw new Error('Runner manifest product mismatch');
        if (manifest.channel !== ring.manifestChannel) throw new Error('Runner manifest channel mismatch');
        if (!RELEASE_VERSION.test(manifest.version)) throw new Error('Runner release version invalid');
        return { release, manifest };
    }
    try {
        let loaded = await load(requestedTag);
        if (loaded === null) return [];
        const version = options.version ?? loaded.manifest.version;
        const immutableTag = `${publication.versionTagPrefix}${version}`;
        const immutableSnapshotKey = `${repo}\u0000${ring.id}\u0000${version}`;
        if (requestedTag !== immutableTag) {
            const retainedImmutable = options.publicationSnapshots?.read(immutableSnapshotKey);
            if (retainedImmutable) return retainedImmutable;
            const immutable = await load(immutableTag);
            if (immutable === null) return [];
            loaded = immutable;
        }
        const { release, manifest } = loaded;
        if (manifest.version !== version) return [];
        const result: VerifiedRunnerArtifactV1[] = [];
        for (const record of manifest.records) {
            if (record.version !== version || record.channel !== manifest.channel) continue;
            const target = runnerArtifactTargetForPlatform(record);
            // Protocol can name future targets, but the Home exposes only the
            // intersection of release-eligible targets and exact records from the
            // verified immutable publication. Eligibility alone advertises
            // nothing, and the route remains behind the default-off product gate.
            if (target === null || !isRunnerArtifactTargetEligibleForPublication(target)) continue;
            let bundle;
            try {
                bundle = resolveReleaseAssetBundle({ assets: release.assets, product: 'happier-runner', os: record.os, arch: record.arch, preferZipOnWindows: false });
            } catch {
                continue;
            }
            if (bundle.version !== version || record.url !== bundle.archive.url || record.signature !== bundle.checksumsSig.url) continue;
            const [checksumsText, checksumsSignatureFile] = await Promise.all([read(bundle.checksums.url), read(bundle.checksumsSig.url)]);
            const verified = resolveVerifiedReleaseArtifactDigest({
                artifactName: bundle.archive.name, checksumsText, checksumsSignatureFile,
                minisignPublicKeyFile: options.minisignPublicKeyFile ?? DEFAULT_MINISIGN_PUBLIC_KEY,
            });
            if (!verified.ok || verified.sha256 !== record.sha256 || !verified.archiveMetadata
                || record.sizeBytes !== verified.archiveMetadata.sizeBytes
                || JSON.stringify(record.entries) !== JSON.stringify(verified.archiveMetadata.entries)) continue;
            const identity = RunnerArtifactIdentityV1Schema.safeParse({ product: 'happier-runner', version, target, sha256: verified.sha256 });
            if (!identity.success) continue;
            result.push({ identity: identity.data, channel: manifest.channel, url: bundle.archive.url,
                checksumsUrl: bundle.checksums.url, checksumsSignatureUrl: bundle.checksumsSig.url,
                sizeBytes: verified.archiveMetadata.sizeBytes, entries: verified.archiveMetadata.entries });
        }
        // An exact verified artifact identity is immutable. An empty projection can
        // still mean publication is in progress, so leave that retryable.
        if (result.length > 0) {
            options.publicationSnapshots?.write(immutableSnapshotKey, result);
        }
        return result;
    } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new Error('runner_artifact_publication_unavailable');
    }
}

export async function listAvailableRunnerArtifactTargets(options: RunnerArtifactSourceOptions = {}): Promise<readonly RunnerArtifactTarget[]> {
    return (await readPublishedRunnerArtifacts(options)).map((artifact) => artifact.identity.target);
}

export async function resolveRunnerArtifactAvailability(
    identity: RunnerArtifactIdentityV1,
    options: Omit<RunnerArtifactSourceOptions, 'version'> = {},
): Promise<RunnerArtifactAvailabilityResultV1> {
    let available: readonly VerifiedRunnerArtifactV1[];
    try {
        available = await readPublishedRunnerArtifacts({ ...options, version: identity.version });
    } catch {
        return { ok: false, reason: 'publication_unavailable' };
    }
    if (!available.length) return { ok: false, reason: 'not_published' };
    const target = available.filter((artifact) => artifact.identity.target === identity.target);
    if (!target.length) return { ok: false, reason: 'target_not_published' };
    const artifact = target.find((artifact) => artifact.identity.product === identity.product
        && artifact.identity.version === identity.version && artifact.identity.sha256 === identity.sha256);
    return artifact ? { ok: true, artifact } : { ok: false, reason: 'artifact_identity_mismatch' };
}
