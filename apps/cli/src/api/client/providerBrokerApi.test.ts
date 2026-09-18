import axios from 'axios';
import { PROVIDER_BROKER_OPEN_HTTP_PATH_V1 } from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { openTeamCredentialProviderBroker } from './providerBrokerApi';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
  post: vi.fn(),
}));

describe('Provider broker narrow HTTP API', () => {
  it('opens one exact typed broker request with only the injected bearer and origin', async () => {
    const request = {
      v: 1 as const,
      resourceId: 'resource-1',
      expectedResourceRevision: 3,
      modelId: 'gpt-5',
      sourceRevision: 'source-3',
      initiatorMachineId: 'worker-1',
      consumer: { kind: 'session' as const, sessionId: 'session-1' },
      application: {
        agentTargetKey: 'agent:happier.agent.codex/codex',
        implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
        endpointTemplateId: 'responses',
        protocol: 'openai-responses' as const,
      },
    };
    const response = { ok: false as const, reasonCode: 'broker_unavailable' as const };
    vi.mocked(axios.post).mockResolvedValueOnce({ data: response });

    await expect(openTeamCredentialProviderBroker({
      serverBaseUrl: 'https://home.example.test/',
      token: 'runner-token',
      request,
      signal: new AbortController().signal,
    })).resolves.toEqual(response);

    expect(axios.post).toHaveBeenCalledWith(
      `https://home.example.test${PROVIDER_BROKER_OPEN_HTTP_PATH_V1}`,
      request,
      {
        headers: { Authorization: 'Bearer runner-token', 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
      },
    );
  });
});
