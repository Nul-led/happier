import { describe, expect, it } from 'vitest';

import { projectLegacySessionAccessCapabilitiesV1 } from '../access/sessionEffectiveAccessV1.js';
import { V2SessionRecordSchema } from '../control/contract.js';
import { SessionListQueryResponseV1Schema } from './response.js';

describe('SessionListQueryResponseV1Schema', () => {
  const RESPONSE = {
    sessions: [],
    nextCursor: null,
    hasNext: false,
    attentionNextCursor: null,
    attentionHasNext: false,
  } as const;

  it('requires both independent continuation families', () => {
    expect(SessionListQueryResponseV1Schema.parse(RESPONSE)).toEqual(RESPONSE);
    const { attentionNextCursor: _attentionNextCursor, ...missingAttentionCursor } = RESPONSE;
    expect(SessionListQueryResponseV1Schema.safeParse(missingAttentionCursor).success).toBe(false);
  });

  it('rejects unknown response-envelope fields', () => {
    expect(SessionListQueryResponseV1Schema.safeParse({ ...RESPONSE, queryVersion: 1 }).success).toBe(false);
  });

  it('requires the current access and viewer projections on every query row', () => {
    const session = {
      id: 'shared-session',
      seq: 1,
      createdAt: 1,
      updatedAt: 2,
      active: true,
      activeAt: 2,
      metadata: 'shared-envelope',
      metadataVersion: 1,
      metadataLayoutVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataEncryptionKey: null,
      share: { accessLevel: 'view', canApprovePermissions: false },
      effectiveAccess: {
        v: 1,
        level: 'view',
        sources: [{ kind: 'direct', shareId: 'share-1' }],
        capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view' }),
      },
      viewer: {
        readState: { state: 'not_started' },
        relevance: { relevant: true, reasons: ['shared_directly_with_me'] },
        attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
        follow: { follows: false, notificationLevel: null },
        notification: { level: 'none', source: 'none' },
      },
      responsibleAccountId: null,
      responsibleAccount: null,
    } as const;
    const responseWith = (sessions: readonly unknown[]) => ({ ...RESPONSE, sessions });

    expect(SessionListQueryResponseV1Schema.safeParse(responseWith([session])).success).toBe(true);

    const { effectiveAccess: _effectiveAccess, ...withoutEffectiveAccess } = session;
    expect(V2SessionRecordSchema.safeParse(withoutEffectiveAccess).success).toBe(true);
    expect(SessionListQueryResponseV1Schema.safeParse(responseWith([withoutEffectiveAccess])).success).toBe(false);

    const { viewer: _viewer, ...withoutViewer } = session;
    expect(V2SessionRecordSchema.safeParse(withoutViewer).success).toBe(true);
    expect(SessionListQueryResponseV1Schema.safeParse(responseWith([withoutViewer])).success).toBe(false);

    const {
      responsibleAccountId: _responsibleAccountId,
      responsibleAccount: _responsibleAccount,
      ...withoutResponsibility
    } = session;
    expect(V2SessionRecordSchema.safeParse(withoutResponsibility).success).toBe(true);
    expect(SessionListQueryResponseV1Schema.safeParse(responseWith([withoutResponsibility])).success).toBe(false);
  });
});
