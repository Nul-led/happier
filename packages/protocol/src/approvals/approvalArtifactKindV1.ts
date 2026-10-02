/** Approval Artifact identities shared by their writers, readers, and generic content admission. */
export const APPROVAL_ARTIFACT_KINDS_V1 = Object.freeze({
  builtIn: 'approval_request.v1',
  targetAction: 'target_action_approval.v1',
  executionRunHostAction: 'execution_run_host_action_approval.v1',
} as const);

export function isApprovalArtifactKindV1(kind: unknown): boolean {
  return Object.values(APPROVAL_ARTIFACT_KINDS_V1).some((candidate) => candidate === kind);
}
