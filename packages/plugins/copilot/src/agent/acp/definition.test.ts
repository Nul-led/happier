import { describe, expect, it } from 'vitest';
import type { AgentAcpRuntimeDefinition } from '@happier-dev/plugin-sdk/agents/runtime';

import { COPILOT_ACP_RUNTIME_DEFINITION } from './definition.js';

describe('Copilot ACP backend definition', () => {
  it('replaces stale effort options with the selected model response and rejects a different selected model', () => {
    const definition: AgentAcpRuntimeDefinition = COPILOT_ACP_RUNTIME_DEFINITION;
    const targetModel = { id: 'model-b', name: 'B', modelOptions: [{ id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }] }] };
    const response = { configOptions: [
      { id: 'model', name: 'Model', type: 'select', currentValue: 'model-b', options: [{ value: 'model-b', name: 'B' }] },
      { id: 'reasoning_effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ group: 'available', name: 'Available', options: [{ value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] }] },
    ] };
    const project = definition.models?.projectSetModelResponse;
    expect(project?.({ response, targetModel, requestedModelId: 'model-b', requestMeta: null })).toMatchObject({
      id: 'model-b', modelOptions: [{ id: 'reasoning_effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] }],
    });
    expect(project?.({ response, targetModel, requestedModelId: 'model-a', requestMeta: null })).toBeNull();
    expect(project?.({ response: { configOptions: response.configOptions.slice(0, 1) }, targetModel, requestedModelId: 'model-b', requestMeta: null })?.modelOptions).toBeUndefined();
  });

  it('owns the static ACP policy consumed by the native runtime leaf', () => {
    expect(COPILOT_ACP_RUNTIME_DEFINITION).toMatchObject({
      modelConfigOptionId: 'model',
      toolNameInference: {
        shellBridgeHint: true,
        hintInputFields: ['tool_name', 'toolName', 'name', 'title', 'description'],
        investigationToolIdPatterns: ['task'],
        investigationToolKinds: ['task'],
      },
      stderrRules: expect.any(Object),
      mcp: { policy: 'pass_through' },
    });
    expect(COPILOT_ACP_RUNTIME_DEFINITION.stderrRules.statusErrors)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining('Authentication error') })]));
    expect(COPILOT_ACP_RUNTIME_DEFINITION.stderrRules.authenticationErrorDetail)
      .toBe('Authentication error. Run `copilot login` to authenticate with GitHub.');
  });
});
