export const EPHEMERAL_RUNNER_ARTIFACTS_PATH_V1 = '/v1/ephemeral-runners/artifacts' as const;
export const EPHEMERAL_RUNNER_CREATOR_RECIPIENT_PATH_V1 = '/v1/ephemeral-runners/creator-recipient' as const;
export const EPHEMERAL_RUNNER_ACTIVATIONS_PATH_V1 = '/v1/ephemeral-runners/activations' as const;
export function ephemeralRunnerActivationPathV1(activationId: string): string {
  return `${EPHEMERAL_RUNNER_ACTIVATIONS_PATH_V1}/${encodeURIComponent(activationId)}`;
}
export function ephemeralRunnerEndpointPathV1(
  activationId: string,
  operation: 'claim' | 'projection' | 'facts' | 'consent' | 'readiness',
): string {
  return `${ephemeralRunnerActivationPathV1(activationId)}/endpoint/${operation}`;
}

export function ephemeralRunnerActivationReviewPathV1(activationId: string): string {
  return `${ephemeralRunnerActivationPathV1(activationId)}/review`;
}

export function ephemeralRunnerCredentialSelectionPathV1(activationId: string): string {
  return `${ephemeralRunnerActivationPathV1(activationId)}/credential-selection`;
}

export function ephemeralRunnerMaterializationPathV1(activationId: string): string {
  return `${ephemeralRunnerActivationPathV1(activationId)}/session`;
}
