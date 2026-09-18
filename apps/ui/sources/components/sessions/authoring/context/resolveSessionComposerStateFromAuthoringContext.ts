import type { LiveSessionAuthoringContext } from './sessionAuthoringContext';
import { resolveSessionComposerState, type SessionComposerState } from './resolveSessionComposerState';

export type SessionComposerAuthoringContext = LiveSessionAuthoringContext;

export function resolveSessionComposerStateFromAuthoringContext(
    context: SessionComposerAuthoringContext,
    params?: Readonly<{
        fallbackAgentId?: string | null;
    }>,
): SessionComposerState {
    return resolveSessionComposerState({
        snapshot: context.snapshot,
        session: context.session,
        fallbackAgentId: params?.fallbackAgentId ?? null,
    });
}
