import { applySendToSessionTemplate } from '@/components/sessions/transcript/messageSelection/applySendToSessionTemplate';
import type { SessionInitialPromptV1 } from '@/sync/domains/sessionInitialPrompt/sessionInitialPromptV1';

/**
 * ⋯ → Send to ⟨lead⟩ (lab `convo-C1`/`D1`): the run's result goes into the lead Session's composer as
 * the person's own message, through the canonical selection-to-Session initial-prompt handoff (the
 * same one a transcript or discussion selection uses). Nothing is sent: the person reads, edits and
 * sends it. The initial-prompt consumer owns append and currentness.
 */
export async function sendExecutionRunResultToSession(params: Readonly<{
    sessionId: string;
    serverId: string;
    resultText: string;
    /** The run's title, offered to the person's send-to-session template as its source. */
    runTitle: string | null;
    template: string;
    nowMs: () => number;
    writeInitialPrompt: (input: Readonly<{ destinationSessionId: string; serverId: string; prompt: SessionInitialPromptV1 }>) => Promise<void>;
    revealPrimaryComposer: () => void | Promise<void>;
    focusPrimaryComposer: () => boolean | void | Promise<boolean | void>;
}>): Promise<boolean> {
    const resultText = params.resultText.trim();
    if (!resultText) return false;
    const promptText = applySendToSessionTemplate({
        template: params.template,
        formattedMessages: resultText,
        selectedCount: 1,
        sourceSessionName: params.runTitle,
    });
    if (!promptText.trim()) return false;
    await params.writeInitialPrompt({
        destinationSessionId: params.sessionId,
        serverId: params.serverId,
        prompt: {
            v: 1,
            text: promptText,
            mode: 'append',
            createdAtMs: params.nowMs(),
            sourceSessionId: params.sessionId,
        },
    });
    await params.revealPrimaryComposer();
    await params.focusPrimaryComposer();
    return true;
}
