import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { PendingPermissionRequest } from '@/utils/sessions/sessionUtils';
import { renderScreen } from '@/dev/testkit';
import { installToolShellCommonModuleMocks } from '../views/ToolView.testHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

const routerPush = vi.fn();

installToolShellCommonModuleMocks({
    expoRouter: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { push: routerPush },
        }).module;
    },
    reactNative: async () =>
        (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock({
            View: 'View',
            Text: 'Text',
            Pressable: 'Pressable',
            Platform: {
                OS: 'ios',
                select: (v: any) => v.ios,
            },
            AppState: {
                currentState: 'active',
                addEventListener: () => ({ remove: () => {} }),
            },
        }),
    text: async () =>
        (await import('@/dev/testkit/mocks/text')).createTextModuleMock({
            translate: (key: string) => key,
        }),
});

vi.mock('@/components/tools/shell/permissions/presentation/buildPermissionPromptModel', () => ({
    buildPermissionPromptModel: () => ({
        request: { id: 'ua1', tool: 'ask_user', arguments: { question: 'Continue?' } },
        tool: {
            name: 'ask_user',
            state: 'running',
            input: { question: 'Continue?' },
            createdAt: 1,
            startedAt: 1,
            completedAt: null,
            description: null,
            result: null,
            permission: { id: 'ua1', status: 'pending' },
        },
        headerText: { normalizedToolName: 'ask_user', title: 'Question', subtitle: 'Continue?', statusText: null },
    }),
}));

vi.mock('@/components/tools/shell/views/ToolInlineBody', () => ({
    ToolInlineBody: (props: any) => React.createElement('ToolInlineBody', props),
}));

vi.mock('@/sync/ops', () => ({
    sessionAllow: vi.fn(async () => {}),
    sessionDeny: vi.fn(async () => {}),
}));

describe('UserActionPromptCard (preview)', () => {
    it('hides the open-details action when the prompt location is not durably addressable', async () => {
        const { UserActionPromptCard } = await import('./UserActionPromptCard');

        const request = {
            id: 'ua1',
            tool: 'ask_user',
            kind: 'user_action',
            arguments: { question: 'Continue?' },
        } as PendingPermissionRequest;

        const screen = await renderScreen(<UserActionPromptCard
            request={request}
            location={{
                kind: 'top',
                messageId: 'v0k1hmbmnud',
                seq: null,
            }}
            sessionId="session-1"
            metadata={null}
            canApprovePermissions={true}
        />);

        expect(screen.findByTestId('user-action-prompt-view-tool')).toBeNull();
        expect(routerPush).not.toHaveBeenCalled();
    });

    it('does not render when the session is inactive', async () => {
        const { UserActionPromptCard } = await import('./UserActionPromptCard');

        const request = {
            id: 'ua1',
            tool: 'ask_user',
            kind: 'user_action',
            arguments: { question: 'Continue?' },
        } as PendingPermissionRequest;

        const screen = await renderScreen(
            <UserActionPromptCard
                request={request}
                location={null}
                sessionId="session-1"
                metadata={null}
                canApprovePermissions={false}
                disabledReason="inactive"
            />,
        );

        expect(screen.findAllByTestId('user-action-prompt-card')).toHaveLength(0);
    });

    it('uses the distinct Action confirmation presentation for canonical Action requests', async () => {
        const { UserActionPromptCard } = await import('./UserActionPromptCard');

        const screen = await renderScreen(
            <UserActionPromptCard
                request={{
                    id: 'action:request-1',
                    tool: 'Happier Action confirmation',
                    kind: 'user_action',
                    source: 'happier_action',
                    arguments: {
                        actionId: 'session.title.set',
                        preview: { summary: 'Rename this session' },
                        sessionId: 'session-1',
                        turnId: 'turn-1',
                    },
                    createdAt: 1,
                    turnId: 'turn-1',
                }}
                location={null}
                sessionId="session-1"
                metadata={null}
                canApprovePermissions={true}
            />,
        );

        expect(screen.findByTestId('action-confirmation-prompt-card')).toBeTruthy();
        expect(screen.findByTestId('user-action-prompt-card')).toBeNull();
    });
});
