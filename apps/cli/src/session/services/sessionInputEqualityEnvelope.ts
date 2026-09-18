/** Immutable authored intent, before target defaults or protected-authority substitution. */
export function buildImmutableSessionInputEqualityEnvelopeV1(params: Readonly<{
  localId: string;
  record: Readonly<Record<string, unknown>>;
  pendingAdmissionMode?: 'continuation_if_no_queued_user_input';
}>): Record<string, unknown> {
  return {
    v: 1,
    kind: 'sessionInputRequest',
    localId: params.localId,
    content: { t: 'plain', v: params.record },
    ...(params.pendingAdmissionMode ? { pendingAdmissionMode: params.pendingAdmissionMode } : {}),
  };
}
