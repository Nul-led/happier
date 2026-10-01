import type { ScmProjectInFlightOperation, ScmProjectOperationKind, ScmProjectOperationLogEntry } from '@/sync/runtime/orchestration/projectManager';
import { normalizeScmOperationOutcome, type ScmOperationOutcome } from '@happier-dev/protocol/scm';

/**
 * The pane's one outcome: what is running, or the last write's terminal result. `id` names the operation (a
 * dismissed outcome stays dismissed until another one replaces it); `at` is when it started or ended. Copy is
 * the UI's: this projection carries facts, never English sentences.
 */
type OperationFacts = Readonly<{ action: ScmProjectOperationKind; id: string; at: number; machine?: string; provider?: string }>;
export type ScmWriteTerminalOperation = {
    [Kind in ScmOperationOutcome['kind']]: OperationFacts & Readonly<{
        phase: Kind;
        outcome: Extract<ScmOperationOutcome, { kind: Kind }>;
        message: string;
        result?: { sha?: string; url?: string };
    }>
}[ScmOperationOutcome['kind']];
export type ScmWriteOperation =
    | (OperationFacts & (
        | Readonly<{ phase: 'queued'; progressText?: string }>
        | Readonly<{ phase: 'running'; progressText?: string }>
    ))
    | ScmWriteTerminalOperation;

/** Bookkeeping, not a write the user made: a successful refresh or a selection toggle never replaces the outcome. */
const QUIET_ON_SUCCESS: ReadonlySet<ScmProjectOperationKind> = new Set(['refresh', 'stage', 'unstage']);

export function selectScmWriteOperation(input: Readonly<{
    inFlight: ScmProjectInFlightOperation | null;
    log: readonly ScmProjectOperationLogEntry[];
    machine?: string;
    provider?: string;
    machineReachable: boolean;
}>): ScmWriteOperation | null {
    const current = input.inFlight;
    if (current) {
        return {
            phase: current.phase,
            action: current.operation,
            id: current.id,
            at: current.startedAt,
            ...(current.progressText ? { progressText: current.progressText } : {}),
        };
    }
    const latest = input.log.find((entry) => !((entry.outcome?.kind ?? (entry.status === 'success' ? 'succeeded' : 'failed')) === 'succeeded' && QUIET_ON_SUCCESS.has(entry.operation)));
    if (!latest) return null;
    const outcome = normalizeScmOperationOutcome({
        success: latest.status === 'success',
        outcome: latest.outcome,
        errorCode: latest.errorCode,
        error: latest.detail,
        // Existing successful commit entries store the returned SHA in detail, never a diagnostic.
        ...(latest.operation === 'commit' && latest.status === 'success' && latest.detail ? { commitSha: latest.detail } : {}),
    });
    const effect = 'effect' in outcome ? outcome.effect : undefined;
    const result = effect?.kind === 'commit' ? { sha: effect.commitSha }
        : effect?.kind === 'pull_request' ? { url: effect.url } : undefined;
    const facts = {
        action: latest.operation, id: latest.id, at: latest.timestamp,
        message: outcome.message ?? latest.detail ?? '',
        ...(result ? { result } : {}),
        ...('errorCode' in outcome && outcome.errorCode === 'REMOTE_AUTH_REQUIRED' && input.machine ? { machine: input.machine } : {}),
        ...('errorCode' in outcome && outcome.errorCode === 'REMOTE_AUTH_REQUIRED' && input.provider ? { provider: input.provider } : {}),
    };
    switch (outcome.kind) {
        case 'succeeded': return { ...facts, phase: outcome.kind, outcome };
        case 'needs_input': return { ...facts, phase: outcome.kind, outcome };
        case 'conflicted': return { ...facts, phase: outcome.kind, outcome };
        case 'effect_applied_with_warning': return { ...facts, phase: outcome.kind, outcome };
        case 'failed': return { ...facts, phase: outcome.kind, outcome };
        case 'cancelled': return { ...facts, phase: outcome.kind, outcome };
        case 'outcome_unknown': return { ...facts, phase: outcome.kind, outcome };
    }
}
