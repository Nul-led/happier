import { describe, expect, it } from 'vitest';

import {
  ReleasedDirectSessionShareCreateRequestV1Schema,
  ReleasedDirectSessionSharePatchRequestV1Schema,
  ReleasedDirectSessionShareResponseV1Schema,
  ReleasedDirectSessionSharesResponseV1Schema,
} from './releasedDirectSessionShareV1.js';

// Provenance: ../0.2 at 7e1ce993c408c0f634b81267aac2bcd8e7859975,
// apps/server/sources/app/api/routes/share/shareRoutes.ts. The current server
// compatibility adapter projects the same response bytes.
const RELEASED_SHARE = Object.freeze({
  id: 'share-1',
  sharedWithUser: Object.freeze({
    id: 'account-2',
    username: 'lee',
    firstName: 'Lee',
    lastName: null,
    avatar: null,
  }),
  accessLevel: 'edit',
  canApprovePermissions: false,
  createdAt: 1_725_000_000_000,
  updatedAt: 1_725_000_000_001,
});

describe('released direct Session share v1', () => {
  it('parses the provenance-pinned released create, patch, list, and row shapes', () => {
    expect(ReleasedDirectSessionShareCreateRequestV1Schema.parse({
      userId: 'account-2',
      accessLevel: 'edit',
      canApprovePermissions: false,
      encryptedDataKey: 'AAECAw==',
    })).toEqual({
      userId: 'account-2',
      accessLevel: 'edit',
      canApprovePermissions: false,
      encryptedDataKey: 'AAECAw==',
    });
    expect(ReleasedDirectSessionSharePatchRequestV1Schema.parse({ accessLevel: 'view' }))
      .toEqual({ accessLevel: 'view' });
    expect(ReleasedDirectSessionShareResponseV1Schema.parse({ share: RELEASED_SHARE }))
      .toEqual({ share: RELEASED_SHARE });
    expect(ReleasedDirectSessionSharesResponseV1Schema.parse({ shares: [RELEASED_SHARE] }))
      .toEqual({ shares: [RELEASED_SHARE] });
  });

  it.each([
    ['access level', { ...RELEASED_SHARE, accessLevel: 'write' }],
    ['profile', { ...RELEASED_SHARE, sharedWithUser: { ...RELEASED_SHARE.sharedWithUser, avatar: 42 } }],
    ['created timestamp', { ...RELEASED_SHARE, createdAt: 'yesterday' }],
    ['updated timestamp', { ...RELEASED_SHARE, updatedAt: Number.NaN }],
  ])('rejects a malformed %s', (_name, share) => {
    expect(ReleasedDirectSessionShareResponseV1Schema.safeParse({ share }).success).toBe(false);
  });

  it('keeps authority-bearing request and response objects closed', () => {
    expect(ReleasedDirectSessionShareCreateRequestV1Schema.safeParse({
      userId: 'account-2', accessLevel: 'view', extra: true,
    }).success).toBe(false);
    expect(ReleasedDirectSessionShareResponseV1Schema.safeParse({
      share: { ...RELEASED_SHARE, sessionId: 'not-part-of-the-released-route-response' },
    }).success).toBe(false);
  });
});
