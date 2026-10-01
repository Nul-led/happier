import * as React from 'react';
import { createReadOnlySessionTranscriptSource } from '@/components/sessions/transcript/source/readOnlySessionTranscriptSource';
import { SessionTranscriptSourceProvider } from '@/components/sessions/transcript/source/SessionTranscriptSourceContext';
import type { SessionTranscriptSource } from '@/components/sessions/transcript/source/types';
import type { Message } from '@happier-dev/session-core/messages';
import type { AgentState, Metadata } from '@happier-dev/session-core/state';
import type { TranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { renderScreen } from './render/renderScreen';
import { renderHook, type RenderHookOptions } from './hooks/renderHook';

export function createTestSessionTranscriptSource(input: Readonly<{
    sessionId?: string;
    serverId?: string | null;
    messages?: readonly Message[];
    reducerState?: ReturnType<SessionTranscriptSource['useReducerState']>;
    agentState?: AgentState | null;
    metadata?: Metadata | null;
    workspacePath?: string | null;
    authorship?: ReturnType<SessionTranscriptSource['useAuthorship']>;
    forkSupportSource?: ReturnType<SessionTranscriptSource['useForkSupportSource']>;
    interaction?: TranscriptInteraction;
    actions?: SessionTranscriptSource['actions'];
    navigate?: SessionTranscriptSource['navigate'];
    history?: Partial<SessionTranscriptSource['history']>;
    loadSidechain?: SessionTranscriptSource['loadSidechain'];
}> = {}): SessionTranscriptSource & Pick<ReturnType<typeof createReadOnlySessionTranscriptSource>, 'update'> {
    const source = createReadOnlySessionTranscriptSource({
        sessionId: input.sessionId ?? 's1', serverId: input.serverId,
        messages: input.messages ?? [], agentState: input.agentState ?? null,
        metadata: input.metadata ?? null, reducerState: input.reducerState ?? null,
        workspacePath: input.workspacePath,
        authorship: input.authorship ? { viewerScope: null, hasOtherNamedCollaborator: input.authorship.hasOtherNamedCollaborator } : undefined,
    });
    return {
        ...source,
        useInteraction: input.interaction ? () => input.interaction! : source.useInteraction,
        actions: input.actions ?? null,
        navigate: input.navigate ?? null,
        loadSidechain: input.loadSidechain ?? null,
        history: { ...source.history, ...input.history },
        useAuthorship: input.authorship ? () => input.authorship! : source.useAuthorship,
        useForkSupportSource: input.forkSupportSource ? () => input.forkSupportSource! : source.useForkSupportSource,
    };
}

export function wrapWithSessionTranscriptSource(element: React.ReactElement, source: SessionTranscriptSource = createTestSessionTranscriptSource()) {
    return <SessionTranscriptSourceProvider source={source}>{element}</SessionTranscriptSourceProvider>;
}

export async function renderWithSessionTranscriptSource(element: React.ReactElement, source: SessionTranscriptSource = createTestSessionTranscriptSource()) {
    const screen = await renderScreen(wrapWithSessionTranscriptSource(element, source));
    const update = screen.update;
    // Keep the same real renderer/provider lifetime when a fixture updates its child.
    Object.assign(screen, { update: (nextElement: React.ReactElement) => update(wrapWithSessionTranscriptSource(nextElement, source)) });
    return screen;
}

export async function renderHookWithSessionTranscriptSource<Value, Props = void>(
    useValue: (props: Props) => Value,
    options: Partial<RenderHookOptions<Props>> & Readonly<{ source?: SessionTranscriptSource }> = {},
) {
    let source = options.source ?? createTestSessionTranscriptSource();
    const hook = await renderHook(useValue, {
        ...options,
        wrapper: (props) => {
            const content = wrapWithSessionTranscriptSource(props.children as React.ReactElement, source);
            return options.wrapper ? React.createElement(options.wrapper, null, content) : content;
        },
    });
    return {
        ...hook,
        rerender: (nextProps?: Props, nextSource = source) => {
            source = nextSource;
            return hook.rerender(nextProps);
        },
    };
}
