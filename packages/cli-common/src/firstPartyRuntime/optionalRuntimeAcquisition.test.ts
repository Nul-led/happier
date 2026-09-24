import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import * as tar from 'tar';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  fetchGitHubReleaseByTagMock,
} = vi.hoisted(() => ({
  fetchGitHubReleaseByTagMock: vi.fn(),
}));

vi.mock('@happier-dev/release-runtime/github', () => ({
  fetchGitHubReleaseByTag: fetchGitHubReleaseByTagMock,
}));

import { prepareFirstPartyComponentPayloadFromGitHubRelease } from './prepareFirstPartyComponentPayloadFromGitHubRelease.js';
afterEach(() => vi.clearAllMocks());

describe('optional runtime release pinning', () => {
  it('extracts only the exact authenticated component and rejects tampered archives and signatures', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'component-release-fixture-'));
    const componentId = 'happier-difftastic';
    const versionId = '0.2.12-preview.1';
    const archiveName = `${componentId}-v${versionId}-linux-x64.tar.gz`;
    const checksumsName = `checksums-${componentId}-v${versionId}.txt`;
    try {
      await mkdir(join(scratch, 'payload'));
      await writeFile(join(scratch, 'payload', 'difft'), 'signed fixture executable');
      await symlink('difft', join(scratch, 'payload', 'package-manager-link'));
      await tar.c({ cwd: scratch, file: join(scratch, archiveName), gzip: true, portable: true }, ['payload']);
      const archive = await readFile(join(scratch, archiveName));
      const checksums = `${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`;
      // Exercise the real verifier with an ephemeral publisher key; only the GitHub API is mocked.
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const keyId = Buffer.from('0123456789abcdef', 'hex');
      const rawKey = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
      const minisignPubkeyFile = `untrusted comment: fixture\n${Buffer.concat([Buffer.from('Ed'), keyId, rawKey]).toString('base64')}\n`;
      const signature = sign(null, Buffer.from(checksums), privateKey);
      const globalSignature = sign(null, Buffer.concat([signature, Buffer.from('fixture')]), privateKey);
      const sigFile = `untrusted comment: fixture\n${Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64')}\ntrusted comment: fixture\n${globalSignature.toString('base64')}\n`;
      const setAssets = (bytes: Buffer, signatureText = sigFile) => fetchGitHubReleaseByTagMock.mockResolvedValue({ assets: [
        { name: archiveName, browser_download_url: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
        { name: checksumsName, browser_download_url: `data:text/plain,${encodeURIComponent(checksums)}` },
        { name: `${checksumsName}.minisig`, browser_download_url: `data:text/plain,${encodeURIComponent(signatureText)}` },
      ] });
      const params = { componentId, versionId, channel: 'preview', os: 'linux', arch: 'x64', minisignPubkeyFile } as const;
      setAssets(archive);
      const prepared = await prepareFirstPartyComponentPayloadFromGitHubRelease(params);
      try {
        expect(prepared.versionId).toBe(versionId);
        expect(await readFile(join(prepared.payloadRoot, 'difft'), 'utf8')).toBe('signed fixture executable');
        await expect(lstat(join(prepared.payloadRoot, 'package-manager-link'))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await prepared.cleanup();
      }
      setAssets(Buffer.from('tampered'));
      await expect(prepareFirstPartyComponentPayloadFromGitHubRelease(params)).rejects.toThrow(/checksum verification failed/i);
      setAssets(archive, 'tampered');
      await expect(prepareFirstPartyComponentPayloadFromGitHubRelease(params)).rejects.toThrow(/signature verification failed/i);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each(['happier-memory-runtime', 'happier-voice-runtime', 'happier-difftastic'] as const)('pins %s to the exact CLI tag and rejects different asset versions', async (componentId) => {
    const version = '0.2.12-preview.2';
    fetchGitHubReleaseByTagMock.mockResolvedValue({ assets: [
      `checksums-${componentId}-v${version}.txt`,
      `checksums-${componentId}-v${version}.txt.minisig`,
      `${componentId}-v${version}-linux-x64.tar.gz`,
    ].map((name) => ({ name, browser_download_url: 'data:text/plain,invalid-signature' })) });
    await expect(prepareFirstPartyComponentPayloadFromGitHubRelease({
      componentId, channel: 'preview', versionId: '0.2.12-preview.1', os: 'linux', arch: 'x64',
    })).rejects.toThrow(/version.*0\.2\.12-preview\.1.*0\.2\.12-preview\.2/i);
    expect(fetchGitHubReleaseByTagMock).toHaveBeenCalledWith(expect.objectContaining({ tag: 'cli-v0.2.12-preview.1' }));
  });
});
