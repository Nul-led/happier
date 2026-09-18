import { storage } from '@/sync/domains/state/storage';
import { getVoiceContextFormatterPrefs } from '@/voice/context/voiceContextPrefs';
import { resolveVoiceSessionLabel } from '@/voice/context/resolveVoiceSessionLabel';
import { appendVoiceConversationNoteText } from '@/voice/transcript/voiceConversationTranscript';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

function resolveSessionLabel(address: SessionAddress): string {
    const state: any = storage.getState();
    const prefs = getVoiceContextFormatterPrefs({ settings: state.settings });
    return resolveVoiceSessionLabel(address, prefs, { fallbackLabel: 'the current session' });
}

export function appendVoiceTargetSessionSwitchNote(params: Readonly<{
    conversationSessionId: string;
    previousTargetSessionAddress: SessionAddress | null;
    targetSessionAddress: SessionAddress | null;
}>): void {
    const nextLabel = params.targetSessionAddress ? resolveSessionLabel(params.targetSessionAddress) : 'none';
    const previousLabel = params.previousTargetSessionAddress
        ? resolveSessionLabel(params.previousTargetSessionAddress).replace(/^the current session$/, 'the previous session')
        : null;
    const text = previousLabel
        ? `Target session changed from ${previousLabel} to ${nextLabel}`
        : `Target session set to ${nextLabel}`;
    appendVoiceConversationNoteText({
        conversationSessionId: params.conversationSessionId,
        text,
    });
}
