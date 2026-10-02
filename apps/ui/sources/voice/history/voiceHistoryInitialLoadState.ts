import { isVoiceHistoryOperationSupersededError } from './voiceHistoryConsumer';

export { isVoiceHistoryOperationSupersededError } from './voiceHistoryConsumer';

export type VoiceHistoryInitialLoadFailureState =
  | 'error'
  | 'superseded';

export function resolveVoiceHistoryInitialLoadFailureState(
  error: unknown,
): VoiceHistoryInitialLoadFailureState {
  if (isVoiceHistoryOperationSupersededError(error)) return 'superseded';
  return 'error';
}
