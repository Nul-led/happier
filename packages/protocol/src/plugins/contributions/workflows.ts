import { z } from 'zod';
import { WorkflowDefinitionV1Schema } from '../../workflows/workflowV1.js';
import { PluginContributionLocalIdSchema } from '../contributionIdentity.js';
import { asProtocolZod } from '../actions/internalProtocolZodAdapter.js';

/** Read-only plugin definitions use the same grammar as library workflows. */
export const PluginWorkflowContributionV1Schema = z.object({
  id: asProtocolZod(PluginContributionLocalIdSchema),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  definition: WorkflowDefinitionV1Schema,
}).strict();
export type PluginWorkflowContributionV1 = z.infer<typeof PluginWorkflowContributionV1Schema>;
