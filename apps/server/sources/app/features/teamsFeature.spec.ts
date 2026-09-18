import { describe, expect, it } from 'vitest';

import { resolveTeamsFeature } from './teamsFeature';

const enabled = {
    HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED: '1',
    HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES_EXTERNAL_API__ENABLED: '1',
};

describe('Teams external API deployment projection', () => {
    it('keeps missing and non-HTTPS public ingress unavailable', () => {
        expect(resolveTeamsFeature(enabled).capabilities?.teams?.credentialResources?.externalApi).toEqual({
            available: false,
            reason: 'home_not_public_https',
        });
        expect(resolveTeamsFeature({
            ...enabled,
            HAPPIER_PUBLIC_SERVER_URL: 'http://home.example.test',
        }).capabilities?.teams?.credentialResources?.externalApi).toEqual({
            available: false,
            reason: 'home_not_public_https',
        });
    });

    it('publishes the exact HTTPS endpoint and supported protocols only when ready', () => {
        expect(resolveTeamsFeature({
            ...enabled,
            HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test/prefix/',
        }).capabilities?.teams?.credentialResources?.externalApi).toEqual({
            available: true,
            baseUrl: 'https://home.example.test/prefix/api/provider-broker/v1',
            protocols: ['openai_responses', 'openai_chat_completions', 'anthropic_messages'],
        });
    });

    it('reports feature-disabled without publishing deployment details', () => {
        expect(resolveTeamsFeature({
            HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
        }).capabilities?.teams?.credentialResources?.externalApi).toEqual({
            available: false,
            reason: 'feature_disabled',
        });
    });
});
