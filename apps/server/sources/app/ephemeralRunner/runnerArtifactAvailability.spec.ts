import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { RunnerArtifactAvailabilityProjectionV1Schema } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import zipVector from '../../../../../packages/release-runtime/tests/fixtures/runnerZipMinisign.json';
// Test-only OpenSSL-signed publication; production release keys are never accessed.
const { artifactName: RELEASE_ARTIFACT_NAME, artifactSha256: RELEASE_ARTIFACT_SHA256 } = zipVector;
import { createRunnerArtifactPublicationSnapshotStore, readPublishedRunnerArtifacts, resolveRunnerArtifactAvailability } from './runnerArtifactAvailability';

const releaseBase = 'https://github.com/happier-dev/happier/releases/download/runner-v0.3.0';
const rollingReleaseBase = 'https://github.com/happier-dev/happier/releases/download/runner-stable';
const checksumsName = 'checksums-happier-runner-v0.3.0.txt';
const identity = { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: RELEASE_ARTIFACT_SHA256 } as const;

function networkFixture(options: {
    tamperedChecksums?: boolean;
    manifestDigest?: string;
    manifestSizeBytes?: number;
    releaseStatus?: number;
    manifestChannel?: 'stable' | 'preview' | 'publicdev';
} = {}) {
    const manifestChannel = options.manifestChannel ?? 'stable';
    const metadata = { sizeBytes: 321, entries: [{ path: 'happier-runner', kind: 'file', sizeBytes: 300, mode: 0o755 }] } as const;
    const signedChecksumsText = `${RELEASE_ARTIFACT_SHA256}  ${RELEASE_ARTIFACT_NAME}\n# happier-artifact-v1 ${JSON.stringify({ name: RELEASE_ARTIFACT_NAME, ...metadata })}\n`;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const keyId = Buffer.from('0102030405060708', 'hex');
    const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const signature = sign(null, Buffer.from(signedChecksumsText), privateKey);
    const trustedSuffix = Buffer.from('runner-metadata-fixture');
    const signatureFile = ['untrusted comment: test', Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64'),
        `trusted comment: ${trustedSuffix.toString()}`, sign(null, Buffer.concat([signature, trustedSuffix]), privateKey).toString('base64'), ''].join('\n');
    const publicKeyFile = `untrusted comment: test\n${Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64')}\n`;
    const manifest = JSON.stringify({
        schemaVersion: 'v1', product: 'happier-runner', channel: manifestChannel, version: '0.3.0',
        records: ['linux-x64', 'linux-arm64', 'darwin-arm64'].map((target) => {
            const [os, arch] = target.split('-');
            return {
                schemaVersion: 'v1', product: 'happier-runner', channel: manifestChannel, version: '0.3.0', os, arch,
                url: `${releaseBase}/happier-runner-v0.3.0-${target}.zip`,
                sha256: options.manifestDigest ?? RELEASE_ARTIFACT_SHA256,
                signature: `${releaseBase}/${checksumsName}.minisig`,
                publishedAt: '2026-09-08T00:00:00.000Z', minSupportedVersion: null,
                rolloutPercent: 100, critical: false, notesUrl: null,
                build: { commitSha: 'b'.repeat(40), workflowRunId: '123' },
                publication: { workflowRunId: '456' },
                ...metadata,
                sizeBytes: options.manifestSizeBytes ?? metadata.sizeBytes,
            };
        }),
        publishedAt: '2026-09-08T00:00:00.000Z',
    });
    const files = new Map<string, string>([
        [`${releaseBase}/${checksumsName}`, options.tamperedChecksums ? signedChecksumsText.replace(RELEASE_ARTIFACT_SHA256, 'b'.repeat(64)) : signedChecksumsText],
        [`${releaseBase}/${checksumsName}.minisig`, signatureFile],
        [`${releaseBase}/latest.json`, manifest],
        [`${rollingReleaseBase}/latest.json`, manifest],
    ]);
    const requests: string[] = [];
    // Genuine HTTP boundary: real parsing and signature verification run beneath it.
    const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        requests.push(url);
        if (options.releaseStatus && url.includes('/releases/tags/')) {
            return new Response('', { status: options.releaseStatus });
        }
        const tag = url === 'https://api.github.com/repos/happier-dev/happier/releases/tags/runner-v0.3.0'
            ? 'runner-v0.3.0'
            : url === 'https://api.github.com/repos/happier-dev/happier/releases/tags/runner-stable'
                ? 'runner-stable'
                : null;
        if (tag) {
            const base = tag === 'runner-stable' ? rollingReleaseBase : releaseBase;
            const names = tag === 'runner-stable'
                ? ['latest.json']
                : [...files.keys()].filter((candidate) => candidate.startsWith(`${releaseBase}/`)).map((candidate) => candidate.slice(candidate.lastIndexOf('/') + 1)).concat(RELEASE_ARTIFACT_NAME);
            return Response.json({ tag_name: tag, draft: false,
                assets: names.map((name) => ({
                    name, browser_download_url: `${base}/${name}`,
                })),
            });
        }
        const body = files.get(url);
        return new Response(body ?? '', { status: body === undefined ? 404 : 200 });
    };
    return { fetchImpl, requests, minisignPublicKeyFile: publicKeyFile };
}

