import type { VoiceSessionStatus } from '@/voice/session/types';
import { resolveVoiceActionTargetAddress, type VoiceAssistantScope } from '@/voice/runtime/voiceTargetStore';
import { areSessionAddressesEqual, type SessionAddress } from '@/sync/domains/session/sessionAddress';

export function deriveSessionMicActive(opts: Readonly<{
  voiceStatus: VoiceSessionStatus;
  scope: VoiceAssistantScope;
  sessionAddress: SessionAddress;
  primaryActionSessionAddress: SessionAddress | null;
  lastFocusedSessionAddress: SessionAddress | null;
}>): boolean {
  if (opts.voiceStatus === 'disconnected') return false;

  return areSessionAddressesEqual(resolveVoiceActionTargetAddress({
    scope: opts.scope,
    currentSessionAddress: opts.scope === 'session' ? opts.sessionAddress : null,
    primaryActionSessionAddress: opts.primaryActionSessionAddress,
    lastFocusedSessionAddress: opts.lastFocusedSessionAddress,
  }), opts.sessionAddress);
}
