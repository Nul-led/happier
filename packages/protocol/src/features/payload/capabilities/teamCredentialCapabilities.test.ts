import { describe, expect, it } from 'vitest';

import { resolveTeamCredentialExternalApiAvailability } from './teamCredentialCapabilities.js';

const enabledFeature = {
  teams: {
    enabled: true,
    credentialResources: { enabled: true, externalApi: { enabled: true } },
  },
};

describe('external Provider API operation availability', () => {
  it.each([
    ['missing', undefined],
    ['malformed', { available: true, baseUrl: 'not-a-url', protocols: ['openai_responses'] }],
    ['plain HTTP', {
      available: true,
      baseUrl: 'http://home.example.test/api/provider-broker/v1',
      protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
    }],
  ])('fails closed for a %s deployment projection', (_name, externalApi) => {
    expect(resolveTeamCredentialExternalApiAvailability({
      features: enabledFeature,
      capabilities: externalApi === undefined
        ? {}
        : { teams: { credentialResources: { externalApi } } },
    })).toEqual({ available: false, reason: 'deployment_readiness_unavailable' });
  });

  it('returns the exact published endpoint and protocol set when HTTPS is ready', () => {
    const availability = {
      available: true as const,
      baseUrl: 'https://home.example.test/prefix/api/provider-broker/v1',
      protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
    } as const;
    expect(resolveTeamCredentialExternalApiAvailability({
      features: enabledFeature,
      capabilities: { teams: { credentialResources: { externalApi: availability } } },
    })).toEqual(availability);
  });

  it('lets the canonical feature bit override otherwise usable deployment details', () => {
    expect(resolveTeamCredentialExternalApiAvailability({
      features: {
        teams: {
          enabled: true,
          credentialResources: { enabled: true, externalApi: { enabled: false } },
        },
      },
      capabilities: {
        teams: {
          credentialResources: {
            externalApi: {
              available: true,
              baseUrl: 'https://home.example.test/api/provider-broker/v1',
              protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
            },
          },
        },
      },
    })).toEqual({ available: false, reason: 'feature_disabled' });
  });
});
