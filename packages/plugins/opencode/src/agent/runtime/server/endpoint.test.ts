import { describe, expect, it } from 'vitest';
import {
  OPENCODE_SERVER_PASSWORD_ENV_KEY,
  readOpenCodeServerEndpoint,
} from './endpoint.js';
import { buildOpenCodeAgentRuntimeDescriptorV1 } from '../../identity/runtimeDescriptor.js';
import type { AgentSessionOpenRequest } from '@happier-dev/plugin-sdk/agents/runtime';

describe('managed OpenCode endpoint configuration', () => {
  it('uses the strict Session configuration endpoint for a new session', () => {
    expect(readOpenCodeServerEndpoint({ config: { values: {} } }, {
      kind: 'create',
      configuration: { options: { opencodeServerBaseUrl: { value: 'https://configured.example.test/', updatedAtMs: 1 } } },
    })).toEqual({ mode: 'external-attach', baseUrl: 'https://configured.example.test', credential: null });
  });
  it('publishes only the host password-injection destination', () => {
    expect(OPENCODE_SERVER_PASSWORD_ENV_KEY).toBe('OPENCODE_SERVER_PASSWORD');
  });

  it.each(['fork', 'resume'] as const)('uses the canonical explicit parent server for %s without treating managed hints as external authority', (kind) => {
    const source = { sessionId: 'parent-happier', providerSessionId: 'parent-native', cwd: '/repo' };
    const common = {
      sessionId: 'child-happier', cwd: '/repo',
      runtimeDescriptorV1: buildOpenCodeAgentRuntimeDescriptorV1({
        backendMode: 'server', providerSessionId: source.providerSessionId,
        serverBaseUrl: 'https://parent.example.test/', serverBaseUrlExplicit: true,
      }),
    };
    const request: AgentSessionOpenRequest = kind === 'fork'
      ? { ...common, kind, source }
      : { ...common, kind, providerSessionId: source.providerSessionId };
    const context = { config: { values: { HAPPIER_OPENCODE_SERVER_URL: 'https://current-default.example.test' } } };
    expect(readOpenCodeServerEndpoint(context, request)).toEqual({
      mode: 'external-attach', baseUrl: 'https://parent.example.test', credential: null,
    });
    const managedRequest = { ...request, runtimeDescriptorV1: {
      v: 1, agentId: 'opencode', agent: { backendMode: 'server', providerSessionId: source.providerSessionId,
        serverBaseUrl: 'http://127.0.0.1:4312' },
    } };
    expect(readOpenCodeServerEndpoint({ config: { values: {} } }, managedRequest)).toEqual({ mode: 'managed-spawn' });
  });
});
