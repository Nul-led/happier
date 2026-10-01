import { describe, expect, it } from 'vitest';

import {
  buildOpenCodePreflightModelsFromV2ApiOutput,
  buildOpenCodePreflightModelsFromVerboseOutput,
  OPENCODE_PREFLIGHT_SESSION_CONTROLS,
} from './models.js';

describe('OpenCode preflight model parsing', () => {
  it('distinguishes genuine empty or fully ineligible catalogs from malformed observations', () => {
    expect(buildOpenCodePreflightModelsFromV2ApiOutput(JSON.stringify({ data: [] }))).toEqual([]);
    expect(buildOpenCodePreflightModelsFromV2ApiOutput(JSON.stringify({ data: [{}] }))).toBeNull();
    expect(buildOpenCodePreflightModelsFromV2ApiOutput(JSON.stringify({ data: [{
      providerID: 'example', id: 'image', capabilities: { input: ['image'] },
    }] }))).toEqual([]);
    expect(buildOpenCodePreflightModelsFromVerboseOutput('')).toEqual([]);
  });

  it('retains released V2 model API metadata and retains supported text models without tools', () => {
    expect(buildOpenCodePreflightModelsFromV2ApiOutput(JSON.stringify({
      location: { directory: '/workspace' },
      data: [{
        id: 'gpt-5.4',
        providerID: 'openai',
        name: 'GPT-5.4',
        family: 'gpt-5.4',
        status: 'active',
        capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
        variants: [{ id: 'low' }, { id: 'high' }],
        limit: { context: 400000, output: 128000 },
      }, {
        id: 'no-tools',
        providerID: 'openai',
        name: 'No Tools',
        status: 'active',
        capabilities: { tools: false, input: ['text'] },
        variants: [],
        limit: { context: 100000 },
      }],
    }))).toEqual([{
      id: 'openai/gpt-5.4',
      name: 'GPT-5.4',
      description: 'gpt-5.4',
      contextWindowTokens: 400000,
      modelOptions: [{
        id: 'reasoning_effort',
        name: 'Thinking',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      }],
    }, {
      id: 'openai/no-tools', name: 'No Tools', description: 'openai', contextWindowTokens: 100000,
    }]);
  });

  it('retains provider-native model metadata from verbose output', () => {
    expect(buildOpenCodePreflightModelsFromVerboseOutput([
      'openai/gpt-5.4',
      '{',
      '  "id": "gpt-5.4",',
      '  "name": "GPT-5.4",',
      '  "providerID": "openai",',
      '  "status": "active",',
      '  "capabilities": { "toolcall": true, "input": { "text": true }, "reasoning": true },',
      '  "variants": { "medium": {}, "high": {} }',
      '}',
    ].join('\n'))).toEqual([
      expect.objectContaining({ id: 'openai/gpt-5.4', name: 'GPT-5.4' }),
    ]);
  });

  it('retains nested OpenRouter model ids from verbose output', () => {
    const verboseOutput = [
      'opencode/gpt-5',
      '{"id":"gpt-5","providerID":"opencode","name":"GPT-5","status":"active","capabilities":{"toolcall":true}}',
      'openrouter/deepseek/deepseek-v4-flash-0731',
      '{"id":"deepseek/deepseek-v4-flash-0731","providerID":"openrouter","name":"DeepSeek V4 Flash","status":"active","capabilities":{"toolcall":true}}',
      'openrouter/~anthropic/claude-opus-latest',
      '{"id":"~anthropic/claude-opus-latest","providerID":"openrouter","name":"Claude Opus Latest","status":"active","capabilities":{"toolcall":true}}',
    ].join('\n');

    expect(buildOpenCodePreflightModelsFromVerboseOutput(verboseOutput)).toEqual([
      { id: 'opencode/gpt-5', name: 'GPT-5', description: 'opencode' },
      {
        id: 'openrouter/deepseek/deepseek-v4-flash-0731',
        name: 'DeepSeek V4 Flash',
        description: 'openrouter',
      },
      {
        id: 'openrouter/~anthropic/claude-opus-latest',
        name: 'Claude Opus Latest',
        description: 'openrouter',
      },
    ]);

  });

  it('rejects a partial verbose inventory when a header disagrees with its record identity', () => {
    expect(buildOpenCodePreflightModelsFromVerboseOutput([
      'opencode/gpt-5',
      '{"id":"gpt-5","providerID":"opencode","name":"GPT-5","status":"active","capabilities":{"toolcall":true}}',
      'openrouter/incorrect/model-id',
      '{"id":"deepseek/deepseek-v4-flash-0731","providerID":"openrouter","name":"DeepSeek V4 Flash","status":"active","capabilities":{"toolcall":true}}',
    ].join('\n'))).toBeNull();
  });

  it('declares V2 API then V1 verbose commands on the settings-selected executable', () => {
    const models = OPENCODE_PREFLIGHT_SESSION_CONTROLS.models;
    expect(models?.command).toEqual({
      toolId: 'opencode-cli',
      args: ['api', 'get', '/api/model', '--standalone', '--param', 'location[directory]=.'],
    });
    expect(models?.fallback?.command).toEqual({ toolId: 'opencode-cli', args: ['models', '--verbose'] });
    expect(models?.commandToolIds).toEqual([
      'opencode-cli',
      'opencode-cli-stable',
      'opencode-cli-v2',
    ]);
    expect(models?.resolveCommandToolId?.({
      accountSettings: { opencodeCliGeneration: 'v2' },
      environment: {},
    })).toBe('opencode-cli-v2');
    expect(OPENCODE_PREFLIGHT_SESSION_CONTROLS).not.toHaveProperty('failureCacheStrategy');
    expect(OPENCODE_PREFLIGHT_SESSION_CONTROLS).not.toHaveProperty('connectedServiceAuth');
  });

  it('lets the host select the V1 fallback after an unparsable V2 result', () => {
    const models = OPENCODE_PREFLIGHT_SESSION_CONTROLS.models;
    expect(models?.parseOutput?.({
      ok: true,
      stdout: 'OpenCode help output',
      stderr: '',
      exitCode: 0,
    })).toBeNull();
    expect(models?.fallback?.parseOutput?.({
      ok: true,
      stdout: [
        'openai/gpt-5.4',
        '{"id":"gpt-5.4","providerID":"openai","name":"GPT-5.4","status":"active","capabilities":{"toolcall":true}}',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    })).toEqual([
      { id: 'openai/gpt-5.4', name: 'GPT-5.4', description: 'openai' },
    ]);
  });
});
