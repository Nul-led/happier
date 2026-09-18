import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildCodexAgentRuntimeDescriptorV1,
  readCanonicalCodexAgentRuntimeDescriptorV1,
  readExactCodexProviderSessionId,
} from './runtimeDescriptorV1.js';

// Codex mints provider session ids; Happier must carry their exact bytes.
// Leading/trailing whitespace and `/`, `+`, `=` are significant payload, so a
// trimming implementation resolves a different provider session.
const EXACT_PROVIDER_SESSION_ID = '  provider\nses/AB+cd==  ';

describe('Codex runtime descriptor v1', () => {
  it('owns the provider codec inside the plugin leaf', () => {
    const source = readFileSync(new URL('./runtimeDescriptorV1.ts', import.meta.url), 'utf8');
    const protocolSpecifier = '@happier-dev/' + 'protocol';

    expect(source).not.toContain(`from '${protocolSpecifier}`);
    expect(source).not.toContain(`from "${protocolSpecifier}`);
  });

  it('keeps connected-service group descriptors canonical', () => {
    const descriptor = buildCodexAgentRuntimeDescriptorV1({
      backendMode: 'appServer',
      providerSessionId: ' thread-1 ',
      home: 'connectedService',
      connectedServiceId: ' openai-codex ',
      connectedServiceGroupId: ' team ',
      homePath: ' /tmp/connected/__groups/team/codex/codex-home ',
    });

    // Happier-owned identifiers and paths stay trimmed; only the provider's own
    // session id is carried byte-exact.
    expect(readCanonicalCodexAgentRuntimeDescriptorV1(descriptor)).toEqual({
      agentId: 'codex',
      backendMode: 'appServer',
      providerSessionId: ' thread-1 ',
      appServerEndpoint: null,
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: null,
      connectedServiceGroupId: 'team',
      homePath: '/tmp/connected/__groups/team/codex/codex-home',
    });
  });

  it('keeps legacy runtimeAffinity provider-extra carriers readable', () => {
    expect(readCanonicalCodexAgentRuntimeDescriptorV1({
      v: 1,
      agentId: 'codex',
      provider: {
        backendMode: 'appServer',
        providerExtra: {
          owner: 'codex',
          schemaId: 'codex.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeAffinity: {
            backendMode: 'acp',
            vendorSessionId: 'legacy-thread',
          },
        },
      },
    })).toMatchObject({
      backendMode: 'acp',
      providerSessionId: 'legacy-thread',
    });
  });

  it('ignores provider-extra carriers without the Codex owner and schema', () => {
    expect(readCanonicalCodexAgentRuntimeDescriptorV1({
      v: 1,
      agentId: 'codex',
      provider: {
        backendMode: 'appServer',
        providerSessionId: 'canonical-thread',
        providerExtra: {
          owner: 'other-provider',
          schemaId: 'other-provider.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeHandle: {
            backendMode: 'acp',
            providerSessionId: 'forged-thread',
          },
        },
      },
    })).toMatchObject({
      backendMode: 'appServer',
      providerSessionId: 'canonical-thread',
    });
  });

  it('reads a present provider session id as its exact bytes and rejects blank', () => {
    expect(readExactCodexProviderSessionId(EXACT_PROVIDER_SESSION_ID))
      .toBe(EXACT_PROVIDER_SESSION_ID);
    expect(readExactCodexProviderSessionId(' \n\t ')).toBeNull();
    expect(readExactCodexProviderSessionId('')).toBeNull();
    expect(readExactCodexProviderSessionId(undefined)).toBeNull();
    expect(readExactCodexProviderSessionId(123)).toBeNull();
  });

  it('round-trips the exact provider session id through build and canonical read', () => {
    const descriptor = buildCodexAgentRuntimeDescriptorV1({
      backendMode: 'acp',
      providerSessionId: EXACT_PROVIDER_SESSION_ID,
      home: 'user',
    });

    expect(descriptor.agent.providerSessionId).toBe(EXACT_PROVIDER_SESSION_ID);
    expect(descriptor.agent.agentExtra?.runtimeHandle?.providerSessionId)
      .toBe(EXACT_PROVIDER_SESSION_ID);
    expect(readCanonicalCodexAgentRuntimeDescriptorV1(descriptor)?.providerSessionId)
      .toBe(EXACT_PROVIDER_SESSION_ID);
  });

  it('round-trips the shared app-server endpoint through the canonical runtime handle', () => {
    const descriptor = buildCodexAgentRuntimeDescriptorV1({
      backendMode: 'appServer',
      providerSessionId: 'thread-381',
      appServerEndpoint: ' unix:///tmp/happier-codex/app-server.sock ',
      home: 'user',
    });

    expect(descriptor.agent.appServerEndpoint)
      .toBe('unix:///tmp/happier-codex/app-server.sock');
    expect(descriptor.agent.agentExtra?.runtimeHandle?.appServerEndpoint)
      .toBe('unix:///tmp/happier-codex/app-server.sock');
    expect(readCanonicalCodexAgentRuntimeDescriptorV1(descriptor)?.appServerEndpoint)
      .toBe('unix:///tmp/happier-codex/app-server.sock');
  });

  it('keeps legacy vendorSessionId read-compat byte-exact and drops blank ids', () => {
    expect(readCanonicalCodexAgentRuntimeDescriptorV1({
      v: 1,
      agentId: 'codex',
      agent: { backendMode: 'acp', vendorSessionId: EXACT_PROVIDER_SESSION_ID },
    })?.providerSessionId).toBe(EXACT_PROVIDER_SESSION_ID);

    expect(readCanonicalCodexAgentRuntimeDescriptorV1({
      v: 1,
      agentId: 'codex',
      agent: { backendMode: 'acp', providerSessionId: '   ' },
    })?.providerSessionId).toBeNull();
  });

  it('fails closed when canonical and deployed identity fields conflict', () => {
    expect(readCanonicalCodexAgentRuntimeDescriptorV1({
      v: 1,
      agentId: 'codex',
      providerId: 'opencode',
      provider: { backendMode: 'appServer' },
    })).toBeNull();
  });
});
