import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { voiceSessionBindingManager } from '@/voice/binding/voiceConversationBindingRuntime';
import type { VoiceSessionBinding } from '@/voice/binding/voiceConversationBindingTypes';

export async function ensureDefaultLocalVoiceQaBinding(params: Readonly<{
  controlSessionId: string;
  requestedTargetSessionAddress?: SessionAddress | null;
}>): Promise<VoiceSessionBinding | null> {
  return await voiceSessionBindingManager.ensureBound({
    adapterId: 'local_conversation',
    controlSessionId: params.controlSessionId,
    requestedTargetSessionId: params.requestedTargetSessionAddress?.sessionId ?? null,
    requestedTargetServerId: params.requestedTargetSessionAddress?.serverId ?? null,
  });
}
