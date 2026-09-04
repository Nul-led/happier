export type HomeApprovalGateEvaluationFacts = Readonly<{
    accountId: string;
    issuerServerIdentityId: string;
    issuerSubjectId: string;
    requesterBoxPublicKeyBase64: string;
    approvalBindingProof: string;
    assertionExpiresAtMs?: number;
    deviceLabel: string | null;
    approvalId?: string;
}>;

export type HomeApprovalGateEvaluationResult =
    | { kind: "allowed"; approvedRequest?: { approvalId: string; bindingProof: string } }
    | { kind: "approval_required"; request: { approvalId: string; deviceLabel: string | null; expiresAtMs: number } }
    | { kind: "rejected" | "expired" | "invalid" };

/** The narrow Home-owned approval seam consumed by Account assertion redemption. */
export type HomeApprovalGate = Readonly<{
    evaluate: (
        facts: HomeApprovalGateEvaluationFacts,
    ) => Promise<HomeApprovalGateEvaluationResult>;
}>;
