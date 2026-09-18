import {
  WorkflowRunInvocationIndexV1Schema,
  type WorkflowInvocationLifecycleV1,
  type WorkflowRunInvocationIndexV1,
  type WorkflowRunOriginV1,
  type WorkflowRunStateV1,
  type WorkflowRunSummaryV1,
} from '@happier-dev/protocol';

/**
 * In-memory stand-in for the server's opaque Workflow Run storage owner.
 *
 * This is a **system boundary** fake: the real owner is reached over HTTP and
 * backed by PostgreSQL/SQLite. It stores sealed envelope bytes and public index
 * columns only, exactly as the server does, and never opens, interprets, or
 * recomputes Workflow content. It therefore lets a test destroy and rebuild the
 * daemon-side coordinator/store readers over the same durable bytes without
 * reimplementing any coordinator decision.
 *
 * It deliberately keeps the server's real concurrency contracts — parent
 * revision CAS, per-row lifecycle CAS, newest-attempt-per-member-slot parent
 * pages, and keyset paging — because those are what daemon reconstruction has
 * to survive.
 */

const TERMINAL_RUN_STATES = [
  'succeeded', 'failed', 'cancelled', 'expired', 'dispatch_failed', 'skipped', 'missed', 'outcome_uncertain',
] as const satisfies readonly WorkflowRunStateV1[];

/** Mirrors the server's indexed actionable-invocation attention predicate. */
const ATTENTION_LIFECYCLES = [
  'waiting_for_approval', 'needs_attention', 'cancel_requested', 'outcome_uncertain',
] as const satisfies readonly WorkflowInvocationLifecycleV1[];

const CANCELLABLE_LIFECYCLES = [
  'pending', 'waiting_for_capacity', 'admitting', 'running', 'waiting_for_approval', 'needs_attention',
] as const satisfies readonly WorkflowInvocationLifecycleV1[];

/**
 * The server refuses to move a settled row back to an active lifecycle and
 * only reconciles its sealed bytes. Reproducing that here is what makes a
 * fresh-process reconstruction test honest.
 */
const TERMINAL_INVOCATION_LIFECYCLES = [
  'completed', 'failed', 'skipped', 'cancelled', 'outcome_uncertain', 'superseded',
] as const satisfies readonly WorkflowInvocationLifecycleV1[];

type StoredRow = {
  index: WorkflowRunInvocationIndexV1;
  contentEnvelope: string;
};

/** Matches the transport's own untyped request shape so the kit is assignable wherever it is used. */
export type WorkflowRunStorageTestkitOperation = Readonly<Record<string, unknown>>;

export type WorkflowRunStorageTestkit = Readonly<{
  execute: (operation: WorkflowRunStorageTestkitOperation, options?: Readonly<{ signal?: AbortSignal }>) => Promise<unknown>;
  /** Every operation the daemon or Action host sent, in order. */
  calls: readonly WorkflowRunStorageTestkitOperation[];
  operations: () => readonly string[];
  run: () => WorkflowRunSummaryV1;
  rows: () => readonly StoredRow[];
  rowById: (invocationId: string) => StoredRow | undefined;
  acceptedEnvelope: () => string | null;
  checkpointEnvelope: () => string | null;
  resultEnvelope: () => string | null;
  /** Applies an out-of-band control exactly as an authorized Action caller would. */
  requestControl: (state: Extract<WorkflowRunStateV1, 'pause_requested' | 'cancelled'> | 'cancel_requested') => void;
}>;

function storageError(code: string): Error {
  return Object.assign(new Error(code), { response: { status: 409, data: { error: code } } });
}

function notFound(): Error {
  return Object.assign(new Error('not_found'), { response: { status: 404, data: { error: 'run_not_found' } } });
}