function rollingPublicationFixture() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const keyId = Buffer.from('0102030405060708', 'hex');
    const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const publicKeyFile = `untrusted comment: test-only public key\n${Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64')}\n`;
    let rollingVersion = '0.3.0';
    let rollingAvailable = true;
    const requests: string[] = [];

    function publication(version: string) {
        const digest = version === '0.3.0' ? 'a'.repeat(64) : 'b'.repeat(64);
        const tag = `runner-v${version}`;
        const base = `https://github.com/happier-dev/happier/releases/download/${tag}`;
        const archiveName = `happier-runner-v${version}-linux-x64.zip`;
        const checksumsName = `checksums-happier-runner-v${version}.txt`;
        const checksumsText = `${digest}  ${archiveName}\n`;
        const metadata = { sizeBytes: 321, entries: [{ path: 'happier-runner', kind: 'file', sizeBytes: 300, mode: 0o755 }] };
        const signedChecksumsText = `${checksumsText.trim()}\n# happier-artifact-v1 ${JSON.stringify({ name: archiveName, ...metadata })}\n`;
        const signature = sign(null, Buffer.from(signedChecksumsText), privateKey);
        const trustedSuffix = Buffer.from(`test-only-${version}`);
        const signatureFile = [
            'untrusted comment: test-only signature',
            Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64'),
            `trusted comment: ${trustedSuffix.toString()}`,
            sign(null, Buffer.concat([signature, trustedSuffix]), privateKey).toString('base64'),
            '',
        ].join('\n');
        const manifest = JSON.stringify({
            schemaVersion: 'v1', product: 'happier-runner', channel: 'stable', version,
            records: [{
                schemaVersion: 'v1', product: 'happier-runner', channel: 'stable', version, os: 'linux', arch: 'x64',
                url: `${base}/${archiveName}`, sha256: digest, signature: `${base}/${checksumsName}.minisig`,
                publishedAt: '2026-09-08T00:00:00.000Z', minSupportedVersion: null,
                rolloutPercent: 100, critical: false, notesUrl: null,
                build: { commitSha: 'b'.repeat(40), workflowRunId: '123' },
                publication: { workflowRunId: '456' },
                ...metadata,
            }],
            publishedAt: '2026-09-08T00:00:00.000Z',
        });
        return { tag, base, archiveName, checksumsName, checksumsText: signedChecksumsText, signatureFile, manifest, digest };
    }

    const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        requests.push(url);
        if (!rollingAvailable && url.includes('/runner-stable')) return new Response('', { status: 503 });
        const tagMatch = /\/releases\/tags\/(runner-(?:stable|v[^/]+))$/.exec(url);
        if (tagMatch) {
            const tag = tagMatch[1]!;
            const version = tag === 'runner-stable' ? rollingVersion : tag.slice('runner-v'.length);
            const release = publication(version);
            const base = tag === 'runner-stable'
                ? 'https://github.com/happier-dev/happier/releases/download/runner-stable'
                : release.base;
            const names = tag === 'runner-stable'
                ? ['latest.json']
                : ['latest.json', release.checksumsName, `${release.checksumsName}.minisig`, release.archiveName];
            return Response.json({ tag_name: tag, draft: false,
                assets: names.map((name) => ({ name, browser_download_url: `${base}/${name}` })),
            });
        }
        const rollingManifestUrl = 'https://github.com/happier-dev/happier/releases/download/runner-stable/latest.json';
        if (url === rollingManifestUrl) return new Response(publication(rollingVersion).manifest);
        for (const version of ['0.3.0', '0.3.1']) {
            const release = publication(version);
            if (url === `${release.base}/latest.json`) return new Response(release.manifest);
            if (url === `${release.base}/${release.checksumsName}`) return new Response(release.checksumsText);
            if (url === `${release.base}/${release.checksumsName}.minisig`) return new Response(release.signatureFile);
        }
        return new Response('', { status: 404 });
    };

    return {
        fetchImpl,
        requests,
        minisignPublicKeyFile: publicKeyFile,
        publish(version: '0.3.0' | '0.3.1') {
            rollingVersion = version;
        },
        setRollingAvailable(available: boolean) {
            rollingAvailable = available;
        },
    };
}

