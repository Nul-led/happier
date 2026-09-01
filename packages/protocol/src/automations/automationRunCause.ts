import { z } from 'zod';

import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import {
  AutomationOccurrenceKeyV1Schema,
  type AutomationOccurrenceKeyV1,
  AutomationOccurredAtV1Schema,
  type AutomationOccurredAtV1,
  AutomationSourceSelectorIdV1Schema,
  type AutomationSourceSelectorIdV1,
} from './automationOccurrenceV1.js';
import {
  PluginContributionIdentityV1Schema,
  type PluginContributionIdentityV1,
} from '../plugins/contributionIdentity.js';
import {
  AutomationTriggerIdSchema,
  AutomationTriggerRevisionSchema,
  type AutomationTriggerId,
  type AutomationTriggerRevision,
} from './automationTriggerIdentity.js';
import {
  AutomationSessionLifecycleEventSchema,
  AutomationSessionLifecyclePolicySnapshotSchema,
  AutomationSessionLifecycleRequestKindSchema,
  type AutomationSessionLifecycleEvent,
  type AutomationSessionLifecyclePolicySnapshot,
  type AutomationSessionLifecycleRequestKind,
} from './automationSessionLifecycle.js';

export {
  AutomationTriggerIdSchema,
  AutomationTriggerKindSchema,
  AutomationTriggerRevisionSchema,
  type AutomationTriggerId,
  type AutomationTriggerKind,
  type AutomationTriggerRevision,
} from './automationTriggerIdentity.js';

const IDENTIFIER_SCHEMA = z.string().trim().min(1).max(191);

const AutomationScheduleRunCauseSchema = z.object({
  kind: z.literal('trigger'),
  triggerId: AutomationTriggerIdSchema,
  triggerRevision: AutomationTriggerRevisionSchema,
  triggerKind: z.literal('schedule'),
  occurrenceKey: AutomationOccurrenceKeyV1Schema,
  occurredAt: AutomationOccurredAtV1Schema,
  evidence: z.object({
    scheduledFor: AutomationOccurredAtV1Schema,
  }).strict(),
}).strict();

const AutomationPluginEventRunCauseSchema = z.object({
  kind: z.literal('trigger'),
  triggerId: AutomationTriggerIdSchema,
  triggerRevision: AutomationTriggerRevisionSchema,
  triggerKind: z.literal('pluginEvent'),
  occurrenceKey: AutomationOccurrenceKeyV1Schema,
  occurredAt: AutomationOccurredAtV1Schema,
  evidence: z.object({
    eventRef: asProtocolZod(PluginContributionIdentityV1Schema),
    sourceSelectorId: AutomationSourceSelectorIdV1Schema,
  }).strict(),
}).strict();

const AUTOMATION_SESSION_LIFECYCLE_RUN_CAUSE_SHAPE = {
  kind: z.literal('trigger'),
  triggerId: AutomationTriggerIdSchema,
  triggerRevision: AutomationTriggerRevisionSchema,
  triggerKind: z.literal('sessionLifecycle'),
  occurrenceKey: AutomationOccurrenceKeyV1Schema,
  occurredAt: AutomationOccurredAtV1Schema,
} as const;

const AutomationSessionLifecycleRunCauseSchema = z.object({
  ...AUTOMATION_SESSION_LIFECYCLE_RUN_CAUSE_SHAPE,
  evidence: z.discriminatedUnion('event', [
    z.object({
      event: AutomationSessionLifecycleEventSchema.exclude(['userActionRequired']),
      sourceSessionId: IDENTIFIER_SCHEMA,
      sourceTurnId: IDENTIFIER_SCHEMA,
      policy: AutomationSessionLifecyclePolicySnapshotSchema,
    }).strict(),
    z.object({
      event: z.literal('userActionRequired'),
      sourceSessionId: IDENTIFIER_SCHEMA,
      sourceTurnId: IDENTIFIER_SCHEMA,
      requestId: IDENTIFIER_SCHEMA,
      requestKind: AutomationSessionLifecycleRequestKindSchema,
      policy: AutomationSessionLifecyclePolicySnapshotSchema,
    }).strict(),
  ]),
}).strict();

const AutomationManualRunCauseSchema = z.object({
  kind: z.literal('manual'),
  invokedAt: AutomationOccurredAtV1Schema,
}).strict();

const AutomationConversationRunCauseSchema = z.object({
  kind: z.literal('conversation'),
  occurrenceKey: AutomationOccurrenceKeyV1Schema,
  occurredAt: AutomationOccurredAtV1Schema,
}).strict();

/**
 * Immutable, bounded Run provenance. This is the sole current cause owner;
 * private payload bytes remain in the existing trigger-evidence envelope.
 *
 * Declared structurally instead of `z.infer` so downstream declaration-only
 * consumers (the public SDK projection re-exports this union through the
 * narrow `./automations/run-cause` leaf) never carry a validator-bearing
 * declaration. The `satisfies` lockstep below fails compilation if the parser
 * and this declaration drift on any field, bound, or literal.
 */
export type AutomationRunCause = Readonly<
  | {
    kind: 'trigger';
    triggerId: AutomationTriggerId;
    triggerRevision: AutomationTriggerRevision;
    triggerKind: 'schedule';
    occurrenceKey: AutomationOccurrenceKeyV1;
    occurredAt: AutomationOccurredAtV1;
    evidence: Readonly<{ scheduledFor: AutomationOccurredAtV1 }>;
  }
  | {
    kind: 'trigger';
    triggerId: AutomationTriggerId;
    triggerRevision: AutomationTriggerRevision;
    triggerKind: 'pluginEvent';
    occurrenceKey: AutomationOccurrenceKeyV1;
    occurredAt: AutomationOccurredAtV1;
    evidence: Readonly<{
      eventRef: PluginContributionIdentityV1;
      sourceSelectorId: AutomationSourceSelectorIdV1;
    }>;
  }
  | {
    kind: 'trigger';
    triggerId: AutomationTriggerId;
    triggerRevision: AutomationTriggerRevision;
    triggerKind: 'sessionLifecycle';
    occurrenceKey: AutomationOccurrenceKeyV1;
    occurredAt: AutomationOccurredAtV1;
    evidence: Readonly<{
      event: Exclude<AutomationSessionLifecycleEvent, 'userActionRequired'>;
      sourceSessionId: string;
      sourceTurnId: string;
      policy: AutomationSessionLifecyclePolicySnapshot;
    }> | Readonly<{
      event: 'userActionRequired';
      sourceSessionId: string;
      sourceTurnId: string;
      requestId: string;
      requestKind: AutomationSessionLifecycleRequestKind;
      policy: AutomationSessionLifecyclePolicySnapshot;
    }>;
  }
  | { kind: 'manual'; invokedAt: AutomationOccurredAtV1 }
  | {
    kind: 'conversation';
    occurrenceKey: AutomationOccurrenceKeyV1;
    occurredAt: AutomationOccurredAtV1;
  }
>;

export const AutomationRunCauseSchema = z.union([
  AutomationScheduleRunCauseSchema,
  AutomationPluginEventRunCauseSchema,
  AutomationSessionLifecycleRunCauseSchema,
  AutomationManualRunCauseSchema,
  AutomationConversationRunCauseSchema,
]) satisfies z.ZodType<AutomationRunCause>;
