import type { AgentState, Metadata } from '@/api/types';
import { createHostSubagentStore } from '@/session/subagents/hostSubagentStore';
import type { SessionEventMessage } from '@/api/session/sessionMessageTypes';
import { describe, expect, it, vi } from 'vitest';

async function loadProjectionModule() {
    const module = await import('./projection').catch(() => null);
    expect(module).toEqual(expect.objectContaining({
        createTerminalRuntimeProjectionHostService: expect.any(Function),
    }));
    if (!module) {
        throw new Error('terminal projection module is not available');
    }
    return module;
}

function createMetadataFixture(): Metadata {
    return {
        path: '/repo',
        host: 'host.local',
        homeDir: '/home/user',
        happyHomeDir: '/home/user/.happier',
        happyLibDir: '/home/user/.happier/lib',
        happyToolsDir: '/home/user/.happier/tools',
    };
}

function createSessionFixture() {
    let metadata: Metadata = createMetadataFixture();
    let agentState: AgentState = {};
    const directEvents: unknown[] = [];
    const committedEvents: unknown[] = [];
    return {
        session: {
            sessionId: 'terminal-parent-session',
            sendSessionEvent(event: SessionEventMessage) {
                directEvents.push(event);
            },
            async enqueueSessionEventCommitted(event: SessionEventMessage) {
                committedEvents.push(event);
                return { persisted: true, delivered: false };
            },
            updateMetadata(updater: (current: Metadata) => Metadata) {
                metadata = updater(metadata);
            },
            updateAgentState(updater: (current: AgentState) => AgentState) {
                agentState = updater(agentState);
            },
        },
        readMetadata: () => metadata,
        readAgentState: () => agentState,
        readDirectEvents: () => [...directEvents],
        readCommittedEvents: () => [...committedEvents],
    };
}

