import { z } from 'zod';

import { SessionEffectiveAccessV1Schema } from '../access/sessionEffectiveAccessV1.js';
import { V2SessionRecordSchema } from '../control/contract.js';
import { SessionViewerProjectionV1Schema } from '../personal/viewer.js';

/**
 * Canonical record contract for current Session projections.
 *
 * The additive V2 record remains tolerant of responsibility omission for
 * released producers. A negotiated current operation is different: it must
 * carry the complete responsibility pair so omission cannot be mistaken for
 * an authoritative unassigned value.
 */
export const SessionCurrentProjectionRecordV1Schema = V2SessionRecordSchema.and(z.object({
  effectiveAccess: SessionEffectiveAccessV1Schema,
  responsibleAccountId: z.string().min(1).nullable(),
  responsibleAccount: V2SessionRecordSchema.shape.responsibleAccount.unwrap(),
}).passthrough());

export type SessionCurrentProjectionRecordV1 = Readonly<z.infer<typeof SessionCurrentProjectionRecordV1Schema>>;

/**
 * Closed V1 response envelope for filtered listing. Session rows retain the
 * established V2 projection policy; pagination authority stays explicit at
 * this boundary so consumers cannot lose either independent continuation.
 */
export const SessionListQueryResponseV1Schema = z.object({
  sessions: z.array(SessionCurrentProjectionRecordV1Schema.and(z.object({
    viewer: SessionViewerProjectionV1Schema,
  }).passthrough())),
  nextCursor: z.string().nullable(),
  hasNext: z.boolean(),
  attentionNextCursor: z.string().nullable(),
  attentionHasNext: z.boolean(),
}).strict();

export type SessionListQueryResponseV1 = Readonly<z.infer<typeof SessionListQueryResponseV1Schema>>;
