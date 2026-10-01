import { describe, expect, it } from 'vitest';
import { openAutomationTemplateStoredV1 } from './automationTemplateStoredV1.js';
import { AUTOMATION_TEMPLATE_V02_PLAIN } from './automationTemplateV02.testFixtures.js';
import {
  convertLegacyAutomationRecipeToInlineWorkflowV1,
} from './automationLegacyWorkflowV1.js';

describe('canonical legacy Automation inline conversion', () => {
  it('keeps retained 0.2 prompt placeholders literal during Workflow conversion', () => {
    const opened = openAutomationTemplateStoredV1({ templateCiphertext: AUTOMATION_TEMPLATE_V02_PLAIN, accountMode: 'plain' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const prompt = 'Review {{input}} and preserve unmatched }} literally';
    expect(convertLegacyAutomationRecipeToInlineWorkflowV1({ machineId: 'machine-1', legacyTemplate: {
      targetType: 'new_session', template: { ...opened.template, prompt },
    } })).toMatchObject({ kind: 'available', definition: { blocks: [{ document: { text: prompt } }] } });
  });
  it('retains explicit automatic model selection rather than reviving a stale legacy model', () => {
    const opened = openAutomationTemplateStoredV1({ templateCiphertext: AUTOMATION_TEMPLATE_V02_PLAIN, accountMode: 'plain' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(convertLegacyAutomationRecipeToInlineWorkflowV1({ machineId: 'machine-1', legacyTemplate: {
      targetType: 'new_session', template: { ...opened.template, modelSelection: null, modelId: 'stale-model', modelUpdatedAt: 10 },
    } })).toMatchObject({ kind: 'available', definition: { defaults: { modelSelection: null } } });
  });
  it('refuses settings the portable definition cannot carry instead of dropping them', () => {
    const opened = openAutomationTemplateStoredV1({ templateCiphertext: AUTOMATION_TEMPLATE_V02_PLAIN, accountMode: 'plain' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(convertLegacyAutomationRecipeToInlineWorkflowV1({ machineId: 'machine-1', legacyTemplate: {
      targetType: 'new_session', template: { ...opened.template, environmentVariables: { RELEASE_TOKEN: 'fixture' } },
    } })).toEqual({ kind: 'unavailable', code: 'legacy_conversion_unsupported', reason: 'spawn_unrepresentable' });

  });
  it('maps the real 0.2 plain writer bytes to a validated inline target', () => {
    const opened = openAutomationTemplateStoredV1({ templateCiphertext: AUTOMATION_TEMPLATE_V02_PLAIN, accountMode: 'plain' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(convertLegacyAutomationRecipeToInlineWorkflowV1({ machineId: 'machine-1', legacyTemplate: {
      targetType: 'new_session', template: opened.template,
    } })).toMatchObject({ kind: 'available', executionTarget: { kind: 'session' },
      project: { machineId: 'machine-1', directory: '/repo' }, definition: { version: 1,
        blocks: [{ document: { text: 'Review the release' } }] } });
  });
});
