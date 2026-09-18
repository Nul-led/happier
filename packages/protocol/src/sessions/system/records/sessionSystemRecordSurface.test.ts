import {
  LegacyHostSessionSystemRecordLatestQuerySchema,
  LegacyHostSessionSystemRecordListQuerySchema,
  LegacyHostSessionSystemRecordLookupQuerySchema,
  LegacyHostSessionSystemRecordPageResponseSchema,
  LegacyHostSessionSystemRecordUpsertRequestSchema,
  SessionSystemRecordStoredSchema,
} from './sessionSystemRecordRoutes.js';
import { FeatureGatesSchema } from '../../../features/payload/featureGatesSchema.js';
import { describe, expect, it } from 'vitest';
import { getSessionSystemRecordKindPolicy, getSessionSystemRecordPayloadSchema } from './sessionSystemRecordCatalog.js';

describe('surface host records', () => {
  it('keeps every surface shape out of predecessor routes and serializers', () => {
    const surfaceRecord = {
      id: 'surface-layout',
      sessionId: 'session-1',
      namespace: 'surface',
      kind: 'layout.v1',
      localId: 'layout',
      content: { t: 'plain', v: { v: 1, tabs: [] } },
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    };

    expect(LegacyHostSessionSystemRecordLookupQuerySchema.safeParse({ namespace: 'surface', localId: 'layout' }).success).toBe(false);
    expect(LegacyHostSessionSystemRecordListQuerySchema.safeParse({ namespace: 'surface' }).success).toBe(false);
    expect(LegacyHostSessionSystemRecordLatestQuerySchema.safeParse({ namespace: 'surface', kind: 'layout.v1' }).success).toBe(false);
    expect(LegacyHostSessionSystemRecordUpsertRequestSchema.safeParse(surfaceRecord).success).toBe(false);
    expect(LegacyHostSessionSystemRecordPageResponseSchema.safeParse({ records: [surfaceRecord], nextCursor: null, hasNext: false }).success).toBe(false);
  });

  it('requires strict V1 revision identity for Board rows and preserves the Board feature bit', () => {
    const stored = {
      id: 'surface-layout',
      address: { owner: 'host', namespace: 'surface', kind: 'layout.v1', localId: 'layout' },
      content: { t: 'plain', v: { v: 1, tabs: [] } },
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    };
    expect(SessionSystemRecordStoredSchema.safeParse(stored).success).toBe(false);
    expect(SessionSystemRecordStoredSchema.safeParse({
      ...stored,
      revision: 'ssr1.AAAACHN5c3JlY18xAAAAAQ',
    }).success).toBe(true);
    expect(FeatureGatesSchema.parse({ sessions: { enabled: true, board: { enabled: true } } }).sessions).toHaveProperty('board.enabled', true);
  });
  it('shares Board records under the Session owner and disallows generic mutation', () => {
    for (const kind of ['item.v1', 'layout.v1']) {
      expect(getSessionSystemRecordKindPolicy('surface', kind)).toMatchObject({
        accountScope: 'session-owner', read: 'visible', write: 'unavailable', delete: 'unavailable',
      });
    }
    expect(getSessionSystemRecordPayloadSchema('surface', 'layout.v1')?.safeParse({ v: 1, tabs: [] }).success).toBe(true);
    expect(getSessionSystemRecordPayloadSchema('surface', 'item.v1')?.safeParse({ v: 1 }).success).toBe(false);
  });
});
