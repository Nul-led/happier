import { AgentExecutionTargetV1Schema } from '../agents/executionTargetV1.js';
import { buildBackendTargetKeyV2, parseBackendTargetKeyV2 } from '../backends/targets/backendTargetRefV2.js';
import { WorkflowStepExecutionSelectionSchema, type WorkflowDefinitionV1 } from '../workflows/workflowV1.js';
import { decodeAutomationTemplate, type AutomationTemplatePayloadV1 } from './automationTemplatePayloadV1.js';
import type { WorkflowRunExecutionTargetV1 } from '../workflows/workflowDefinitionV1.js';
import { WorkflowProjectTargetV1Schema, type WorkflowProjectTargetV1 } from '../workflows/workflowWorkspaceV1.js';
import { validateWorkflowDefinition } from '../workflows/workflowValidationV1.js';

export const LEGACY_AUTOMATION_WORKFLOW_STEP_ID = 'step-1';

type LegacyStoredTemplate = Readonly<{ template: AutomationTemplatePayloadV1; targetType: 'new_session' | 'existing_session' }>;

function storedTemplateSelection(params: LegacyStoredTemplate, machineId: string | null) {
  const template = decodeAutomationTemplate(JSON.stringify(params.template));
  if (!template) return null;
  const backend = template.backendTarget ?? (template.agent ? { kind: 'backend' as const, backendId: template.agent } : null);
  const agent = backend ? AgentExecutionTargetV1Schema.safeParse(parseBackendTargetKeyV2(buildBackendTargetKeyV2(backend))) : null;
  const { directory: _directory, prompt: _prompt, displayText: _displayText, agent: _agent,
    agentTarget: _agentTarget, backendTarget: _backend, executionTarget: _executionTarget,
    organizationPlacement: _placement, checkoutCreationDraft: _checkout, environmentVariables: _environment,
    resume: _resume, existingSessionId, sessionEncryptionMode: _sessionMode, sessionEncryptionKeyBase64: _key,
    sessionEncryptionVariant: _variant, permissionModeUpdatedAt: _permissionTime,
    modelId, modelUpdatedAt, agentModeId, ...selection } = template;
  const modelSelection = template.modelSelection !== undefined ? template.modelSelection : (modelId && backend ? {
    v: 1 as const, ref: { agentTargetKey: buildBackendTargetKeyV2(backend), providerConnectionId: null, modelId }, updatedAt: modelUpdatedAt ?? 0,
  } : template.modelSelection);
  return WorkflowStepExecutionSelectionSchema.safeParse({ ...selection,
    ...(agent?.success ? { agentTarget: agent.data } : {}),
    ...(modelSelection === undefined ? {} : { modelSelection }),
    ...(agentModeId === undefined ? {} : { acpSessionModeId: agentModeId }),
    conversation: params.targetType === 'existing_session'
      ? { kind: 'existing_session', sessionId: existingSessionId, machineId } : { kind: 'fresh' },
  });
}

/** A presentation-only view of retained 0.2 content, never conversion/admission authority. */
export function projectLegacyAutomationTemplateToWorkflowDefinitionV1(params: LegacyStoredTemplate & Readonly<{ machineId: string | null }>): WorkflowDefinitionV1 {
  const selection = storedTemplateSelection(params, params.machineId);
  return { version: 1, inputs: [], defaults: selection?.success ? selection.data : {
    ...(params.targetType === 'existing_session' && params.machineId !== null ? { conversation: { kind: 'existing_session' as const,
      sessionId: params.template.existingSessionId!, machineId: params.machineId } } : {}),
  }, blocks: [{ kind: 'step', id: LEGACY_AUTOMATION_WORKFLOW_STEP_ID,
    document: { text: params.template.prompt ?? '', references: [], attachments: [] }, input: [], result: { kind: 'text' } }] };
}

function convertStoredTemplate(params: LegacyStoredTemplate, machineId: string | null): LegacyAutomationWorkflowConversionResultV1 {
  const refuse = (reason: LegacyAutomationWorkflowConversionReasonV1): LegacyAutomationWorkflowConversionResultV1 => (
    { kind: 'unavailable', code: 'legacy_conversion_unsupported', reason }
  );
  if (machineId === null) return refuse('workspace_unrepresentable');
  // Existing Session settings are resolved at execution, not from a stale template snapshot.
  // Conversion needs the Session owner's actual Agent/placement witness, which this legacy boundary lacks.
  if (params.targetType === 'existing_session' || params.template.resume) return refuse('conversation_unrepresentable');
  if (params.template.checkoutCreationDraft) return refuse('workspace_unrepresentable');
  if (params.template.environmentVariables || params.template.sessionEncryptionKeyBase64
    || params.template.sessionEncryptionMode || params.template.sessionEncryptionVariant
    || params.template.executionTarget || params.template.agentTarget || params.template.organizationPlacement) return refuse('spawn_unrepresentable');
  const selection = storedTemplateSelection(params, machineId);
  if (!selection?.success || !selection.data.agentTarget) return refuse(params.template.runtimeDescriptorV1
    ? 'runtime_descriptor_unsupported' : 'settings_unrepresentable');
  const definition = projectLegacyAutomationTemplateToWorkflowDefinitionV1({ ...params, machineId });
  const validated = validateWorkflowDefinition(definition);
  const project = WorkflowProjectTargetV1Schema.safeParse({ machineId, directory: params.template.directory });
  if (!validated.valid || !validated.normalizedDefinition) return refuse('settings_unrepresentable');
  if (!project.success) return refuse('workspace_unrepresentable');
  return { kind: 'available', definition: validated.normalizedDefinition, project: project.data, executionTarget: { kind: 'session' } };
}

import type { LegacyAutomationWorkflowConversionReasonV1 } from './automationLegacyWorkflowConversionReasonV1.js';
export { LegacyAutomationWorkflowConversionReasonV1Schema } from './automationLegacyWorkflowConversionReasonV1.js';
export type { LegacyAutomationWorkflowConversionReasonV1 } from './automationLegacyWorkflowConversionReasonV1.js';

export type LegacyAutomationWorkflowConversionResultV1 =
  | Readonly<{ kind: 'available'; definition: WorkflowDefinitionV1;
      project: WorkflowProjectTargetV1; executionTarget: WorkflowRunExecutionTargetV1 }>
  | Readonly<{ kind: 'unavailable'; code: 'legacy_conversion_unsupported'; reason: LegacyAutomationWorkflowConversionReasonV1 }>;

/** Maps content only. The Automation owner performs the one revision-CAS write. */
export function convertLegacyAutomationRecipeToInlineWorkflowV1(params: Readonly<{
  legacyTemplate: LegacyStoredTemplate;
  machineId: string | null;
  channelReplyHandoff?: boolean;
}>): LegacyAutomationWorkflowConversionResultV1 {
  if (params.channelReplyHandoff) return { kind: 'unavailable', code: 'legacy_conversion_unsupported', reason: 'channel_reply_handoff' };
  return convertStoredTemplate(params.legacyTemplate, params.machineId);
}
