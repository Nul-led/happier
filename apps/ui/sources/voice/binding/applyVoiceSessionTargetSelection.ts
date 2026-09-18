import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { normalizeNonEmptyString } from '@/voice/shared/normalizeNonEmptyString';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

import { voiceSessionBindingManager } from './voiceConversationBindingRuntime';

export async function applyVoiceSessionTargetSelection(params: Readonly<{
    controlSessionId: string;
    targetSessionAddress: SessionAddress | null | undefined;
    updateLastFocused: boolean;
}>): Promise<void> {
    const controlSessionId = normalizeNonEmptyString(params.controlSessionId);
    const targetSessionAddress = params.targetSessionAddress
        ? normalizeSessionAddress(
            params.targetSessionAddress.serverId,
            params.targetSessionAddress.sessionId,
        )
        : null;
    if (!controlSessionId) return;
    await voiceSessionBindingManager.syncTargetSession({
        controlSessionId,
        targetSessionAddress,
    });
    if (params.updateLastFocused) {
        useVoiceTargetStore.getState().setLastFocusedSessionAddress(targetSessionAddress);
    }
    useVoiceTargetStore.getState().setPrimaryActionSessionAddress(targetSessionAddress);
}
