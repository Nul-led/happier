import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactTestRenderer } from 'react-test-renderer';

import type { ToolCall } from "@happier-dev/session-core/messages";
import { makeToolCall, makeToolViewProps, findPressableByText } from '@/dev/testkit';
import { createTestSessionTranscriptSource, pressTestInstanceAsync, renderWithSessionTranscriptSource } from '@/dev/testkit';
import { installWorkflowRendererCommonModuleMocks } from './workflowRendererTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sessionAllowWithAnswers = vi.fn();

installWorkflowRendererCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock(
            {
                View: (props: any) => React.createElement('View', props, props.children),
                Text: (props: any) => React.createElement('Text', props, props.children),
                TouchableOpacity: (props: any) => React.createElement('TouchableOpacity', props, props.children),
                TextInput: (props: any) => React.createElement('TextInput', props, null),
                ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props, null),
            }
        );
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            storage: {
                getState: () => ({
                    sessions: {
                        s1: {
                            agentState: {
                                requests: {
                                    toolu_1: {
                                        tool: 'AskUserQuestion',
                                        arguments: {},
                                        createdAt: 1,
                                    },
                                },
                            },
                        },
                    },
                }),
            },
        });
    },
});

vi.mock('@/components/sessions/terminal/openAttachedSessionTerminal', () => ({
    useOpenAttachedSessionTerminal: () => ({
        available: false,
        unavailableReason: null,
        open: vi.fn(),
    }),
}));

describe('AskUserQuestionView legacy request-kind fallback', () => {
    it('allows submitting when the matching legacy request omits kind', async () => {
        sessionAllowWithAnswers.mockReset();
        sessionAllowWithAnswers.mockResolvedValueOnce(undefined);

        const { AskUserQuestionView } = await import('./AskUserQuestionView');
        const tool: ToolCall = makeToolCall({
            name: 'AskUserQuestion',
            state: 'running',
            input: {
                questions: [
                    {
                        header: 'Q1',
                        question: 'Pick one',
                        multiSelect: false,
                        options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
                    },
                ],
            },
            permission: { id: 'toolu_1', status: 'pending' },
        });

        let tree: ReactTestRenderer | null = null;
        tree = (await renderWithSessionTranscriptSource(React.createElement(AskUserQuestionView, makeToolViewProps(tool, { sessionId: 's1' })), createTestSessionTranscriptSource({
            interaction: { canSendMessages: true, canApprovePermissions: true },
            agentState: { requests: { toolu_1: { tool: 'AskUserQuestion', arguments: {}, createdAt: 1 } } },
            actions: { answerUserAction: (params) => sessionAllowWithAnswers(params), respondToPermission: async () => {}, abort: async () => {}, submitMessage: async () => {} },
        }))).tree;

        const option = findPressableByText(tree!, 'A');
        expect(option).toBeTruthy();
        await pressTestInstanceAsync(option, 'A');

        const submit = findPressableByText(tree!, 'tools.askUserQuestion.submit');
        expect(submit).toBeTruthy();
        await pressTestInstanceAsync(submit, 'tools.askUserQuestion.submit');

        expect(sessionAllowWithAnswers).toHaveBeenCalledTimes(1);
        expect(sessionAllowWithAnswers).toHaveBeenCalledWith({ id: 'toolu_1', answers: { 'Pick one': ['A'] } });
    });
});
