import { expect, it } from 'vitest';
import { createSessionOwnerMetadataV1, SessionOwnerMetadataV1Schema } from './sessionMetadataEnvelopesV1.js';

it('retains the strict managed-directory marker in owner workspace metadata', () => {
  const metadata = { v: 1, workspace: { path: '/private/allocation', sessionDirectoryV1: { v: 1, kind: 'managed' } } };
  expect(SessionOwnerMetadataV1Schema.safeParse(metadata)).toMatchObject({ success: true, data: metadata });
  expect(createSessionOwnerMetadataV1({ metadata: metadata.workspace })).toEqual({ ok: true, ownerMetadata: metadata });
});

it('packs a cross-machine fork outcome in the existing owner history envelope', () => {
  const forkV1 = { v: 1, parentSessionId: 'source-1', parentCutoffSeqInclusive: 1, createdAtMs: 1,
    strategy: 'replay', filesNotCopied: { reason: 'cross_machine' } };
  expect(createSessionOwnerMetadataV1({ metadata: { forkV1 } })).toEqual({
    ok: true, ownerMetadata: { v: 1, history: { forkV1 } },
  });
});
