import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('applyVoiceSessionTargetSelection', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('trims the control session id before syncing the target selection', async () => {
        const { applyVoiceSessionTargetSelection } = await import('./applyVoiceSessionTargetSelection');
        const { voiceSessionBindingManager } = await import('./voiceConversationBindingRuntime');
        const { useVoiceTargetStore } = await import('@/voice/runtime/voiceTargetStore');

        const syncTargetSessionSpy = vi.spyOn(voiceSessionBindingManager, 'syncTargetSession');

        await applyVoiceSessionTargetSelection({
            controlSessionId: '  voice-global  ',
            targetSessionAddress: { serverId: ' server-a ', sessionId: '  s1  ' },
            updateLastFocused: true,
        });

        expect(useVoiceTargetStore.getState().primaryActionSessionAddress).toEqual({ serverId: 'server-a', sessionId: 's1' });
        expect(useVoiceTargetStore.getState().lastFocusedSessionAddress).toEqual({ serverId: 'server-a', sessionId: 's1' });
        expect(syncTargetSessionSpy).toHaveBeenCalledWith({
            controlSessionId: 'voice-global',
            targetSessionAddress: { serverId: 'server-a', sessionId: 's1' },
        });
    });

});
