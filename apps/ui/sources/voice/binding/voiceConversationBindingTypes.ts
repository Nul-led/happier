import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

export type VoiceConversationTranscriptMode = 'native_session' | 'synthetic';

export type VoiceSessionBinding = Readonly<{
    adapterId: string;
    controlSessionId: string;
    conversationSessionId: string;
    conversationSessionAddress: SessionAddress;
    lifetime?: 'runtime_attempt';
    transcriptMode: VoiceConversationTranscriptMode;
    targetSessionAddress: SessionAddress | null;
    updatedAt: number;
}>;

export type VoiceConversationBindingResolution = Readonly<{
    controlSessionId: string;
    conversationSessionId: string;
    conversationSessionAddress: SessionAddress;
    transcriptMode: VoiceConversationTranscriptMode;
    targetSessionAddress: SessionAddress | null;
}>;
