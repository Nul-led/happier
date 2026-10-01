import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { pressTestInstanceAsync } from '@/dev/testkit';
import { installPermissionShellCommonModuleMocks, createPermissionShellRenderer } from './permissionShellTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({
    flavor: 'opencode' as 'claude' | 'codex' | 'opencode' | 'gemini',
    protocol: 'claude' as 'codexDecision' | 'claude',
    setProtocol(protocol: 'codexDecision' | 'claude', flavor: 'claude' | 'codex' | 'opencode' | 'gemini') {
        this.protocol = protocol;
        this.flavor = flavor;
    },
}));

const ops = vi.hoisted(() => ({
    deny: vi.fn(async (..._args: unknown[]) => {}),
    abort: vi.fn(async (..._args: unknown[]) => {}),
}));
const renderScreen = createPermissionShellRenderer(ops);


const sessionStore = vi.hoisted(() => ({
    updateSessionPermissionMode: vi.fn((..._args: unknown[]) => {}),
}));

const syncMock = vi.hoisted(() => ({
    sendMessage: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

installPermissionShellCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            importOriginal,
            storage: { getState: () => sessionStore },
        });
    },
});



vi.mock('@/sync/sync', () => ({
    sync: {
        sendMessage: syncMock.sendMessage,
    },
}));

vi.mock('@/agents/catalog/resolve', () => ({
    resolveAgentIdForPermissionUi: () => runtime.flavor,
}));

vi.mock('@/agents/catalog/permissionUiCopy', () => ({
    getPermissionFooterCopy: () => {
        if (runtime.protocol === 'codexDecision') {
            return {
                protocol: 'codexDecision',
                yesAlwaysAllowCommandKey: 'codex.permissions.yesAlwaysAllowCommand',
                yesForSessionKey: 'codex.permissions.yesForSession',
                stopKey: 'codex.permissions.stop',
            };
        }
        return {
            protocol: 'claude',
            yesAllowAllEditsKey: 'claude.permissions.yesAllowAllEdits',
            yesForToolKey: 'claude.permissions.yesForTool',
            stopKey: 'claude.permissions.stop',
        };
    },
}));

describe('PermissionFooter stop action', () => {
    it.each([
        {
            name: 'codex decision protocol',
            protocol: 'codexDecision' as const,
            flavor: 'codex' as const,
            toolName: 'execute',
            toolInput: { command: 'pwd' },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: false,
            expectedDecision: 'denied' as const,
        },
        {
            name: 'codex decision protocol on non-codex agent',
            protocol: 'codexDecision' as const,
            flavor: 'opencode' as const,
            toolName: 'bash',
            toolInput: { command: 'pwd' },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: true,
            expectedDecision: 'abort' as const,
        },
        {
            name: 'non-codex protocol',
            protocol: 'claude' as const,
            flavor: 'claude' as const,
            toolName: 'Read',
            toolInput: { filepath: '/etc/hosts' },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: true,
            shouldSetReadOnlyMode: true,
            expectedDecision: 'abort' as const,
        },
        {
            name: 'gemini stop/explain should not force read-only mode',
            protocol: 'codexDecision' as const,
            flavor: 'gemini' as const,
            toolName: 'execute',
            toolInput: { command: "bash -lc 'echo hi > /tmp/x'" },
            shouldSendFollowupPrompt: false,
            shouldAbortRun: true,
            shouldSetReadOnlyMode: false,
            expectedDecision: 'abort' as const,
        },
    ])('Stop delivers the owning Agent decision through the source for $name', async ({ protocol, flavor, toolName, toolInput, expectedDecision }) => {
        runtime.setProtocol(protocol, flavor);
        ops.deny.mockClear();
        ops.abort.mockClear();
        syncMock.sendMessage.mockClear();
        sessionStore.updateSessionPermissionMode.mockClear();

        const { PermissionFooter } = await import('../permissions/PermissionFooter');
        const screen = await renderScreen(React.createElement(PermissionFooter, {
            permission: { id: 'p1', status: 'pending' },
            sessionId: 's1',
            toolName,
            toolInput,
            metadata: { flavor },
        }));

        const buttons = screen.findAllByType('TouchableOpacity' as any);
        const stopButton = buttons.at(-1);
        expect(stopButton).toBeTruthy();

        await pressTestInstanceAsync(stopButton, 'stop button');

        expect(ops.deny).toHaveBeenCalledTimes(1);
        expect(ops.deny.mock.calls[0]?.[0]).toMatchObject({ decision: expectedDecision });
        // The app action owner completes stop and local mode recovery atomically.
        expect(ops.abort).not.toHaveBeenCalled();
        expect(sessionStore.updateSessionPermissionMode).not.toHaveBeenCalled();
        expect(syncMock.sendMessage).not.toHaveBeenCalled();
    });
});