describe('createTerminalRuntimeProjectionHostService', () => {
    it('exposes only canonical terminal projection operations', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();

        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents: createHostSubagentStore(),
        });

        expect(Object.keys(service).sort()).toEqual([
            'publishControlState',
            'publishProviderSessionId',
            'publishSubagentCompleted',
            'publishSubagentStarted',
        ]);
        expect(service).not.toHaveProperty('session');
        expect(service).not.toHaveProperty('subagents');
        expect(service).not.toHaveProperty('transcripts');
    });

    it('publishes the Agent-issued session identity byte for byte through session metadata', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents: createHostSubagentStore(),
        });

        // The Agent minted this id. Its surrounding whitespace, embedded newline
        // and `/`, `+`, `=` bytes are identity; a trimmed or otherwise
        // re-canonicalized value would not resume the Agent's conversation.
        const opaqueProviderSessionId = '  provider\nses/AB+cd==  ';

        await expect(service.publishProviderSessionId({
            providerSessionId: opaqueProviderSessionId,
            metadataKey: 'codexSessionId',
        })).resolves.toBe(true);

        expect(fixture.readMetadata().codexSessionId).toBe(opaqueProviderSessionId);
    });

    it('does not publish a blank provider session identity', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents: createHostSubagentStore(),
        });

        await expect(service.publishProviderSessionId({
            providerSessionId: '   ',
            metadataKey: 'codexSessionId',
        })).resolves.toBe(false);

        expect(fixture.readMetadata()).not.toHaveProperty('codexSessionId');
    });

    it('publishes terminal switch events for control state', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents: createHostSubagentStore(),
        });

        await service.publishControlState({ target: 'local', reason: 'terminal_started' });

        expect(fixture.readCommittedEvents()).toEqual([
            { type: 'switch', mode: 'local' },
        ]);
        expect(fixture.readDirectEvents()).toEqual([]);
    });

    it('surfaces missing committed custody after preserving the Agent control-state projection', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const service = createTerminalRuntimeProjectionHostService({
            session: {
                ...fixture.session,
                enqueueSessionEventCommitted: vi.fn(async () => ({
                    persisted: false,
                    delivered: false,
                })),
            },
            subagents: createHostSubagentStore(),
        });

        await expect(service.publishControlState({
            target: 'local',
            reason: 'terminal_started',
        })).rejects.toThrow('Terminal switch transcript event was not durably admitted');
        expect(fixture.readAgentState()).toMatchObject({ controlledByUser: true });
        expect(fixture.readDirectEvents()).toEqual([]);
    });

    it('clears predecessor exclusive custody for an unsupported selected-runtime control surface', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        fixture.session.updateAgentState((state) => ({
            ...state,
            controlledByUser: true,
            localControl: {
                attached: true,
                topology: 'exclusive',
                remoteWritable: false,
                canAttach: false,
                canDetach: true,
            },
        }));
        const metadata = fixture.readMetadata();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents: createHostSubagentStore(),
        });

        await service.publishControlState({
            target: 'remote',
            localControl: 'unsupported',
            reason: 'selected_runtime_control_unsupported',
        });

        expect(fixture.readAgentState()).toMatchObject({
            controlledByUser: false,
        });
        expect(fixture.readAgentState().localControl).toBeUndefined();
        expect(fixture.readMetadata()).toBe(metadata);
        expect(fixture.readCommittedEvents()).toEqual([]);
    });

    it('publishes running subagents through the host subagent store', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const subagents = createHostSubagentStore();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents,
        });

        await service.publishSubagentStarted({
            agentId: 'acme-terminal',
            agentKind: 'acme-native-subagent',
            subagentId: 'thread-1',
            label: 'Review worker',
            metadata: { prompt: 'Review the patch' },
        });

        await expect(subagents.get({
            parentSessionId: 'terminal-parent-session',
            id: 'thread-1',
        })).resolves.toEqual(expect.objectContaining({
            id: 'thread-1',
            parentSessionId: 'terminal-parent-session',
            origin: 'agent',
            kind: 'native',
            status: 'running',
            agentRef: {
                agentId: 'acme-terminal',
                agentKind: 'acme-native-subagent',
            },
            transcript: {
                parentSessionId: 'terminal-parent-session',
                sidechainId: 'thread-1',
            },
            label: 'Review worker',
            agentMetadata: {
                prompt: 'Review the patch',
            },
        }));
    });

    it('publishes completed subagents through the host subagent store', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const subagents = createHostSubagentStore();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents,
        });

        await service.publishSubagentCompleted({
            agentId: 'codex',
            agentKind: 'codex-native-subagent',
            subagentId: 'thread-1',
            lifecycleDetail: { agentState: 'completed' },
        });

        await expect(subagents.get({
            parentSessionId: 'terminal-parent-session',
            id: 'thread-1',
        })).resolves.toEqual(expect.objectContaining({
            id: 'thread-1',
            status: 'completed',
            lifecycleDetail: { agentState: 'completed' },
        }));
    });

    it('preserves existing subagent details when publishing completion', async () => {
        const { createTerminalRuntimeProjectionHostService } = await loadProjectionModule();
        const fixture = createSessionFixture();
        const subagents = createHostSubagentStore();
        const service = createTerminalRuntimeProjectionHostService({
            session: fixture.session,
            subagents,
        });

        await service.publishSubagentStarted({
            agentId: 'acme-terminal',
            agentKind: 'acme-native-subagent',
            subagentId: 'thread-1',
            label: 'Review worker',
            metadata: { prompt: 'Review the patch' },
        });
        await service.publishSubagentCompleted({
            subagentId: 'thread-1',
            lifecycleDetail: { agentState: 'completed' },
        });

        await expect(subagents.get({
            parentSessionId: 'terminal-parent-session',
            id: 'thread-1',
        })).resolves.toEqual(expect.objectContaining({
            id: 'thread-1',
            status: 'completed',
            label: 'Review worker',
            display: { label: 'Review worker' },
            agentMetadata: {
                prompt: 'Review the patch',
            },
            lifecycleDetail: { agentState: 'completed' },
        }));
    });
});
