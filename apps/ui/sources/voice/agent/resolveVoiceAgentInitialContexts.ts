import { buildVoiceInitialContext } from '@/voice/context/buildVoiceInitialContext';
import { normalizeNonEmptyString } from '@/voice/shared/normalizeNonEmptyString';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

export function resolveVoiceAgentInitialContexts(
  sessionId: string,
  options?: Readonly<{
    targetSessionId?: string | null;
    targetSessionAddress?: SessionAddress | null;
  }>,
): Readonly<{
  bootstrapInitialContext: string;
  deferredTargetSessionContext: string;
}> {
  const targetSessionAddress = options?.targetSessionAddress ?? null;
  const targetSessionId = normalizeNonEmptyString(
    targetSessionAddress?.sessionId ?? options?.targetSessionId,
  );
  const targetOptions = targetSessionAddress
    ? { targetSessionAddress }
    : { targetSessionId };
  if (targetSessionId && targetSessionId !== sessionId) {
    return {
      bootstrapInitialContext: buildVoiceInitialContext(sessionId),
      deferredTargetSessionContext: buildVoiceInitialContext(sessionId, targetOptions),
    };
  }

  return {
    bootstrapInitialContext: buildVoiceInitialContext(sessionId, targetOptions),
    deferredTargetSessionContext: '',
  };
}
