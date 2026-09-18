import { describe, expect, it } from 'vitest';

import { resolveVoiceStartAdmission } from './resolveVoiceStartAdmission';

const settings = { providerId: 'fixture', providers: {} } as const;
const entry = {
    providerId: 'fixture',
    roles: ['conversation'],
    requirements: [],
    supportedPlatforms: ['web'],
} as const;

function registry(supportedPlatforms: readonly ('web' | 'ios' | 'android')[]) {
    const current = { ...entry, supportedPlatforms };
    return {
        get: (id: string) => id === 'fixture' ? current : null,
        list: () => [current],
        getRevision: () => 0,
        subscribe: () => () => {},
    } as never;
}

describe('resolveVoiceStartAdmission', () => {
    it('fails start admission before runtime lookup when the selected provider does not support this platform', () => {
        expect(resolveVoiceStartAdmission({
            bindingScope: 'global',
            daemonLocalVoiceUnavailable: false,
            globalStartAuthorized: true,
            platform: 'ios',
            providerId: 'fixture',
            providerSettings: null,
            registry: registry(['web']),
            startSessionId: null,
            voiceSettings: settings,
        }).canStart).toBe(false);
    });

    it('admits the same selected provider on a declared platform', () => {
        expect(resolveVoiceStartAdmission({
            bindingScope: 'global',
            daemonLocalVoiceUnavailable: false,
            globalStartAuthorized: true,
            platform: 'web',
            providerId: 'fixture',
            providerSettings: null,
            registry: registry(['web']),
            startSessionId: null,
            voiceSettings: settings,
        }).canStart).toBe(true);
    });
});
