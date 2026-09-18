import { describe, expect, it } from 'vitest';

import { resolveRowlessExecutionRunStartOptions } from './resolveRowlessExecutionRunStartOptions';

const choice = {
    backendTarget: { kind: 'backend' as const, backendId: 'codex' },
    targetKey: 'agent:codex',
    backendId: 'codex',
    agentId: 'codex',
    title: 'Codex',
    disabled: false,
};

describe('resolveRowlessExecutionRunStartOptions', () => {
    it('projects the selected target and canonical launcher options onto the direct first-Send start', () => {
        const result = resolveRowlessExecutionRunStartOptions({
            choice,
            input: {
                permissionMode: 'workspace_write',
                profileId: 'profile_work',
                profileGenerationId: 'generation_2',
                modelId: 'gpt-5.6',
                configOptions: { reasoning_effort: 'high' },
                connectedServices: 'anthropic:team',
                connectedServicesByBackendTargetKey: { 'agent:codex': 'openai-codex:native' },
                secretReferenceOverlay: {
                    v: 1,
                    bindings: {
                        OPENAI_API_KEY: {
                            ref: 'happier:shared-secret:v1:secret-1',
                            revision: 7,
                        },
                    },
                },
                teamCredentialModel: {
                    kind: 'team_credential_provider_model',
                    resourceId: 'resource-team',
                    teamId: 'team-1',
                    expectedResourceRevision: 7,
                    deliveryMode: 'brokered',
                    agentTargetKey: 'agent:codex',
                    modelId: 'gpt-5.6',
                },
                teamCredentialSessionBindingConsent: {
                    v: 1,
                    sessionId: 'session-1',
                    teamId: 'team-1',
                    resourceId: 'resource-team',
                    expectedResourceRevision: 7,
                },
            },
        });

        expect(result).toEqual({
            ok: true,
            options: expect.objectContaining({
                backendTarget: { kind: 'backend', backendId: 'codex' },
                permissionMode: 'workspace_write',
                profileId: 'profile_work',
                profileGenerationId: 'generation_2',
                modelId: 'gpt-5.6',
                sessionConfigOptionOverrides: expect.objectContaining({
                    v: 1,
                    overrides: expect.objectContaining({
                        reasoning_effort: expect.objectContaining({ value: 'high' }),
                    }),
                }),
                connectedServices: {
                    v: 2,
                    bindingsByServiceId: {
                        'happier.agent.codex/openai-codex': { source: 'native' },
                    },
                },
                secretReferenceOverlay: {
                    v: 1,
                    bindings: {
                        OPENAI_API_KEY: {
                            ref: 'happier:shared-secret:v1:secret-1',
                            revision: 7,
                        },
                    },
                },
                teamCredentialModel: {
                    kind: 'team_credential_provider_model',
                    resourceId: 'resource-team',
                    teamId: 'team-1',
                    expectedResourceRevision: 7,
                    deliveryMode: 'brokered',
                    agentTargetKey: 'agent:codex',
                    modelId: 'gpt-5.6',
                },
                teamCredentialSessionBindingConsent: {
                    v: 1,
                    sessionId: 'session-1',
                    teamId: 'team-1',
                    resourceId: 'resource-team',
                    expectedResourceRevision: 7,
                },
            }),
        });
        if (result.ok) {
            expect(result.options).not.toHaveProperty('configOptions');
            expect(result.options).not.toHaveProperty('connectedServicesByBackendTargetKey');
        }
    });

    it('fails closed on a conflicting config alias or incomplete profile selection', () => {
        expect(resolveRowlessExecutionRunStartOptions({
            choice,
            input: {
                permissionMode: 'workspace_write',
                configOptions: { reasoning_effort: 'high' },
                sessionConfigOptionOverrides: {
                    v: 1,
                    updatedAt: 1,
                    overrides: { reasoning_effort: { updatedAt: 1, value: 'low' } },
                },
            },
        })).toEqual({ ok: false });
        expect(resolveRowlessExecutionRunStartOptions({
            choice,
            input: { permissionMode: 'workspace_write', profileId: 'profile_work' },
        })).toEqual({ ok: false });
    });

    it('fails closed when a previously selected target becomes unavailable', () => {
        expect(resolveRowlessExecutionRunStartOptions({
            choice: { ...choice, disabled: true },
            input: { permissionMode: 'workspace_write' },
        })).toEqual({ ok: false });
    });
});
