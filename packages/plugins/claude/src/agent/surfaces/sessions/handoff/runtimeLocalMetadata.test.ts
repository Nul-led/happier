import { describe, expect, it } from 'vitest';

import { buildClaudeRuntimeLocalHandoffMetadata } from './runtimeLocalMetadata.js';

describe('buildClaudeRuntimeLocalHandoffMetadata', () => {
    it('builds runtime-local Claude direct-session metadata from narrow session input', () => {
        const providerSessionId = '  claude-session-1\n ';
        expect(buildClaudeRuntimeLocalHandoffMetadata({
            metadata: {
                machineId: 'machine-1',
                path: '/repo/project',
            },
            session: {
                vendorResumeId: providerSessionId,
                spawnOptions: {
                    transcriptStorage: 'direct',
                    environmentVariables: {
                        CLAUDE_CONFIG_DIR: '/tmp/native-claude',
                        HAPPIER_CLAUDE_CONFIG_DIR: '/tmp/happier-claude',
                    },
                },
            },
            nowMs: 123,
            env: {
                CLAUDE_CONFIG_DIR: '/tmp/process-claude',
            },
        })).toEqual({
            claudeSessionId: providerSessionId,
            externalSessionV1: {
                v: 1,
                agentId: 'claude',
                machineId: 'machine-1',
                remoteSessionId: providerSessionId,
                source: {
                    kind: 'claudeConfig',
                    configDir: '/tmp/native-claude',
                    projectId: '-repo-project',
                },
                linkedAtMs: 123,
            },
        });
    });

    it('falls back to the explicit vendor resume id before session fields', () => {
        expect(buildClaudeRuntimeLocalHandoffMetadata({
            metadata: {
                machineId: 'machine-1',
                path: '/repo/project',
            },
            session: {
                vendorResumeId: 'stale-session',
                spawnOptions: {
                    resume: 'spawn-session',
                    transcriptStorage: 'persisted',
                },
            },
            vendorResumeId: 'explicit-session',
        })).toEqual({
            claudeSessionId: 'explicit-session',
        });
    });
});
