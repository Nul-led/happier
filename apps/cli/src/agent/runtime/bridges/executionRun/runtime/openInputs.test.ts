import { describe, expect, it } from 'vitest';
import { ProviderBoundModelRefSchema, buildBackendTargetKeyV2 } from '@happier-dev/protocol';

import { buildExecutionRunConfiguration } from './openInputs';

describe('buildExecutionRunConfiguration', () => {
    it('keeps hands-off independent of the delegation permission ceiling', () => {
        expect(buildExecutionRunConfiguration({
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, permissionMode: 'yolo',
            workspaceWrites: 'deny', updatedAtMs: 1,
        }).configuration).toMatchObject({ workspaceWrites: 'deny', permissionIntent: { value: 'yolo' } });
    });

    it('builds a bounded configuration snapshot for the canonical qualified Provider selection', () => {
        const agentTargetKey = buildBackendTargetKeyV2({
            kind: 'agent',
            identity: { pluginId: 'happier.agent.opencode', localId: 'opencode' },
        });
        expect(buildExecutionRunConfiguration({
            backendTarget: { kind: 'builtInAgent', agentId: 'opencode' },
            modelId: 'gpt-5.1-codex',
            modelSelection: ProviderBoundModelRefSchema.parse({
                agentTargetKey,
                providerConnectionId: 'pc_openai',
                modelId: 'gpt-5.1-codex',
            }),
            sessionConfigOptionOverrides: {
                v: 1,
                updatedAt: 7,
                overrides: {
                    reasoning_effort: { value: 'high', updatedAt: 7 },
                },
            },
            acpSessionModeId: 'plan',
            permissionMode: 'read_only',
            updatedAtMs: 11,
        })).toEqual({
            modelSelection: {
                agentTargetKey,
                providerConnectionId: 'pc_openai',
                modelId: 'gpt-5.1-codex',
            },
            configuration: {
                mode: { value: 'plan', updatedAtMs: 11 },
                model: { value: 'gpt-5.1-codex', updatedAtMs: 11 },
                permissionIntent: { value: 'read-only', updatedAtMs: 11 },
                options: {
                    reasoning_effort: { value: 'high', updatedAtMs: 7 },
                },
            },
        });
    });

    it.each([
        {
            label: 'Agent target',
            modelSelection: ProviderBoundModelRefSchema.parse({
                agentTargetKey: 'agent:happier.agent.claude/claude',
                providerConnectionId: 'pc_openai',
                modelId: 'gpt-5.1-codex',
            }),
            modelId: 'gpt-5.1-codex',
            message: 'does not target its backend',
        },
        {
            label: 'model',
            modelSelection: ProviderBoundModelRefSchema.parse({
                agentTargetKey: 'agent:happier.agent.codex/codex',
                providerConnectionId: 'pc_openai',
                modelId: 'gpt-5.1-codex',
            }),
            modelId: 'different-model',
            message: 'does not match modelId',
        },
    ])('rejects a split-brain $label before Provider authorization', ({
        modelSelection,
        modelId,
        message,
    }) => {
        expect(() => buildExecutionRunConfiguration({
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            modelSelection,
            modelId,
            permissionMode: 'default',
            updatedAtMs: 1,
        })).toThrow(message);
    });
});
