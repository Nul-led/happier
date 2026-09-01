import { describe, expect, test } from 'vitest';
import { SessionModelSelectionV1Schema } from '@happier-dev/protocol';

import { buildResumeHappySessionRpcParams as buildResumeHappySessionRpcParamsForMachine } from './resumeSessionPayload';

function buildResumeHappySessionRpcParams(
    input: Omit<Parameters<typeof buildResumeHappySessionRpcParamsForMachine>[0], 'machineId'> & {
        machineId?: string;
    },
) {
    const { machineId = 'machine-1', ...rest } = input;
    return buildResumeHappySessionRpcParamsForMachine({ ...rest, machineId });
}

describe('buildResumeHappySessionRpcParams', () => {
    test('passes the Agent-owned descriptor through unchanged without placing machine identity on the wire', () => {
        const runtimeDescriptorV1 = {
            v: 1 as const,
            agentId: 'example.machine-scoped-agent',
            agent: {
                opaqueResumeState: { cursor: 'resume-7', nested: { revision: 4 } },
            },
        };
        const params = buildResumeHappySessionRpcParams({
            sessionId: 'session-1',
            machineId: 'machine-b',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'backend', backendId: 'example.machine-scoped-agent' },
            runtimeDescriptorV1,
        });

        expect(params.runtimeDescriptorV1).toEqual(runtimeDescriptorV1);
        expect(params).not.toHaveProperty('codexBackendMode');
        expect(params).not.toHaveProperty('machineId');
    });

    test('builds typed params for resume-session', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelSelection: SessionModelSelectionV1Schema.parse({
                v: 1,
                updatedAt: 123,
                ref: { agentTargetKey: 'backend:claude', providerConnectionId: 'pc_work', modelId: 'claude-sonnet-4-5' },
            }),
        })).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
            modelSelection: {
                v: 1,
                updatedAt: 123,
                ref: { agentTargetKey: 'backend:claude', providerConnectionId: 'pc_work', modelId: 'claude-sonnet-4-5' },
            },
        });
    });

    test('omits legacy bare model override fields', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelUpdatedAt: 123,
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
        });

        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelId: 'claude-sonnet-4-5',
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
        });
    });

    test('preserves an exact structured model id named default', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelSelection: {
                v: 1,
                updatedAt: 123,
                ref: { agentTargetKey: 'backend:claude', providerConnectionId: null, modelId: 'default' },
            },
        })).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
            modelSelection: {
                v: 1,
                updatedAt: 123,
                ref: { agentTargetKey: 'backend:claude', providerConnectionId: null, modelId: 'default' },
            },
        });
    });

    test('includes environment variables when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'opencode' },
            environmentVariables: {
                HAPPIER_OPENCODE_BACKEND_MODE: 'server',
                HAPPIER_OPENCODE_SERVER_URL: 'http://127.0.0.1:4096/',
            },
        })).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'opencode', sourceKind: 'built_in' },
            environmentVariables: {
                HAPPIER_OPENCODE_BACKEND_MODE: 'server',
                HAPPIER_OPENCODE_SERVER_URL: 'http://127.0.0.1:4096/',
            },
        });
    });

    test('includes transcriptStorage when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            transcriptStorage: 'direct',
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
            transcriptStorage: 'direct',
        });
    });

    test('includes initial transcript catch-up cursor when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialTranscriptAfterSeq: 36,
            executionAuthorization: {
                provenance: 'user_request',
                requestId: ' pending-local-36 ',
            },
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
            initialTranscriptAfterSeq: 36,
            executionAuthorization: {
                provenance: 'user_request',
                requestId: ' pending-local-36 ',
            },
        });
    });

    test('includes an initial goal when resuming a session for goal editing', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialGoal: {
                objective: 'Ship work-state controls',
                status: 'active',
                tokenBudget: 25000,
            },
        })).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
            initialGoal: {
                objective: 'Ship work-state controls',
                status: 'active',
                tokenBudget: 25000,
            },
        });
    });

    test('includes connectedServices and freshness when provided', () => {
        const connectedServices = {
            v: 1,
            bindingsByServiceId: {
                anthropic: {
                    source: 'connected',
                    profileId: 'profile-1',
                },
            },
        };
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            connectedServices,
            connectedServicesUpdatedAt: 1234,
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
            connectedServices,
            connectedServicesUpdatedAt: 1234,
        });
    });

    test('includes attachMetadataIdentityPolicy when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            attachMetadataIdentityPolicy: 'replace_with_runtime_identity',
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' },
            attachMetadataIdentityPolicy: 'replace_with_runtime_identity',
        });
    });

    test('includes configured ACP backend backend targets when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'configuredAcpBackend', backendId: 'custom-kiro' },
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'custom-kiro', configuredBackendId: 'custom-kiro', sourceKind: 'configured' },
        });
    });

    test('preserves canonical V2 backend target inputs through the resume payload', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: {
                kind: 'backend',
                backendId: 'review-bot',
                configuredBackendId: 'review-bot',
                sourceKind: 'configured',
            },
        } as any)).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'review-bot', configuredBackendId: 'review-bot', sourceKind: 'configured' },
        });
    });

    test('carries runtimeDescriptorV1 through the resume RPC payload', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            runtimeDescriptorV1: {
                v: 1,
                agentId: 'codex',
                agent: {
                    backendMode: 'appServer',
                    providerSessionId: 'codex-session-1',
                },
            },
        })).toEqual({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
            runtimeDescriptorV1: {
                v: 1,
                agentId: 'codex',
                agent: {
                    backendMode: 'appServer',
                    providerSessionId: 'codex-session-1',
                },
            },
        });
    });

    test('carries a runtime descriptor for canonical Codex backend targets', () => {
        const params = buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: {
                kind: 'backend',
                backendId: 'codex',
                sourceKind: 'built_in',
            },
            resume: 'codex-session-canonical',
            runtimeDescriptorV1: {
                v: 1,
                agentId: 'codex',
                agent: {
                    backendMode: 'appServer',
                    providerSessionId: 'codex-session-canonical',
                },
            },
        });

        expect(params).toMatchObject({
            type: 'resume-session',
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: {
                kind: 'backend',
                backendId: 'codex',
                sourceKind: 'built_in',
            },
            runtimeDescriptorV1: expect.objectContaining({
                v: 1,
                agentId: 'codex',
                agent: expect.objectContaining({
                    backendMode: 'appServer',
                    providerSessionId: 'codex-session-canonical',
                }),
            }),
        });
        expect(params).not.toHaveProperty('codexBackendMode');
    });
});
