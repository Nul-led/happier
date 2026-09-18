import { describe, expect, it, vi } from 'vitest';
import { AIBackendProfileSchema, type SavedSecret } from '@happier-dev/protocol';

import {
    assertLaunchProfileReviewCurrent,
    isLaunchProfileReviewCurrent,
    LaunchProfileEnvironmentUnavailableError,
    LaunchProfileReviewChangedError,
    materializeLaunchProfileEnvironment,
} from './profileHelpers';

function profile(updatedAt = 1) {
    return AIBackendProfileSchema.parse({
        id: 'work',
        name: 'Work',
        environmentVariables: [{ name: 'PROFILE_MODE', value: 'reviewed' }],
        envVarRequirements: [{ name: 'RUNNER_PROFILE_TOKEN', required: true, kind: 'secret' }],
        createdAt: 1,
        updatedAt,
    });
}

describe('New Session launch Profile materialization', () => {
    it('materializes the exact selected secret into the reviewed environment snapshot', () => {
        const result = materializeLaunchProfileEnvironment({
            profile: profile(),
            selectedAgentProviderOwnedEnvironmentKeys: [],
            secrets: [{
                id: 'secret-work',
                name: 'Work token',
                encryptedValue: { _isSecretValue: true, value: 'sealed-value' },
                createdAt: 1,
                updatedAt: 1,
                kind: 'token',
            }],
            selectedSecretIds: { RUNNER_PROFILE_TOKEN: 'secret-work' },
            machineEnvReadyByName: { RUNNER_PROFILE_TOKEN: false },
            decryptSecretValue: (value) => value?.value ?? null,
        });

        expect(result).toEqual({
            ok: true,
            environmentVariables: {
                PROFILE_MODE: 'reviewed',
                RUNNER_PROFILE_TOKEN: 'sealed-value',
            },
        });
    });

    it('materializes a whitespace-only Enter Once value without normalization', () => {
        expect(materializeLaunchProfileEnvironment({
            profile: profile(),
            selectedAgentProviderOwnedEnvironmentKeys: [],
            secrets: [],
            sessionOnlyValues: { RUNNER_PROFILE_TOKEN: '   ' },
            machineEnvReadyByName: { RUNNER_PROFILE_TOKEN: false },
            decryptSecretValue: () => null,
        })).toEqual({
            ok: true,
            environmentVariables: { PROFILE_MODE: 'reviewed', RUNNER_PROFILE_TOKEN: '   ' },
        });
    });

    it('fails closed when selected SavedSecret material cannot be decrypted', () => {
        const result = materializeLaunchProfileEnvironment({
            profile: profile(),
            selectedAgentProviderOwnedEnvironmentKeys: [],
            secrets: [{
                id: 'secret-work',
                name: 'Work token',
                encryptedValue: { _isSecretValue: true, value: 'sealed-value' },
                createdAt: 1,
                updatedAt: 1,
                kind: 'token',
            }],
            selectedSecretIds: { RUNNER_PROFILE_TOKEN: 'secret-work' },
            machineEnvReadyByName: { RUNNER_PROFILE_TOKEN: false },
            decryptSecretValue: () => null,
        });
        expect(result).toEqual({ ok: false, reason: 'secret_requirement_unsatisfied' });
        if (result.ok) throw new Error('Expected unresolved Profile environment');
        expect(new LaunchProfileEnvironmentUnavailableError(result.reason)).toMatchObject({
            name: 'LaunchProfileEnvironmentUnavailableError',
            code: 'runner_profile_environment_unavailable',
            reason: 'secret_requirement_unsatisfied',
        });
    });

    it('keeps provider-owned Profile secrets on the canonical broker path without decrypting them', () => {
        const decryptSecretValue = vi.fn((value: SavedSecret['encryptedValue'] | null | undefined) => value?.value ?? null);
        const result = materializeLaunchProfileEnvironment({
            profile: AIBackendProfileSchema.parse({
                id: 'azure-work',
                name: 'Azure work',
                environmentVariables: [
                    { name: 'AZURE_OPENAI_API_VERSION', value: '2024-02-15-preview' },
                    { name: 'HAPPIER_CODEX_PROVIDER_API_KEY', value: 'must-not-reach-runner' },
                    { name: 'PROFILE_MODE', value: 'reviewed' },
                ],
                envVarRequirements: [
                    { name: 'AZURE_OPENAI_API_KEY', required: true, kind: 'secret' },
                    { name: 'HAPPIER_CODEX_PROVIDER_API_KEY', required: true, kind: 'secret' },
                    { name: 'RUNNER_PROFILE_TOKEN', required: true, kind: 'secret' },
                ],
            }),
            selectedAgentProviderOwnedEnvironmentKeys: ['HAPPIER_CODEX_PROVIDER_API_KEY'],
            secrets: [
                {
                    id: 'azure-secret',
                    name: 'Azure key',
                    encryptedValue: { _isSecretValue: true, value: 'azure-direct-secret' },
                    createdAt: 1,
                    updatedAt: 1,
                    kind: 'token',
                },
                {
                    id: 'codex-provider-secret',
                    name: 'Codex provider key',
                    encryptedValue: { _isSecretValue: true, value: 'codex-direct-secret' },
                    createdAt: 1,
                    updatedAt: 1,
                    kind: 'token',
                },
                {
                    id: 'ordinary-secret',
                    name: 'Ordinary Profile token',
                    encryptedValue: { _isSecretValue: true, value: 'ordinary-profile-secret' },
                    createdAt: 1,
                    updatedAt: 1,
                    kind: 'token',
                },
            ],
            selectedSecretIds: {
                AZURE_OPENAI_API_KEY: 'azure-secret',
                HAPPIER_CODEX_PROVIDER_API_KEY: 'codex-provider-secret',
                RUNNER_PROFILE_TOKEN: 'ordinary-secret',
            },
            machineEnvReadyByName: {
                AZURE_OPENAI_API_KEY: false,
                HAPPIER_CODEX_PROVIDER_API_KEY: false,
                RUNNER_PROFILE_TOKEN: false,
            },
            decryptSecretValue,
        });

        expect(result).toEqual({
            ok: true,
            environmentVariables: {
                PROFILE_MODE: 'reviewed',
                RUNNER_PROFILE_TOKEN: 'ordinary-profile-secret',
            },
        });
        expect(decryptSecretValue).toHaveBeenCalledTimes(1);
        expect(decryptSecretValue).toHaveBeenCalledWith(expect.objectContaining({ value: 'ordinary-profile-secret' }));
    });

    it('classifies only its own deterministic preflight failures as Profile incompatibilities', async () => {
        const { resolveLaunchProfileIncompatibility } = await import('./profileHelpers');
        expect(resolveLaunchProfileIncompatibility(
            new LaunchProfileEnvironmentUnavailableError('secret_requirement_unsatisfied'),
        )).toBe('profile_environment_unavailable');
        expect(resolveLaunchProfileIncompatibility(new LaunchProfileReviewChangedError())).toBe('profile_changed');
        // A transport or transient failure keeps its ordinary retryable handling.
        expect(resolveLaunchProfileIncompatibility(new Error('network unreachable'))).toBeNull();
        expect(resolveLaunchProfileIncompatibility(null)).toBeNull();
    });

    it('fails currentness when the reviewed Profile changed before activation preparation', () => {
        expect(isLaunchProfileReviewCurrent(profile(1), profile(2))).toBe(false);
        expect(isLaunchProfileReviewCurrent(profile(1), profile(1))).toBe(true);
        expect(() => assertLaunchProfileReviewCurrent(profile(1), profile(2))).toThrow(
            expect.objectContaining({
                name: 'LaunchProfileReviewChangedError',
                code: 'runner_profile_selection_changed',
            }),
        );
    });
});