function encodeCursor(after: string): string {
  return Buffer.from(JSON.stringify({ after }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: unknown): string | null {
  if (typeof cursor !== 'string') return null;
  const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  const after = (parsed as { after?: unknown }).after;
  return typeof after === 'string' ? after : null;
}

export function createWorkflowRunStorageTestkit(params: Readonly<{
  runId: string;
  machineId: string;
  origin: WorkflowRunOriginV1;
  acceptedEnvelope?: string;
  state?: WorkflowRunStateV1;
  resultDeliveryState?: WorkflowRunSummaryV1['workflowResultDeliveryState'];
  /** Bounded page size so paged discovery of off-page rows is actually exercised. */
  invocationPageSize?: number;
  /** Lets a test advance out-of-band state between `wait` observations. */
  onBeforeWait?: (attempt: number) => void | Promise<void>;
  now?: string;
}>): WorkflowRunStorageTestkit {
  const now = params.now ?? '2026-01-01T00:00:00.000Z';
  const pageSize = params.invocationPageSize ?? Number.MAX_SAFE_INTEGER;
  const calls: WorkflowRunStorageTestkitOperation[] = [];
  const rows = new Map<string, StoredRow>();

  let acceptedEnvelope: string | null = params.acceptedEnvelope ?? null;
  let checkpointEnvelope: string | null = null;
  let resultEnvelope: string | null = null;
  let state: WorkflowRunStateV1 = params.state ?? 'queued';
  let revision = 0;
  let custodyState: WorkflowRunSummaryV1['workflowCustodyState'] = 'pending';
  let resultDeliveryState: WorkflowRunSummaryV1['workflowResultDeliveryState'] = params.resultDeliveryState ?? null;
  let waitAttempts = 0;

  const summary = (): WorkflowRunSummaryV1 => ({
    id: params.runId,
    origin: params.origin,
    state,
    revision,
    machineId: params.machineId,
    workflowCustodyState: custodyState,
    workflowResultDeliveryState: resultDeliveryState,
    availability: {
      pause: true, resumeBoundary: false, recoverSameConversation: false, recoverFreshAgent: false,
      retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [],
    },
    createdAt: now,
    updatedAt: now,
  });

  const ordered = (): StoredRow[] => [...rows.values()]
    .sort((left, right) => (BigInt(left.index.sequence) < BigInt(right.index.sequence) ? -1 : 1));

  /** Newest attempt per member slot, exactly as the server resolves a parent page. */
  const newestPerMemberSlot = (parentRecordId: string): StoredRow[] => {
    const newest = new Map<string, StoredRow>();
    for (const row of rows.values()) {
      if (row.index.parentRecordId !== parentRecordId) continue;
      const current = newest.get(row.index.memberOrdinal);
      if (!current || BigInt(row.index.attempt) > BigInt(current.index.attempt)) newest.set(row.index.memberOrdinal, row);
    }
    return [...newest.values()]
      .sort((left, right) => (BigInt(left.index.memberOrdinal) < BigInt(right.index.memberOrdinal) ? -1 : 1));
  };

  const admitRow = (input: Readonly<{
    id: string; sequence: string; parentRecordId: string | null; memberOrdinal: string;
    lifecycle: WorkflowInvocationLifecycleV1; contentEnvelope: string;
  }>): WorkflowRunInvocationIndexV1 => {
    const index = WorkflowRunInvocationIndexV1Schema.parse({
      id: input.id, runId: params.runId, sequence: input.sequence, parentRecordId: input.parentRecordId,
      memberOrdinal: input.memberOrdinal, attempt: '0', lifecycle: input.lifecycle, createdAt: now, updatedAt: now,
    });
    rows.set(index.id, { index, contentEnvelope: input.contentEnvelope });
    return index;
  };

  const execute = async (operation: WorkflowRunStorageTestkitOperation): Promise<unknown> => {
    calls.push(operation);
    const kind = String(operation.operation);
    const expectRevision = () => {
      if (operation.expectedRevision !== revision) throw storageError('currentness_conflict');
    };
    switch (kind) {
      case 'admit': {
        if (acceptedEnvelope === null) {
          acceptedEnvelope = String(operation.acceptedEnvelope);
          if (operation.resultDelivery !== undefined) resultDeliveryState = 'pending';
          return { kind: 'created', run: summary() };
        }
        return { kind: 'existing', run: summary() };
      }
      case 'accepted-snapshot.resolve': {
        if (operation.expectedRevision !== revision) throw storageError('currentness_conflict');
        const disposition = acceptedEnvelope === null ? 'created' : 'existing';
        if (acceptedEnvelope === null) {
          acceptedEnvelope = String(operation.acceptedEnvelope);
          revision += 1;
        }
        return { disposition, acceptedEnvelope, run: summary() };
      }
      case 'get': {
        if (acceptedEnvelope === null) throw notFound();
        return { run: summary(), acceptedEnvelope, checkpointEnvelope, resultEnvelope };
      }
      case 'initialize': {
        expectRevision();
        if (checkpointEnvelope !== null) return { initialization: 'existing', run: summary() };
        revision += 1;
        state = 'running';
        checkpointEnvelope = String(operation.checkpointEnvelope);
        const root = operation.rootInvocation as Readonly<{ id: string; contentEnvelope: string }>;
        admitRow({
          id: root.id, sequence: '0', parentRecordId: null, memberOrdinal: '0',
          lifecycle: 'pending', contentEnvelope: root.contentEnvelope,
        });
        return { initialization: 'created', run: summary() };
      }
      case 'invocations.admit': {
        expectRevision();
        revision += 1;
        checkpointEnvelope = String(operation.checkpointEnvelope);
        const invocations = (operation.invocations as ReadonlyArray<Readonly<Record<string, unknown>>>).map((item) => {
          const existing = rows.get(String(item.id));
          if (existing) return existing.index;
          return admitRow({
            id: String(item.id),
            sequence: String(item.sequence),
            parentRecordId: String(item.parentRecordId),
            memberOrdinal: String(item.memberOrdinal),
            lifecycle: (item.lifecycle as WorkflowInvocationLifecycleV1 | undefined) ?? 'pending',
            contentEnvelope: String(item.contentEnvelope),
          });
        });
        return { disposition: 'created', parentRevision: revision, invocations };
      }
      case 'invocations.get': {
        const row = rows.get(String(operation.invocationId));
        if (!row) throw notFound();
        return { invocation: { index: row.index, contentEnvelope: row.contentEnvelope, parentRevision: revision } };
      }
      case 'invocations.list': {
        const lifecycles = Array.isArray(operation.lifecycles)
          ? (operation.lifecycles as readonly WorkflowInvocationLifecycleV1[])
          : undefined;
        const parentRecordId = operation.parentRecordId === undefined ? undefined : String(operation.parentRecordId);
        const scanned = parentRecordId === undefined ? ordered() : newestPerMemberSlot(parentRecordId);
        const positionOf = (row: StoredRow) => (parentRecordId === undefined ? row.index.sequence : row.index.memberOrdinal);
        const after = decodeCursor(operation.cursor);
        const remaining = scanned.filter((row) => after === null || BigInt(positionOf(row)) > BigInt(after));
        const matching = remaining.filter((row) => !lifecycles || lifecycles.includes(row.index.lifecycle));
        // Paging is keyed on the scanned slot, not the filtered result: the
        // server advances past inspected slots even when they are filtered out,
        // so an attention row can legitimately sit beyond the first page.
        const limit = Math.min(pageSize, typeof operation.limit === 'number' ? operation.limit : Number.MAX_SAFE_INTEGER);
        const inspected = remaining.slice(0, limit);
        const page = matching.filter((row) => inspected.includes(row));
        const lastInspected = inspected.at(-1);
        const hasMore = remaining.length > inspected.length;
        return {
          invocations: page.map((row) => row.index),
          parentRevision: revision,
          ...(hasMore && lastInspected ? { nextCursor: encodeCursor(positionOf(lastInspected)) } : {}),
        };
      }
      case 'invocations.fact': {
        const row = rows.get(String(operation.invocationId));
        if (!row) throw notFound();
        if (row.index.lifecycle !== operation.expectedLifecycle) throw storageError('currentness_conflict');
        if (row.index.attempt !== operation.invocationAttempt) throw storageError('currentness_conflict');
        const contentEnvelope = String(operation.contentEnvelope);
        if (row.index.lifecycle === operation.lifecycle && row.contentEnvelope === contentEnvelope) return row.index;
        if (TERMINAL_INVOCATION_LIFECYCLES.some((candidate) => candidate === row.index.lifecycle)
          && operation.lifecycle !== row.index.lifecycle) {
          throw storageError('currentness_conflict');
        }
        const index = WorkflowRunInvocationIndexV1Schema.parse({
          ...row.index,
          lifecycle: operation.lifecycle as WorkflowInvocationLifecycleV1,
        });
        rows.set(index.id, { index, contentEnvelope });
        return index;
      }
      case 'transition': {
        expectRevision();
        for (const item of (operation.invocationTransitions ?? []) as ReadonlyArray<Readonly<Record<string, unknown>>>) {
          const row = rows.get(String(item.id));
          if (!row) throw notFound();
          if (row.index.lifecycle !== item.expectedLifecycle) throw storageError('currentness_conflict');
        }
        revision += 1;
        state = operation.state as WorkflowRunStateV1;
        checkpointEnvelope = String(operation.checkpointEnvelope);
        if (typeof operation.resultEnvelope === 'string') resultEnvelope = operation.resultEnvelope;
        if (operation.custodyState === 'settled') custodyState = 'settled';
        for (const item of (operation.invocationTransitions ?? []) as ReadonlyArray<Readonly<Record<string, unknown>>>) {
          const row = rows.get(String(item.id))!;
          rows.set(row.index.id, {
            ...row,
            index: { ...row.index, lifecycle: item.lifecycle as WorkflowInvocationLifecycleV1 },
          });
        }
        return summary();
      }
      case 'pause':
      case 'resume':
      case 'cancel': {
        expectRevision();
        revision += 1;
        if (kind === 'pause') state = 'pause_requested';
        if (kind === 'resume') state = 'running';
        if (kind === 'cancel') {
          state = 'cancelled';
          for (const row of [...rows.values()]) {
            if (!CANCELLABLE_LIFECYCLES.some((candidate) => candidate === row.index.lifecycle)) continue;
            rows.set(row.index.id, { ...row, index: { ...row.index, lifecycle: 'cancelled' } });
          }
        }
        return { run: summary(), intent: kind === 'cancel' ? 'cancelled' : kind };
      }
      case 'result-delivery.settle': {
        expectRevision();
        revision += 1;
        custodyState = 'settled';
        resultDeliveryState = operation.state === 'unavailable'
          ? { kind: 'unavailable', ...(operation.reason === 'workflow_outcome_unresolved' ? { reason: operation.reason } : {}) }
          : 'accepted';
        return { run: summary() };
      }
      case 'wait': {
        // Faithful projection of the server's observation contract: terminal,
        // paused, parent-level attention, any indexed actionable invocation,
        // then revision change, then deadline. No polling delay is simulated.
        for (;;) {
          waitAttempts += 1;
          await params.onBeforeWait?.(waitAttempts);
          if (TERMINAL_RUN_STATES.some((candidate) => candidate === state)) {
            return { observation: 'terminal', run: summary(), ...(resultEnvelope ? { resultEnvelope } : {}) };
          }
          if (state === 'paused') return { observation: 'paused', run: summary() };
          if (state === 'interrupted'
            || (typeof resultDeliveryState === 'object'
              && resultDeliveryState?.kind === 'unavailable')) {
            return { observation: 'needs_attention', run: summary() };
          }
          if ([...rows.values()].some((row) => ATTENTION_LIFECYCLES.some((candidate) => candidate === row.index.lifecycle))) {
            return { observation: 'needs_attention', run: summary() };
          }
          if (operation.afterRevision !== undefined && revision !== operation.afterRevision) {
            return { observation: 'changed', run: summary() };
          }
          if (params.onBeforeWait === undefined) return { observation: 'timeout', run: summary() };
        }
      }
      default:
        throw new Error(`workflow_run_storage_testkit_unsupported_operation:${kind}`);
    }
  };

  return {
    execute,
    calls,
    operations: () => calls.map((call) => String(call.operation)),
    run: summary,
    rows: () => ordered(),
    rowById: (invocationId) => rows.get(invocationId),
    acceptedEnvelope: () => acceptedEnvelope,
    checkpointEnvelope: () => checkpointEnvelope,
    resultEnvelope: () => resultEnvelope,
    requestControl: (next) => {
      revision += 1;
      if (next !== 'cancel_requested') state = next;
      if (next !== 'cancelled' && next !== 'cancel_requested') return;
      for (const row of [...rows.values()]) {
        if (!CANCELLABLE_LIFECYCLES.some((candidate) => candidate === row.index.lifecycle)) continue;
        rows.set(row.index.id, { ...row, index: { ...row.index, lifecycle: 'cancel_requested' } });
      }
    },
  };
}
