import { describe, expect, it } from 'vitest';
import type { AiLaunchProfile, LaunchProfileV2 } from '@happier-dev/protocol';

import { DEFAULT_PROFILES, getBuiltInProfile } from '@/sync/domains/profiles/profileUtils';

import { resolveLaunchProfileSave } from './launchProfileSave';

const saved: LaunchProfileV2 = {
    v: 2,
    id: 'profile-a',
    name: 'Profile A',
    extraEnvironmentVariables: [],
    defaultPermissionModeByTargetKey: {},
    defaultPersistenceModeByTargetKey: {},
    compatibilityByTargetKey: {},
    createdAt: 1,
    updatedAt: 1,
};

function resolve(profile: AiLaunchProfile, rawProfiles: unknown = [saved]) {
    return resolveLaunchProfileSave({ profile, rawProfiles, builtInNames: ['Anthropic'], now: () => 42 });
}

describe('resolveLaunchProfileSave', () => {
    it('replaces a saved profile in place and stamps the save time', () => {
        const result = resolve({ ...saved, name: 'Renamed' });
        expect(result).toMatchObject({ status: 'ok', created: false, profile: { id: 'profile-a', name: 'Renamed', updatedAt: 42 } });
        if (result.status !== 'ok') return;
        expect(result.profiles).toHaveLength(1);
    });

    it('adds a profile whose id is not saved yet', () => {
        const result = resolve({ ...saved, id: 'profile-b', name: 'Profile B' });
        expect(result).toMatchObject({ status: 'ok', created: true, profile: { id: 'profile-b' } });
        if (result.status !== 'ok') return;
        expect(result.profiles).toHaveLength(2);
    });

    it('saves any built-in profile as a new custom copy, including one only flagged built-in', () => {
        const builtIn = getBuiltInProfile(DEFAULT_PROFILES[0]!.id)!;
        const shipped = resolve({ ...builtIn, name: 'My copy' } as AiLaunchProfile);
        const flagged = resolve({ ...builtIn, id: 'retired-built-in', isBuiltIn: true, name: 'My other copy' } as AiLaunchProfile);
        for (const [result, sourceId] of [[shipped, builtIn.id], [flagged, 'retired-built-in']] as const) {
            expect(result.status).toBe('ok');
            if (result.status !== 'ok') continue;
            expect(result.created).toBe(true);
            expect(result.profile.id).not.toBe(sourceId);
            expect(result.profiles).toHaveLength(2);
        }
    });

    it('refuses a missing name, a name another saved profile uses, and a built-in name', () => {
        expect(resolve({ ...saved, name: '  ' })).toEqual({ status: 'error', reason: 'nameRequired' });
        expect(resolve({ ...saved, id: 'profile-b', name: ' Profile A ' })).toEqual({ status: 'error', reason: 'duplicateName' });
        expect(resolve({ ...saved, name: 'Anthropic' })).toEqual({ status: 'error', reason: 'duplicateName' });
    });
});