describe('verified Runner artifact availability', () => {
    it.each([
        ['publicdev', 'runner-dev'],
        ['preview', 'runner-preview'],
    ] as const)('reads the %s Home ring from its canonical rolling Runner publication', async (channel, tag) => {
        const requests: string[] = [];
        const fetchImpl: typeof fetch = async (input) => {
            requests.push(String(input));
            return new Response('', { status: 404 });
        };

        await expect(readPublishedRunnerArtifacts({ channel, fetchImpl })).resolves.toEqual([]);
        expect(requests.length).toBeGreaterThan(0);
        expect(new Set(requests)).toEqual(new Set([
            `https://api.github.com/repos/happier-dev/happier/releases/tags/${tag}`,
        ]));
    });

    it('rejects an otherwise valid immutable manifest from another release ring', async () => {
        await expect(readPublishedRunnerArtifacts({
            version: '0.3.0',
            channel: 'stable',
            ...networkFixture({ manifestChannel: 'publicdev' }),
        })).rejects.toThrow('runner_artifact_publication_unavailable');
        await expect(resolveRunnerArtifactAvailability(identity, {
            channel: 'stable',
            ...networkFixture({ manifestChannel: 'publicdev' }),
        })).resolves.toEqual({ ok: false, reason: 'publication_unavailable' });
    });

    it('loads the immutable release and trusts only its cryptographically verified exact artifact digest', async () => {
        const network = networkFixture();
        const resolved = await resolveRunnerArtifactAvailability(identity, network);
        expect(resolved).toMatchObject({ ok: true, artifact: { identity, url: `${releaseBase}/${RELEASE_ARTIFACT_NAME}` } });
        if (!resolved.ok) throw new Error('fixture publication must resolve');
        expect(RunnerArtifactAvailabilityProjectionV1Schema.parse({ status: 'available', artifacts: [resolved.artifact] }))
            .toEqual({ status: 'available', artifacts: [resolved.artifact] });
        expect(network.requests).not.toContain(`${releaseBase}/${RELEASE_ARTIFACT_NAME}`);
        expect(await resolveRunnerArtifactAvailability({ ...identity, sha256: 'b'.repeat(64) }, network)).toMatchObject({ ok: false });
    });
    it('refreshes rolling publication reads while reusing exact immutable snapshots for activation admission', async () => {
        const network = rollingPublicationFixture();
        const publicationSnapshots = createRunnerArtifactPublicationSnapshotStore();
        const first = await readPublishedRunnerArtifacts({ ...network, publicationSnapshots });
        expect(first).toMatchObject([{ identity: { version: '0.3.0', sha256: 'a'.repeat(64) } }]);

        network.setRollingAvailable(false);
        await expect(readPublishedRunnerArtifacts({ ...network, publicationSnapshots }))
            .rejects.toThrow('runner_artifact_publication_unavailable');

        network.setRollingAvailable(true);
        network.publish('0.3.1');
        const second = await readPublishedRunnerArtifacts({ ...network, publicationSnapshots });
        expect(second).toMatchObject([{ identity: { version: '0.3.1', sha256: 'b'.repeat(64) } }]);
        const requestsAfterRefresh = network.requests.length;
        expect(await readPublishedRunnerArtifacts({ ...network, publicationSnapshots }))
            .toMatchObject([{ identity: { version: '0.3.1', sha256: 'b'.repeat(64) } }]);
        expect(network.requests.slice(requestsAfterRefresh)).toEqual([
            'https://api.github.com/repos/happier-dev/happier/releases/tags/runner-stable',
            'https://github.com/happier-dev/happier/releases/download/runner-stable/latest.json',
        ]);

        const requestsBeforeExactAdmission = network.requests.length;
        expect(await resolveRunnerArtifactAvailability(first[0]!.identity, { ...network, publicationSnapshots }))
            .toMatchObject({ ok: true, artifact: { identity: first[0]!.identity } });
        expect(network.requests).toHaveLength(requestsBeforeExactAdmission);
    });
    it('rejects altered checksums and unsigned manifest digest or platform-signing assertions', async () => {
        // Verification still fails closed; what must also be true is that a
        // declared-but-unverifiable record is reported as an invalid publication
        // rather than as a target nobody published.
        expect(await resolveRunnerArtifactAvailability(identity, networkFixture({ tamperedChecksums: true })))
            .toEqual({ ok: false, reason: 'publication_invalid' });
        expect(await resolveRunnerArtifactAvailability(identity, networkFixture({ manifestDigest: 'b'.repeat(64) })))
            .toEqual({ ok: false, reason: 'publication_invalid' });
        expect(await resolveRunnerArtifactAvailability(identity, networkFixture({ manifestSizeBytes: 322 })))
            .toEqual({ ok: false, reason: 'publication_invalid' });
        expect(await readPublishedRunnerArtifacts({ version: '0.3.0', ...networkFixture() })).toHaveLength(1);
    });
    it('distinguishes an absent immutable publication from a temporary metadata failure', async () => {
        expect(await readPublishedRunnerArtifacts({ version: '0.3.0', ...networkFixture({ releaseStatus: 404 }) }))
            .toEqual([]);
        expect(await resolveRunnerArtifactAvailability(identity, networkFixture({ releaseStatus: 404 })))
            .toEqual({ ok: false, reason: 'not_published' });
        await expect(readPublishedRunnerArtifacts({ version: '0.3.0', ...networkFixture({ releaseStatus: 503 }) }))
            .rejects.toThrow('runner_artifact_publication_unavailable');
        expect(await resolveRunnerArtifactAvailability(identity, networkFixture({ releaseStatus: 503 })))
            .toEqual({ ok: false, reason: 'publication_unavailable' });
    });
});
