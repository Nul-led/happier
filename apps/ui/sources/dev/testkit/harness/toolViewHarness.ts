import * as React from 'react';
import type { Message, ToolCall } from "@happier-dev/session-core/messages";
import type { Metadata } from '@happier-dev/session-core/state';

import { flushHookEffects, type FlushHookEffectsOptions } from '../hooks/flushHookEffects';
import { renderScreen, type RenderScreenResult } from '../render/renderScreen';
import { createTestSessionTranscriptSource, wrapWithSessionTranscriptSource } from '../sessionTranscriptSource';
import type { SessionTranscriptSource } from '@/components/sessions/transcript/source/types';
import type { TranscriptPermissionDisabledReason } from '@/utils/sessions/deriveTranscriptInteraction';

type ToolInteractionState = Readonly<{
    canSendMessages: boolean;
    canApprovePermissions: boolean;
    permissionDisabledReason?: TranscriptPermissionDisabledReason;
}>;

export type ToolViewHarnessOptions = Readonly<{
    source?: SessionTranscriptSource;
    tool: ToolCall;
    metadata?: Metadata | null;
    messages?: Message[];
    onPress?: () => void;
    sessionId?: string;
    messageId?: string;
    forcePermissionPromptsInTranscript?: boolean;
    interaction?: ToolInteractionState;
}>;

export type ToolViewHarness = RenderScreenResult & Readonly<{
    findSubtitle: () => ReturnType<RenderScreenResult['findByTestId']>;
    findPermissionFooter: () => ReturnType<RenderScreenResult['findByTestId']>;
    findSpecificToolView: () => ReturnType<RenderScreenResult['findByTestId']>;
    settle: (options?: FlushHookEffectsOptions) => Promise<void>;
}>;

export async function renderToolView(options: ToolViewHarnessOptions): Promise<ToolViewHarness> {
    const { ToolView } = await import('@/components/tools/shell/views/ToolView');
    const source = options.source ?? createTestSessionTranscriptSource({
        sessionId: options.sessionId,
        messages: options.messages,
        metadata: options.metadata,
        interaction: options.interaction,
    });
    const screen = await renderScreen(
        wrapWithSessionTranscriptSource(React.createElement(ToolView, {
            tool: options.tool,
            metadata: options.metadata ?? null,
            messages: options.messages ?? [],
            onPress: options.onPress,
            sessionId: options.sessionId,
            messageId: options.messageId,
            forcePermissionPromptsInTranscript: options.forcePermissionPromptsInTranscript,
            interaction: options.interaction,
        }), source),
    );

    return {
        ...screen,
        update: (element) => screen.update(wrapWithSessionTranscriptSource(element, source)),
        findSubtitle: () => screen.findByTestId('tool-card-subtitle'),
        findPermissionFooter: () => screen.findByTestId('tool-permission-footer'),
        findSpecificToolView: () => screen.findByTestId('specific-tool-view'),
        settle: async (flushOptions) => {
            await flushHookEffects(flushOptions);
        },
    };
}
