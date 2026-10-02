import { describe, expect, it } from 'vitest';

import { resolveOpenCodeBackendMode } from './mode.js';
import { createOpenCodeAgentRuntime } from './nativeRuntime.js';

describe('resolveOpenCodeBackendMode for execution runs', () => {
  it('honors explicit typed session mode over the ambient legacy launch environment', async () => {
    const runtime = await createOpenCodeAgentRuntime({ plugin: { id: 'happier.agent.opencode', version: '0.0.0' }, agent: { id: 'opencode' }, signal: new AbortController().signal });
    await expect(runtime.sessions?.resolveTerminalPresentation?.({
      configuration: {
        options: { opencodeBackendMode: { value: 'server', updatedAtMs: 1 } },
      },
      launchEnvironment: { values: { HAPPIER_OPENCODE_BACKEND_MODE: 'acp' } },
    }, {
      settings: { forScope() { throw new Error('Explicit OpenCode runtime mode must not consult account settings'); } },
      features: { isEnabled() { throw new Error('Explicit OpenCode runtime mode must not consult feature policy'); } },
    })).resolves.toMatchObject({ kind: 'provider_attach', runtimeDescriptorV1: { agent: { backendMode: 'server' } } });
  });
  it('defaults OpenCode execution runs to server mode', () => {
    expect(resolveOpenCodeBackendMode({ env: undefined })).toBe('server');
  });

  it('lets execution-run isolation env prefer ACP over account settings', () => {
    expect(resolveOpenCodeBackendMode({
      env: { HAPPIER_OPENCODE_BACKEND_MODE: ' acp ' },
      accountSettings: {
        opencodeBackendMode: 'server',
      },
    })).toBe('acp');
  });

  it('uses account settings when no explicit env override is present', () => {
    expect(resolveOpenCodeBackendMode({
      env: {},
      accountSettings: {
        opencodeBackendMode: 'acp',
      },
    })).toBe('acp');
  });
});
