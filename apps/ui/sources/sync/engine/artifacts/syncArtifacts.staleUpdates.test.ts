import { describe, expect, it } from 'vitest'
import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes'
import { ArtifactEncryption } from '@/sync/encryption/artifactEncryption'
const key = new Uint8Array(32).fill(1)
const codec = new ArtifactEncryption(key)

import { applySocketArtifactUpdate } from './syncArtifacts'

function buildArtifact(
    overrides: Partial<Extract<DecryptedArtifact, { isDecrypted: true }>> = {},
): DecryptedArtifact {
    return {
        id: 'a1',
        title: 'old',
        header: { title: 'old' },
        rawHeader: { title: 'old' },
        sessions: [],
        draft: false,
        body: 'old-body',
        headerVersion: 10,
        bodyVersion: 20,
        seq: 0,
        createdAt: 1,
        updatedAt: 2,
        isDecrypted: true,
        ...overrides,
    }
}

describe('applySocketArtifactUpdate stale guards', () => {
    it('returns existing artifact unchanged when both updates are stale', async () => {
        const existingArtifact = buildArtifact()

        const res = await applySocketArtifactUpdate({
            existingArtifact,
            createdAt: 999,
            dataEncryptionKey: key,
            header: { version: 10, value: 'h' },
            body: { version: 19, value: 'b' },
        })

        expect(res).toBe(existingArtifact)
    })

    it('decrypts only newer fields and does not regress versions', async () => {
        const existingArtifact = buildArtifact()

        const res = await applySocketArtifactUpdate({
            existingArtifact,
            createdAt: 999,
            dataEncryptionKey: key,
            header: { version: 11, value: await codec.encryptHeader({ title: 'new' }) },
            body: { version: 20, value: 'b-stale' },
        })

        expect(res).not.toBe(existingArtifact)
        expect(res.title).toBe('new')
        expect(res.rawHeader).toEqual({ title: 'new' })
        expect(res.body).toBe('old-body')
        expect(res.headerVersion).toBe(11)
        expect(res.bodyVersion).toBe(20)
        expect(res.updatedAt).toBe(999)
    })

    it('applies a newer body update when header is stale and leaves header fields unchanged', async () => {
        const existingArtifact = buildArtifact()

        const res = await applySocketArtifactUpdate({
            existingArtifact,
            createdAt: 1000,
            dataEncryptionKey: key,
            header: { version: 10, value: 'header-stale' },
            body: { version: 21, value: await codec.encryptBody({ body: 'b' }) },
        })

        expect(res).not.toBe(existingArtifact)
        expect(res.rawHeader).toBe(existingArtifact.rawHeader)
        expect(res.title).toBe('old')
        expect(res.body).toBe('b')
        expect(res.headerVersion).toBe(10)
        expect(res.bodyVersion).toBe(21)
    })

    it('returns existing artifact when no newer header/body fields are provided', async () => {
        const existingArtifact = buildArtifact()
        const res = await applySocketArtifactUpdate({
            existingArtifact,
            createdAt: 5000,
            dataEncryptionKey: key,
            header: null,
            body: undefined,
        })

        expect(res).toBe(existingArtifact)
    })

    it('refuses an encrypted update without its resource key', async () => {
        const existingArtifact = buildArtifact()

        await expect(
            applySocketArtifactUpdate({
                existingArtifact,
                createdAt: 1001,
                dataEncryptionKey: null,
                header: { version: 11, value: await codec.encryptHeader({ title: 'new' }) },
                body: { version: 20, value: 'body-stale' },
            }),
        ).rejects.toThrow('Artifact encryption key is unavailable')
    })
})
