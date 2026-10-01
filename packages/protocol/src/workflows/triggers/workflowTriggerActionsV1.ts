import { z } from 'zod';
import { AutomationTriggerDefinitionInputSchema, AutomationTriggerDefinitionSchema } from '../../automations/automationTriggerDefinition.js';
import { AutomationTriggerIdSchema } from '../../automations/automationTriggerIdentity.js';
import { AutomationIdV1Schema } from '../../automations/automationIdV1.js';
import { AutomationTriggerDetailSchema } from '../../automations/automationTriggerProjectionV1.js';
import { asProtocolZod } from '../../plugins/actions/internalProtocolZodAdapter.js';
import { AutomationStoredWorkflowDefinitionV2Schema } from '../../automations/automationWorkflowRecipeV2.js';
import { WorkflowProjectTargetV1Schema } from '../workflowWorkspaceV1.js';
import { WorkflowDefinitionRefV1StringSchema } from '../workflowDefinitionRefV1.js';
import { TriggerTargetV1Schema } from './triggerTargetV1.js';
import { SessionIdSchema } from '../../sessions/idsV1.js';

const Revision = z.number().int().nonnegative().safe();
const ContextFields = AutomationStoredWorkflowDefinitionV2Schema.omit({ workspace: true, inlineDefinition: true, onComplete: true });
export const WorkflowTriggerListRequestV1Schema = z.union([
  z.object({ workflow: WorkflowDefinitionRefV1StringSchema }).strict(),
  z.object({ scope: z.literal('account_inline') }).strict(),
]);
export const WorkflowTriggerAddRequestV1Schema = z.object({
  workflow: WorkflowDefinitionRefV1StringSchema.optional(),
  target: TriggerTargetV1Schema.optional(),
  project: WorkflowProjectTargetV1Schema,
  ...ContextFields.partial().shape,
  trigger: AutomationTriggerDefinitionInputSchema,
}).strict().superRefine((value, ctx) => {
  if ((value.workflow === undefined) === (value.target === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['target'], message: 'Choose exactly one workflow or target' });
  }
  if (value.target?.kind === 'inline' && value.visibleTeamId !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['visibleTeamId'], message: 'Inline triggers are private' });
  }
});
export const WorkflowTriggerUpdateRequestV1Schema = z.object({
  automationId: asProtocolZod(AutomationIdV1Schema),
  triggerId: AutomationTriggerIdSchema.optional(),
  expectedRevision: Revision,
  patch: z.object({
    project: WorkflowProjectTargetV1Schema.optional(),
    ...ContextFields.partial().shape,
    target: TriggerTargetV1Schema.optional(),
    enabled: z.boolean().optional(),
    trigger: AutomationTriggerDefinitionSchema.optional(),
  }).strict().refine((patch) => Object.keys(patch).length > 0, 'A trigger update needs a change'),
}).strict().superRefine((value, ctx) => {
  if (value.patch.trigger !== undefined && value.triggerId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['triggerId'], message: 'A trigger definition update needs its trigger id' });
  }
  if (value.patch.target?.kind === 'inline' && value.patch.visibleTeamId !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['patch', 'visibleTeamId'], message: 'Inline triggers are private' });
  }
});
export const WorkflowTriggerRemoveRequestV1Schema = z.object({
  automationId: asProtocolZod(AutomationIdV1Schema), triggerId: AutomationTriggerIdSchema,
}).strict();
export const WorkflowTriggerSetV1Schema = z.object({
  automationId: asProtocolZod(AutomationIdV1Schema), revision: Revision, enabled: z.boolean(),
  health: z.enum(['available', 'source_unavailable']),
  legacy: z.object({ editable: z.literal(false), reason: z.literal('created_in_0_2'),
    placements: z.array(WorkflowProjectTargetV1Schema.pick({ machineId: true, directory: true })).optional(),
  }).strict().optional(),
  target: TriggerTargetV1Schema.optional(),
  project: WorkflowProjectTargetV1Schema.optional(),
  context: AutomationStoredWorkflowDefinitionV2Schema.optional(),
  triggers: z.array(AutomationTriggerDetailSchema),
}).strict();
export const WorkflowTriggerListResultV1Schema = z.object({ sets: z.array(WorkflowTriggerSetV1Schema) }).strict();
export const WorkflowTriggerWriteResultV1Schema = z.object({
  set: WorkflowTriggerSetV1Schema,
  triggerId: AutomationTriggerIdSchema.optional(),
  triggerRevision: Revision.optional(),
}).strict();
export type WorkflowTriggerListRequestV1 = z.infer<typeof WorkflowTriggerListRequestV1Schema>;
export type WorkflowTriggerAddRequestV1 = z.infer<typeof WorkflowTriggerAddRequestV1Schema>;
export type WorkflowTriggerUpdateRequestV1 = z.infer<typeof WorkflowTriggerUpdateRequestV1Schema>;
export type WorkflowTriggerRemoveRequestV1 = z.infer<typeof WorkflowTriggerRemoveRequestV1Schema>;
export type WorkflowTriggerSetV1 = z.infer<typeof WorkflowTriggerSetV1Schema>;

const SessionId = asProtocolZod(SessionIdSchema);
const SessionContextFields = AutomationStoredWorkflowDefinitionV2Schema.omit({ workspace: true, inlineDefinition: true });
export const SessionTriggerListRequestV1Schema = z.object({ sessionId: SessionId }).strict();
export const SessionTriggerAddRequestV1Schema = z.object({
  sessionId: SessionId, target: TriggerTargetV1Schema,
  ...SessionContextFields.partial().shape, trigger: AutomationTriggerDefinitionInputSchema,
}).strict().superRefine((value, ctx) => {
  if (value.target.kind === 'inline' && value.visibleTeamId !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['visibleTeamId'], message: 'Inline triggers are private' });
  }
});
export const SessionTriggerUpdateRequestV1Schema = z.object({
  sessionId: SessionId, triggerId: AutomationTriggerIdSchema, expectedRevision: Revision,
  patch: z.object({ ...SessionContextFields.partial().shape, target: TriggerTargetV1Schema.optional(),
    enabled: z.boolean().optional(), trigger: AutomationTriggerDefinitionSchema.optional() }).strict()
    .refine((patch) => Object.keys(patch).length > 0, 'A trigger update needs a change'),
}).strict();
export const SessionTriggerRemoveRequestV1Schema = z.object({ sessionId: SessionId, triggerId: AutomationTriggerIdSchema }).strict();
export const SessionPullRequestLinkV1Schema = z.object({
  provider: z.literal('github'), repository: z.string().min(1), number: z.number().int().positive().safe(),
}).strict();
export const SessionTriggerListResultV1Schema = WorkflowTriggerListResultV1Schema.extend({
  pullRequestLinks: z.array(SessionPullRequestLinkV1Schema),
}).strict();
export type SessionTriggerListRequestV1 = z.infer<typeof SessionTriggerListRequestV1Schema>;
export type SessionTriggerAddRequestV1 = z.infer<typeof SessionTriggerAddRequestV1Schema>;
export type SessionTriggerUpdateRequestV1 = z.infer<typeof SessionTriggerUpdateRequestV1Schema>;
export type SessionTriggerRemoveRequestV1 = z.infer<typeof SessionTriggerRemoveRequestV1Schema>;
