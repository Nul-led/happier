import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import vector from '../../../../../../../packages/release-runtime/tests/fixtures/runnerZipMinisign.json';

import { acquireRunnerArtifact } from './acquireRunnerArtifact';

function signedPublication(sizeBytes: number, artifactName = vector.artifactName) {
    const metadata = { sizeBytes, entries: [{ path: 'happier-runner', kind: 'file' as const, sizeBytes: 1, mode: 0o755 }] };
    const checksumsText = `${vector.artifactSha256}  ${artifactName}\n# happier-artifact-v1 ${JSON.stringify({ name: artifactName, ...metadata })}\n`;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keyId = Buffer.alloc(8, 7);
    const signature = sign(null, Buffer.from(checksumsText), privateKey);
    const comment = Buffer.from('fixture');
    return { metadata, checksumsText,
        signatureFile: ['untrusted comment: fixture', Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64'),
            'trusted comment: fixture', sign(null, Buffer.concat([signature, comment]), privateKey).toString('base64')].join('\n'),
        publicKeyFile: `untrusted comment: fixture\n${Buffer.concat([Buffer.from('Ed'), keyId, publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)]).toString('base64')}` };
}

describe('acquireRunnerArtifact', () => {
    it('streams the exact server projection into file custody only after signed identity verification', async () => {
        const artifactBytes = new TextEncoder().encode('runner fixture bytes');
        const written: Uint8Array[] = [];
        const signed = signedPublication(artifactBytes.byteLength);
        const base = 'https://releases.example/runner-v0.3.0';
        const artifact = {
            identity: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: vector.artifactSha256 },
            channel: 'stable', url: `${base}/${vector.artifactName}`,
            checksumsUrl: `${base}/checksums.txt`, checksumsSignatureUrl: `${base}/checksums.txt.minisig`, ...signed.metadata,
        } as const;
        // Genuine network/file boundaries are injected; parsing, signature and digest decisions remain real.
        const fetchImpl: typeof fetch = async (input) => {
            const url = String(input);
            if (url === artifact.checksumsUrl) return new Response(signed.checksumsText);
            if (url === artifact.checksumsSignatureUrl) return new Response(signed.signatureFile);
            return new Response(artifactBytes);
        };
        await expect(acquireRunnerArtifact({ artifact, fetchImpl, minisignPublicKeyFile: signed.publicKeyFile,
            createSink: async () => ({ writeBytes: async bytes => { written.push(bytes.slice()); }, close: async () => {}, cleanup: async () => {},
                source: async () => ({ kind: 'memory', bytes: Uint8Array.from(written.flatMap(bytes => [...bytes])) }),
                custody: { kind: 'native_cache_file', fileUri: 'file:///fixture' } }) }))
            .rejects.toThrow('artifact_digest_mismatch');
        expect(written).toHaveLength(1);
    });

    it('rejects an overrun or underrun before closing or exposing downloaded custody', async () => {
        const base = 'https://releases.example/runner-v0.3.0';
        for (const bytes of [new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2])]) {
            const signed = signedPublication(3);
            let closed = false;
            let cleaned = false;
            const artifact = { identity: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: vector.artifactSha256 },
                channel: 'stable', url: `${base}/${vector.artifactName}`, checksumsUrl: `${base}/checksums.txt`,
                checksumsSignatureUrl: `${base}/checksums.txt.minisig`, ...signed.metadata } as const;
            await expect(acquireRunnerArtifact({ artifact, minisignPublicKeyFile: signed.publicKeyFile,
                fetchImpl: async input => new Response(String(input).endsWith('.minisig') ? signed.signatureFile
                    : String(input) === artifact.checksumsUrl ? signed.checksumsText : bytes),
                createSink: async () => ({ writeBytes: async () => {}, close: async () => { closed = true; },
                    cleanup: async () => { cleaned = true; }, source: async () => ({ kind: 'memory', bytes }),
                    custody: { kind: 'native_cache_file', fileUri: 'file:///fixture' } }) }))
                .rejects.toThrow(/runner_artifact_(size_mismatch|identity_mismatch)/);
            expect(closed).toBe(false);
            expect(cleaned).toBe(true);
        }
    });

    it('never fetches artifact bytes when the signed identity does not match the projection', async () => {
        const urls: string[] = [];
        const base = 'https://releases.example/runner-v0.3.0';
        await expect(acquireRunnerArtifact({ artifact: { identity: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'b'.repeat(64) },
            channel: 'stable', url: `${base}/${vector.artifactName}`, checksumsUrl: `${base}/checksums.txt`, checksumsSignatureUrl: `${base}/checksums.txt.minisig`,
            sizeBytes: 1, entries: [{ path: 'happier-runner', kind: 'file', sizeBytes: 1, mode: 0o755 }] },
        minisignPublicKeyFile: vector.publicKeyFile, fetchImpl: async input => { const url = String(input); urls.push(url);
            return new Response(url.endsWith('.minisig') ? vector.signatureFile : vector.checksumsText); },
        createSink: async () => { throw new Error('sink must not open'); } })).rejects.toThrow('runner_artifact_identity_mismatch');
        expect(urls).toHaveLength(2);
    });

    it('rejects a signed archive whose filename does not match the exact target and version', async () => {
        const urls: string[] = [];
        const base = 'https://releases.example/runner-v0.3.0';
        const artifactName = 'happier-runner-v0.3.0-linux-arm64.zip';
        const signed = signedPublication(1, artifactName);
        const artifact = {
            identity: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: vector.artifactSha256 },
            channel: 'stable', url: `${base}/${artifactName}`,
            checksumsUrl: `${base}/checksums.txt`, checksumsSignatureUrl: `${base}/checksums.txt.minisig`, ...signed.metadata,
        } as const;
        await expect(acquireRunnerArtifact({ artifact, minisignPublicKeyFile: signed.publicKeyFile,
            fetchImpl: async input => { const url = String(input); urls.push(url);
                return new Response(url.endsWith('.minisig') ? signed.signatureFile : signed.checksumsText); },
            createSink: async () => { throw new Error('sink must not open'); } }))
            .rejects.toThrow('runner_artifact_reference_invalid');
        expect(urls).toEqual([]);
    });
});
