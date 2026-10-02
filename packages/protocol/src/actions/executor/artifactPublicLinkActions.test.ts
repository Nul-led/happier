import { describe, expect, it } from 'vitest';
import { createArtifactPublicLinkActionsV1, type ArtifactPublicLinkIssuedV1, type ArtifactPublicLinkKeyholdingResourceV1 } from './artifactPublicLinkActions.js';
import { openPublicShareDataKeyV1 } from '../../crypto/publicShareEncryptedDataKeyEnvelopeV0.js';

const publicShare = { id: 'share-1', subject: { kind: 'artifact' as const, id: 'artifact-1' }, expiresAt: null,
  maxUses: null, useCount: 0, isConsentRequired: false, createdAt: 1, updatedAt: 1, keyDerivation: 'fragment_v1' as const };

describe('keyholding Artifact public-link Actions', () => {
  it.each(['plain', 'e2ee'] as const)('creates %s links with secrets delivered only locally', async encryptionMode => {
    const dataKey = encryptionMode === 'plain' ? null : new Uint8Array(32).fill(42);
    const resource: ArtifactPublicLinkKeyholdingResourceV1 = { artifactId: 'artifact-1', access: 'owner', header: {}, encryptionMode, dataKey };
    const issued: ArtifactPublicLinkIssuedV1[] = [];
    const bodies: Record<string, unknown>[] = [];
    let randomCounter = 1;
    const execute = createArtifactPublicLinkActionsV1({ read: async () => resource,
      randomBytes: length => new Uint8Array(length).fill(randomCounter++),
      onPublicLinkIssued: link => { issued.push(link); }, request: async request => {
        bodies.push(request.body as Record<string, unknown>);
        return { publicShare, isolatedOrigin: 'https://public.example.test' };
      } });
    const result = await execute({ actionId: 'artifact.public_link.create', input: { artifactId: 'artifact-1' } });
    expect(result).toEqual({ publicShare });
    const link = issued[0]!;
    expect(link.lookupId).not.toBe(link.secret);
    expect(link.url).toBe(`https://public.example.test/s/${link.lookupId}#k=${link.secret}`);
    expect(JSON.stringify({ bodies, result })).not.toContain(link.secret);
    expect(bodies[0]).toMatchObject({ subject: publicShare.subject, lookupId: link.lookupId, keyDerivation: 'fragment_v1' });
    if (dataKey) {
      expect(openPublicShareDataKeyV1({ encryptedDataKey: String(bodies[0]!.encryptedDataKey), secret: link.secret })).toEqual(dataKey);
      expect(openPublicShareDataKeyV1({ encryptedDataKey: String(bodies[0]!.encryptedDataKey), secret: link.lookupId })).toBeNull();
    } else expect(bodies[0]).not.toHaveProperty('encryptedDataKey');
  });

  it('refuses missing local custody and foreign share revocation before mutating HTTP', async () => {
    const requests: string[] = [];
    const execute = createArtifactPublicLinkActionsV1({ read: async () => ({ artifactId: 'artifact-1', access: 'owner', header: {}, encryptionMode: 'plain', dataKey: null }),
      randomBytes: length => new Uint8Array(length), request: async request => {
        requests.push(request.method);
        return { publicShares: [{ ...publicShare, subject: { kind: 'artifact', id: 'other' } }] };
      } });
    await expect(execute({ actionId: 'artifact.public_link.create', input: { artifactId: 'artifact-1' } })).rejects.toMatchObject({ code: 'public_link_custody_unavailable' });
    await expect(execute({ actionId: 'artifact.public_link.revoke', input: { artifactId: 'artifact-1', shareId: 'share-1' } })).rejects.toMatchObject({ code: 'public_share_not_found' });
    expect(requests).toEqual(['GET']);
  });
  it('does not disclose a local custody failure after the Home committed creation', async () => {
    const execute = createArtifactPublicLinkActionsV1({
      read: async () => ({ artifactId: 'artifact-1', access: 'owner', header: {}, encryptionMode: 'plain', dataKey: null }),
      randomBytes: length => new Uint8Array(length).fill(1),
      request: async () => ({ publicShare, isolatedOrigin: 'https://public.example.test' }),
      onPublicLinkIssued: link => { throw new Error(link.secret); },
    });
    await expect(execute({ actionId: 'artifact.public_link.create', input: { artifactId: 'artifact-1' } }))
      .rejects.toMatchObject({ code: 'outcome_unknown', message: 'outcome_unknown' });
  });
});
