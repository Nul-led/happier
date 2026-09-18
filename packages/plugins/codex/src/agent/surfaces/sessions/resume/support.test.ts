import { describe, expect, it } from 'vitest';

import { supportsCodexProviderResume } from './support.js';
import { CodexLegacyMcpBackendModeUnsupportedError } from '../../../lifecycle/backendMode.js';

describe('Codex plugin resume support', () => {
  it('supports final app-server and ACP backend modes', () => {
    expect(supportsCodexProviderResume({
      agentRuntimeSelection: { codexBackendMode: 'appServer' },
    })).toBe(true);
    expect(supportsCodexProviderResume({
      agentRuntimeSelection: { codexBackendMode: 'acp' },
    })).toBe(true);
  });

  it('rejects retired MCP while preserving the released MCP-resume ACP alias', () => {
    expect(() => supportsCodexProviderResume({
      agentRuntimeSelection: { codexBackendMode: 'mcp' },
    })).toThrow(CodexLegacyMcpBackendModeUnsupportedError);
    expect(supportsCodexProviderResume({
      agentRuntimeSelection: { codexBackendMode: 'mcp_resume' },
    })).toBe(true);
  });

  it('accepts a canonical runtime descriptor without a Codex-specific host input', () => {
    expect(supportsCodexProviderResume({
      runtimeDescriptorV1: {
        v: 1,
        agentId: 'codex',
        agent: {
          backendMode: 'appServer',
          providerSessionId: 'thread-1',
        },
      },
    })).toBe(true);
  });
});
