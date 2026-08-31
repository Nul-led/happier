import { z } from 'zod';

import {
  defineProtocolNumber,
  defineProtocolTrimmedNonemptyString,
} from '../plugins/actions/protocolComposableSchema.js';
import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';

/** Stable identity of one mutable automatic trigger. */
export const AutomationTriggerIdProtocolSchema = defineProtocolTrimmedNonemptyString(191);
export const AutomationTriggerIdSchema = asProtocolZod(AutomationTriggerIdProtocolSchema)
  .brand<'AutomationTriggerId'>();
export type AutomationTriggerId = z.infer<typeof AutomationTriggerIdSchema>;

/** Independent currentness witness for one trigger definition. */
export const AutomationTriggerRevisionProtocolSchema = defineProtocolNumber({
  integer: true,
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
});
export const AutomationTriggerRevisionSchema = asProtocolZod(
  AutomationTriggerRevisionProtocolSchema,
);
export type AutomationTriggerRevision = z.infer<typeof AutomationTriggerRevisionSchema>;

export const AutomationTriggerKindSchema = z.enum([
  'schedule',
  'pluginEvent',
  'sessionLifecycle',
]);
export type AutomationTriggerKind = z.infer<typeof AutomationTriggerKindSchema>;
