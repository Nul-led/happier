import { z } from 'zod';
import { WorkflowDefinitionV1Schema } from './workflowV1.js';
import { WorkflowDefinitionRefV1StringSchema, parseWorkflowDefinitionRefV1, formatWorkflowDefinitionRefV1 } from './workflowDefinitionRefV1.js';
import type { PluginWorkflowContributionV1 } from '../plugins/contributions/workflows.js';

/** Current read-only plugin descriptor, projected by the platform's serving occurrence. */
export const WorkflowPluginSourceV1Schema = z.object({
  workflow: WorkflowDefinitionRefV1StringSchema,
  pluginId: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  definition: WorkflowDefinitionV1Schema,
}).strict().superRefine((source, context) => {
  const ref = parseWorkflowDefinitionRefV1(source.workflow);
  if (ref?.kind !== 'plugin' || ref.contribution.pluginId !== source.pluginId) {
    context.addIssue({ code: 'custom', path: ['workflow'], message: 'Workflow must belong to its declared plugin' });
  }
});
export type WorkflowPluginSourceV1 = z.infer<typeof WorkflowPluginSourceV1Schema>;
export type WorkflowPluginSourceReaderV1 = () => readonly WorkflowPluginSourceV1[] | Promise<readonly WorkflowPluginSourceV1[]>;

/** Registry and daemon-projection adapters share the same qualified source shape. */
export function projectWorkflowPluginSourceV1(input: Readonly<{
  pluginId: string; pluginVersion: string; definition: PluginWorkflowContributionV1;
}>): WorkflowPluginSourceV1 {
  const { id, ...definition } = input.definition;
  return { ...definition, pluginId: input.pluginId, version: input.pluginVersion,
    workflow: formatWorkflowDefinitionRefV1({ kind: 'plugin', contribution: { pluginId: input.pluginId, localId: id } }) };
}
