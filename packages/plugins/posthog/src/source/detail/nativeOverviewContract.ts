import { defineProtocolLiteral, defineProtocolObject, defineProtocolUnion } from '@happier-dev/plugin-sdk/protocol';
import {
    TriageGetResultV1Schema,
    TriageSourceFailureV1Schema,
} from '@happier-dev/triage-protocol/v1';

/** Native-only facts from the same CRUD-first read used by aggregate get. */
export const PosthogNativeOverviewResultV1Schema = defineProtocolObject({
    observation: TriageGetResultV1Schema,
    severity: defineProtocolUnion([
        defineProtocolLiteral('low'), defineProtocolLiteral('medium'),
        defineProtocolLiteral('high'), defineProtocolLiteral('critical'),
    ]).optional(),
    enrichmentFailure: TriageSourceFailureV1Schema.optional(),
}, { policy: 'closed' });

export type PosthogNativeOverviewResultV1 = ReturnType<typeof PosthogNativeOverviewResultV1Schema.parse>;
