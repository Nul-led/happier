import * as React from 'react';

import {
    normalizeActionApprovalRegistration,
    type ActionApprovalRegistration,
    type ActionApprovalTerminalStatus,
} from './actionApprovalContinuation';
import { useApprovalArtifact } from './useApprovalArtifact';

const PENDING_STATUSES = new Set(['open', 'approved', 'executing']);
const TERMINAL_FAILURE_STATUSES = new Set<ActionApprovalTerminalStatus>([
    'rejected',
    'failed',
    'canceled',
]);

/**
 * Shared process-local presentation and result-custody owner for one Action approval.
 * Durable lifecycle stays in the approval Artifact; this hook only reconnects an
 * already executed result to the still-mounted operation that requested it.
 */
export function useActionApprovalContinuation(input: Readonly<{
    scopeKey: string;
    serverId: string;
    onExecuted: () => void;
}>) {
    const [approval, setApproval] = React.useState<Readonly<{
        artifactId: string;
        scopeKey: string;
        continuation: ReturnType<typeof normalizeActionApprovalRegistration>['continuation'];
    }> | null>(null);
    const approvalId = approval?.scopeKey === input.scopeKey ? approval.artifactId : null;
    const currentScopeKeyRef = React.useRef(input.scopeKey);
    currentScopeKeyRef.current = input.scopeKey;
    const settledScopeKeyRef = React.useRef(input.scopeKey);
    const onExecutedRef = React.useRef(input.onExecuted);
    onExecutedRef.current = input.onExecuted;
    const claimedArtifactIdRef = React.useRef<string | null>(null);
    const settlementRef = React.useRef<
        | Readonly<{
            kind: 'executed';
            artifact: NonNullable<ReturnType<typeof useApprovalArtifact>['artifact']>;
            continuation: NonNullable<ReturnType<typeof normalizeActionApprovalRegistration>['continuation']> | null;
        }>
        | Readonly<{
            kind: 'terminal';
            status: ActionApprovalTerminalStatus;
            artifact: NonNullable<ReturnType<typeof useApprovalArtifact>['artifact']> | null;
            continuation: NonNullable<ReturnType<typeof normalizeActionApprovalRegistration>['continuation']> | null;
        }>
        | null
    >(null);
    const artifactBinding = useApprovalArtifact({ artifactId: approvalId, serverId: input.serverId });
    const approvalStatus = artifactBinding.artifact?.header?.approvalStatus;
    const awaitingTypedBody = approval?.continuation !== null
        && (approvalStatus === 'executed' || TERMINAL_FAILURE_STATUSES.has(approvalStatus as ActionApprovalTerminalStatus))
        && typeof artifactBinding.artifact?.body !== 'string';
    const approvalPending = approvalId !== null
        && (approvalStatus === undefined || PENDING_STATUSES.has(String(approvalStatus)) || awaitingTypedBody);

    React.useEffect(() => {
        if (settledScopeKeyRef.current === input.scopeKey) return;
        settledScopeKeyRef.current = input.scopeKey;
        claimedArtifactIdRef.current = null;
        settlementRef.current = null;
        setApproval(null);
    }, [input.scopeKey]);

    const requestApproval = React.useCallback((registration: ActionApprovalRegistration) => {
        if (currentScopeKeyRef.current !== input.scopeKey) return;
        const normalized = normalizeActionApprovalRegistration(registration);
        claimedArtifactIdRef.current = null;
        setApproval({ ...normalized, scopeKey: input.scopeKey });
    }, [input.scopeKey]);

    React.useEffect(() => {
        if (approvalId === null || claimedArtifactIdRef.current === approvalId) return;
        if (approvalStatus === 'executed') {
            const artifact = artifactBinding.artifact;
            if (approval?.continuation && (!artifact || typeof artifact.body !== 'string')) return;
            claimedArtifactIdRef.current = approvalId;
            settlementRef.current = {
                kind: 'executed',
                artifact: artifact!,
                continuation: approval?.continuation ?? null,
            };
            setApproval(null);
            return;
        }
        const terminalStatus: ActionApprovalTerminalStatus | null = artifactBinding.invalidArtifact
            ? 'invalid'
            : TERMINAL_FAILURE_STATUSES.has(approvalStatus as ActionApprovalTerminalStatus)
                ? approvalStatus as ActionApprovalTerminalStatus
                : null;
        if (terminalStatus) {
            const artifact = artifactBinding.artifact;
            if (approval?.continuation && terminalStatus !== 'invalid' && (!artifact || typeof artifact.body !== 'string')) return;
            claimedArtifactIdRef.current = approvalId;
            settlementRef.current = {
                kind: 'terminal',
                status: terminalStatus,
                artifact: artifact ?? null,
                continuation: approval?.continuation ?? null,
            };
            setApproval(null);
        }
    }, [approval, approvalId, approvalStatus, artifactBinding.artifact, artifactBinding.invalidArtifact]);

    React.useEffect(() => {
        if (approval !== null || settlementRef.current === null) return;
        const settlement = settlementRef.current;
        settlementRef.current = null;
        if (settlement.kind === 'terminal') {
            try {
                settlement.continuation?.onTerminal?.(settlement.status, settlement.artifact);
            } catch {
                // Terminal settlement already released the operation for retry.
            }
            return;
        }
        onExecutedRef.current();
        if (settlement.continuation) {
            void settlement.continuation.onExecuted(settlement.artifact).catch(() => {
                // The operation-specific continuation owns its visible failure
                // state. Custody is intentionally once-only: never replay an
                // already executed mutation because a UI callback threw.
            });
        }
    }, [approval]);

    return {
        ...artifactBinding,
        approvalId,
        approvalStatus,
        approvalPending,
        requestApproval,
    };
}
