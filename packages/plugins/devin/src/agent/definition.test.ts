import { describe, expect, it } from 'vitest';

import { AGENT_DEFINITION } from './definition.js';

describe('Devin agent definition', () => {
  it('owns Devin resume, control, tools, modes, and model facts as serializable data', () => {
    expect(JSON.parse(JSON.stringify(AGENT_DEFINITION))).toEqual(AGENT_DEFINITION);
    expect(AGENT_DEFINITION).toMatchObject({
      id: 'devin',
      core: {
        id: 'devin',
        cliSubcommand: 'devin',
        detectKey: 'devin',
        flavorAliases: ['devin-cli'],
        resume: { vendorResume: 'supported', vendorResumeIdField: 'devinSessionId' },
        sessionStorage: { direct: true, persisted: true },
        sessionCapabilities: {
          sessionListing: 'unsupported',
          sessionFork: { conversation: 'unsupported', fromMessage: 'unsupported' },
          sessionRollback: { conversation: 'unsupported' },
        },
        handoff: { vendorStateTransfer: 'unsupported' },
        localControl: {
          supported: true,
          topology: 'exclusive',
          attachStrategy: 'terminal_host',
        },
        runtimeInput: {
          inFlightSteerSupported: false,
          terminalPromptInjectionSupported: false,
        },
        tools: { delivery: 'native_mcp', support: 'supported' },
      },
      sessionModeDescriptor: {
        source: 'acp',
        semantics: 'agent-modes',
        runtimeSwitch: 'acp-setSessionMode',
      },
      sessionModesKind: 'acpAgentModes',
      modelConfig: {
        supportsSelection: true,
        supportsFreeform: false,
        nonAcpApplyScope: 'next_prompt',
        acpApplyBehavior: 'set_model',
        acpModelConfigOptionId: 'model',
        dynamicProbe: 'auto',
      },
    });
  });
});
