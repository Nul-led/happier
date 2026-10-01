import * as React from 'react';

import type { ToolCallMessage } from "@happier-dev/session-core/messages";
import type { PersistedSessionMessagePinV1 } from "@happier-dev/session-core/pins";
import type { Metadata } from '@happier-dev/session-core/state';
import type { TranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import type { ToolCallsGroupStatus } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupChrome';

import { renderScreen, type RenderScreenResult } from '../render/renderScreen';
import { createTestSessionTranscriptSource, wrapWithSessionTranscriptSource } from '../sessionTranscriptSource';
import type { SessionTranscriptSource } from '@/components/sessions/transcript/source/types';

const defaultTranscriptInteraction: TranscriptInteraction = {
    canSendMessages: true,
    canApprovePermissions: true,
};

export type ToolCallsGroupHarnessOptions = Readonly<{
    source?: SessionTranscriptSource;
    id?: string;
    status?: ToolCallsGroupStatus;
    toolMessages: ToolCallMessage[];
    metadata?: Metadata | null;
    sessionId?: string;
    forcePermissionPromptsInTranscript?: boolean;
    expanded?: boolean;
    setExpanded?: (expanded: boolean) => void;
    messagePins?: readonly PersistedSessionMessagePinV1[];
    onToggleToolPin?: (pin: PersistedSessionMessagePinV1) => void;
    interaction?: TranscriptInteraction;
}>;

export async function renderToolCallsGroupView(
    options: ToolCallsGroupHarnessOptions,
): Promise<RenderScreenResult> {
    const { ToolCallsGroupView } = await import('@/components/sessions/transcript/turns/toolCalls/ToolCallsGroupView');
    const source = options.source ?? createTestSessionTranscriptSource({
        sessionId: options.sessionId,
        messages: options.toolMessages,
        metadata: options.metadata,
        interaction: options.interaction ?? defaultTranscriptInteraction,
    });

    const screen = await renderScreen(
        wrapWithSessionTranscriptSource(React.createElement(ToolCallsGroupView, {
            id: options.id ?? 'toolCalls:1',
            status: options.status ?? 'running',
            toolMessages: options.toolMessages,
            metadata: options.metadata ?? null,
            sessionId: options.sessionId ?? 's1',
            forcePermissionPromptsInTranscript: options.forcePermissionPromptsInTranscript,
            expanded: options.expanded ?? false,
            setExpanded: options.setExpanded ?? (() => {}),
            messagePins: options.messagePins,
            onToggleToolPin: options.onToggleToolPin,
            interaction: options.interaction ?? defaultTranscriptInteraction,
        }), source),
    );
    return { ...screen, update: (element) => screen.update(wrapWithSessionTranscriptSource(element, source)) };
}

export async function renderStatefulToolCallsGroupView(
    options: ToolCallsGroupHarnessOptions,
): Promise<RenderScreenResult> {
    const { ToolCallsGroupView } = await import('@/components/sessions/transcript/turns/toolCalls/ToolCallsGroupView');
    const source = options.source ?? createTestSessionTranscriptSource({
        sessionId: options.sessionId,
        messages: options.toolMessages,
        metadata: options.metadata,
        interaction: options.interaction ?? defaultTranscriptInteraction,
    });

    function Harness(): React.ReactElement {
        const [expanded, setExpanded] = React.useState(options.expanded ?? false);

        return React.createElement(ToolCallsGroupView, {
            id: options.id ?? 'toolCalls:1',
            status: options.status ?? 'running',
            toolMessages: options.toolMessages,
            metadata: options.metadata ?? null,
            sessionId: options.sessionId ?? 's1',
            forcePermissionPromptsInTranscript: options.forcePermissionPromptsInTranscript,
            expanded,
            setExpanded,
            messagePins: options.messagePins,
            onToggleToolPin: options.onToggleToolPin,
            interaction: options.interaction ?? defaultTranscriptInteraction,
        });
    }

    return renderScreen(wrapWithSessionTranscriptSource(React.createElement(Harness), source));
}
