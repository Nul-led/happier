import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => 'profile-id',
}));

import { convertBuiltInProfileToCustom, createEmptyCustomProfile, duplicateProfileForEdit } from './profileMutations';

describe('createEmptyCustomProfile', () => {
    it('creates a slim V2 launch profile that cannot own provider routing or credentials', () => {
        expect(createEmptyCustomProfile()).toMatchObject({
            v: 2,
            id: 'profile-id',
            extraEnvironmentVariables: [],
            compatibilityByTargetKey: {
                'agent:happier.agent.claude/claude': true,
                'agent:happier.agent.codex/codex': true,
                'agent:happier.agent.gemini/gemini': true,
            },
            defaultPermissionModeByTargetKey: {},
            defaultPersistenceModeByTargetKey: {},
        });
        expect(createEmptyCustomProfile()).not.toHaveProperty('environmentVariables');
        expect(createEmptyCustomProfile()).not.toHaveProperty('envVarRequirements');
    });

    it('converts or duplicates legacy profiles into slim V2 without routing/auth environment', () => {
        const legacy = {
            id: 'legacy-provider', name: 'Legacy', description: 'Keep me',
            environmentVariables: [
                { name: 'ANTHROPIC_BASE_URL', value: 'https://gateway.example' },
                { name: 'AZURE_OPENAI_API_VERSION', value: '2024-02-15-preview' },
                { name: 'OPENAI_API_TIMEOUT_MS', value: '600000' },
                { name: 'SAFE_LAUNCH_FLAG', value: '1' },
            ],
            defaultPermissionModeByTargetKey: { 'agent:happier.agent.claude/claude': 'acceptEdits' as const },
            defaultPersistenceModeByTargetKey: { 'agent:happier.agent.claude/claude': 'persisted' as const },
            compatibilityByTargetKey: { 'agent:happier.agent.claude/claude': true },
            createdAt: 1, updatedAt: 1,
        };

        for (const converted of [
            convertBuiltInProfileToCustom(legacy as never),
            duplicateProfileForEdit(legacy as never, { copySuffix: 'Copy' }),
        ]) {
            expect(converted).toMatchObject({
                v: 2,
                description: 'Keep me',
                extraEnvironmentVariables: [
                    { name: 'OPENAI_API_TIMEOUT_MS', value: '600000' },
                    { name: 'SAFE_LAUNCH_FLAG', value: '1' },
                ],
                defaultPermissionModeByTargetKey: { 'agent:happier.agent.claude/claude': 'acceptEdits' },
                defaultPersistenceModeByTargetKey: { 'agent:happier.agent.claude/claude': 'persisted' },
                compatibilityByTargetKey: { 'agent:happier.agent.claude/claude': true },
            });
            expect(converted.extraEnvironmentVariables).not.toContainEqual(expect.objectContaining({ name: 'ANTHROPIC_BASE_URL' }));
            expect(converted.extraEnvironmentVariables).not.toContainEqual(expect.objectContaining({ name: 'AZURE_OPENAI_API_VERSION' }));
        }
    });

    it('converts the moving predecessor coding-prompt override to the sole V2 writer shape', () => {
        const legacy = {
            id: 'remote-dev-profile', name: 'Remote Dev Profile',
            environmentVariables: [],
            defaultPermissionModeByTargetKey: {},
            defaultPersistenceModeByTargetKey: {},
            compatibilityByTargetKey: {},
            createdAt: 1, updatedAt: 1,
            codingPromptBehaviorV1: { v: 1, sessionTitleUpdates: 'initial' as const, responseOptions: 'disabled' as const },
        };

        for (const converted of [
            convertBuiltInProfileToCustom(legacy as never),
            duplicateProfileForEdit(legacy as never, { copySuffix: 'Copy' }),
        ]) {
            expect(converted.codingPromptBehaviorOverrides).toEqual({
                sessionTitleUpdates: 'initial',
                responseOptions: 'disabled',
            });
            expect(converted).not.toHaveProperty('codingPromptBehaviorV1');
        }
    });
});
