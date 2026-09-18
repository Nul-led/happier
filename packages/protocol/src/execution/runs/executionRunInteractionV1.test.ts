import { describe, expect, it } from 'vitest';

import { ExecutionRunPublicStateSchema } from './responseSchemas.js';
import { ExecutionRunInteractionV1Schema } from './executionRunInteractionV1.js';
import { PluginAgentSessionCapabilitiesV2Schema } from '../../plugins/contributions/agentSessionCapabilities.js';
import { PluginAgentSessionCapabilitiesV2Schema as ManifestSessionCapabilitiesSchema } from '../../plugins/contributions/v2.js';

const capabilities = {
    open: ['create', 'resume'],
    delivery: ['newTurn', 'steer'],
    cancel: true,
    executionRunContext: { versions: [1] },
} as const;

const baseRun = {
    runId: 'run_1',
    callId: 'subagent_run_1',
    sidechainId: 'subagent_run_1',
    intent: 'delegate',
    backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
    permissionMode: 'read_only',
    retentionPolicy: 'resumable',
    runClass: 'long_lived',
    ioMode: 'streaming',
    status: 'running',
    startedAtMs: 1,
} as const;

describe('ExecutionRunInteractionV1', () => {
    it('is the same declared Session-capability owner reached through both public imports', () => {
        // One owner, not two lockstep definitions: the manifest module re-exports it.
        expect(ManifestSessionCapabilitiesSchema).toBe(PluginAgentSessionCapabilitiesV2Schema);
        expect(PluginAgentSessionCapabilitiesV2Schema.parse(capabilities)).toEqual(capabilities);
        expect(ManifestSessionCapabilitiesSchema.safeParse({ ...capabilities, open: [] }).success).toBe(false);
        expect(ManifestSessionCapabilitiesSchema.safeParse({
            ...capabilities,
            executionRunContext: { versions: [2] },
        }).success).toBe(false);
    });

    it('projects the incumbent Session capability schema strictly', () => {
        expect(ExecutionRunInteractionV1Schema.parse({
            kind: 'retained_agent_session.v1',
            capabilities,
        })).toEqual({ kind: 'retained_agent_session.v1', capabilities });

        // No second capability vocabulary and no invented control booleans.
        expect(ExecutionRunInteractionV1Schema.safeParse({
            kind: 'retained_agent_session.v1',
            capabilities: { ...capabilities, canSend: true },
        }).success).toBe(false);
        expect(ExecutionRunInteractionV1Schema.safeParse({
            kind: 'interactive.v1',
            capabilities,
        }).success).toBe(false);
    });

    it('carries the interaction projection on public run state and treats absence as read-only', () => {
        const interactive = ExecutionRunPublicStateSchema.parse({
            ...baseRun,
            interaction: { kind: 'retained_agent_session.v1', capabilities },
        });
        expect(interactive.interaction).toEqual({ kind: 'retained_agent_session.v1', capabilities });

        const readOnly = ExecutionRunPublicStateSchema.parse(baseRun);
        expect(readOnly.interaction).toBeUndefined();
    });

    it('rejects a malformed projection instead of degrading it to read-only', () => {
        expect(() => ExecutionRunPublicStateSchema.parse({
            ...baseRun,
            interaction: { kind: 'retained_agent_session.v1', capabilities: { open: ['create'] } },
        })).toThrow();
    });
});
