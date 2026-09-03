import type { PluginJsonSchema } from '@happier-dev/plugin-sdk/protocol';
import {
    defineProtocolLiteral,
    defineProtocolObject,
} from '@happier-dev/plugin-sdk/protocol';

import {
    ConversationBindingIdV1ProtocolSchema,
    ConversationCollectionRowRevisionV1ProtocolSchema,
} from '../identity.js';
import type { ConversationActionDeclarationV1 } from '../actionDeclarations.js';

/** One exact Account Collection row revision witness; see its Protocol owner. */
const collectionRowRevision = ConversationCollectionRowRevisionV1ProtocolSchema;

export const ConversationSessionProjectionBaselineAcceptInputV1Schema = defineProtocolObject({
    bindingId: ConversationBindingIdV1ProtocolSchema,
    expectedBindingRevision: collectionRowRevision,
    expectedFrontierRevision: collectionRowRevision,
}, { policy: 'closed' });
export type ConversationSessionProjectionBaselineAcceptInputV1 = ReturnType<
    typeof ConversationSessionProjectionBaselineAcceptInputV1Schema.parse
>;
export const ConversationSessionProjectionBaselineAcceptInputV1JsonSchema: PluginJsonSchema =
    ConversationSessionProjectionBaselineAcceptInputV1Schema.jsonSchema;

export const ConversationSessionProjectionBaselineAcceptResultV1Schema = defineProtocolObject({
    kind: defineProtocolLiteral('baselineAccepted'),
    bindingId: ConversationBindingIdV1ProtocolSchema,
    bindingRevision: collectionRowRevision,
    frontierRevision: collectionRowRevision,
}, { policy: 'closed' });
export type ConversationSessionProjectionBaselineAcceptResultV1 = ReturnType<
    typeof ConversationSessionProjectionBaselineAcceptResultV1Schema.parse
>;
export const ConversationSessionProjectionBaselineAcceptResultV1JsonSchema: PluginJsonSchema =
    ConversationSessionProjectionBaselineAcceptResultV1Schema.jsonSchema;

export const ConversationSessionProjectionBaselineAcceptManagementActionDeclarationV1:
    ConversationActionDeclarationV1 = Object.freeze({
    inputSchema: ConversationSessionProjectionBaselineAcceptInputV1JsonSchema,
    resultSchema: ConversationSessionProjectionBaselineAcceptResultV1JsonSchema,
});
