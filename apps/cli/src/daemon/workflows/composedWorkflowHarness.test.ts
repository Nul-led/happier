import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutomationRunCauseSchema,
  AutomationV3RunMutationResponseSchema,
  deriveAutomationOccurrenceKeyV1,
  WorkflowProgressEnvelopeV1Schema,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
  type WorkflowDefinitionV1,
  type WorkflowRunInvocationIndexV1,
  type WorkflowStep,
} from '@happier-dev/protocol';

import { executeClaimedRun } from '@/daemon/automation/automationRunExecutor';
import { dispatchActionFromRpc } from '@/rpc/handlers/_actionDispatchAdapter';
import { createWorkflowActionExecutor } from '@/session/actions/workflowActionExecutor';
import { createWorkflowRunActionOwner } from '@/session/actions/workflowRunActions';
import { createInMemoryWorkflowCoordinatorStore, createWorkflowCoordinator, workflowInvocationKey } from './coordinator';
import { createGitWorkflowWorkspaceTestDependencies } from './workflowWorkspace.testkit';
import { bindAutomationWorkflowInputs, isWorkflowJsonObject } from './input';
import { createProductionWorkflowRunCoordinator } from './production';
import { createWorkflowSessionStepExecutor } from './sessionStepExecutor';
import {
  createWorkflowRunStorageTestkit,
  type WorkflowRunStorageTestkit,
  type WorkflowRunStorageTestkitOperation,
} from './workflowRunStorage.testkit';
import {
  createCoordinatorWorkspaceResolver,
  normalizeWorkflowProjectTarget,
  prepareWorkflowAcceptedWorkspaceTarget,
  resolveWorkflowWorkspace,
} from './resolveWorkflowWorkspace';

const accountId = 'account-1';
const machineId = 'machine-1';
const sessionId = 'session-1';
const currentness = { mode: 'plain' as const, version: 1, contentKeyFingerprint: null };
const authorization = { admittedPermissionCeiling: 'safe-yolo' as const, principal: { kind: 'host' as const } };
const agentTarget = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.test', localId: 'test' } };

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

/**
 * A real project directory. The production workspace resolver stats and
 * inspects the accepted checkout through the canonical SCM/path owners, so a
 * composed run cannot use an invented `/repo` string.
 */
async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'happier-composed-workflow-'));
  temporaryDirectories.push(directory);
  return directory;
}

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    kind: 'step', id, document: { text: id, references: [], attachments: [] },
    input: [], result: { kind: 'text' }, ...overrides,
  } as WorkflowStep;
}

/** Every composed definition reuses one already-open conversation so the leaf never spawns a real Session. */
function retainedConversationDefaults() {
  return { agentTarget, conversation: { kind: 'existing_session' as const, sessionId, machineId } };
}

function sealDirectAccepted(input: Readonly<{
  runId: string;
  definition: WorkflowDefinitionV1;
  directory: string;
  deliverResult?: boolean;
}>): string {
  return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
    mode: 'plain',
    binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId: input.runId },
    acceptedSnapshot: {
      definition: input.definition,
      source: { kind: 'inline' },
      inputs: {},
      machineId,
      executionTarget: { kind: 'session' },
      workspaceTarget: { project: { machineId, directory: input.directory, checkoutRootPath: input.directory } },
      origin: { kind: 'direct', ...(input.deliverResult ? { originSessionId: sessionId } : {}) },
      authorization,
      ...(input.deliverResult ? { resultDelivery: { kind: 'originating_session' as const, originSessionId: sessionId, localInputId: `workflow-run:${input.runId}:result-delivery` } } : {}),
    },
  }));
}

type LeafOutcome = 'completed' | 'failed' | 'needs_attention';

/** The first prompt line is the authored step document, so it labels the leaf. */
function leafLabel(text: string): string {
  return text.split('\n', 1)[0]!.trim();
}

function sessionInputBoundary(
  outcomes: Readonly<Record<string, LeafOutcome>> = {},
  hooks: Readonly<{ onObserve?: (label: string, signal?: AbortSignal) => Promise<void> }> = {},
) {
  const enqueue = vi.fn(async (request: Readonly<{ text: string }>) => ({
    status: 'accepted' as const,
    localId: leafLabel(request.text),
  }));
  const observe = vi.fn(async (request: Readonly<{ localId: string; signal?: AbortSignal }>) => {
    await hooks.onObserve?.(request.localId, request.signal);
    switch (outcomes[request.localId] ?? 'completed') {
      case 'needs_attention':
        return { ok: false as const, code: 'workflow_step_timeout' };
      case 'failed':
        return { ok: true as const, sessionId, localId: request.localId, result: { kind: 'failed' as const } };
      default:
        return {
          ok: true as const, sessionId, localId: request.localId,
          result: { kind: 'final_text' as const, text: request.localId },
        };
    }
  });
  const cancel = vi.fn(async () => ({ kind: 'turn_cancel_requested' as const }));
  return { preflight: () => ({ ok: true as const }), enqueue, observe, cancel };
}

/**
 * One production daemon "process". Each call builds a brand new coordinator,
 * conversation owner, workspace resolver and `DurableWorkflowCoordinatorStore`
 * over whatever bytes the storage boundary already holds, so calling it twice
 * is a genuine process replacement rather than a reused in-memory store.
 */
function workflowDaemonProcess(input: Readonly<{
  storage: Readonly<{ execute: WorkflowRunStorageTestkit['execute'] }>;
  sessionInput: ReturnType<typeof sessionInputBoundary>;
  directory: string;
  resultDeliveryTransport?: ReturnType<typeof vi.fn>;
}>) {
  const unusedRunActions = { execute: vi.fn(async () => ({ ok: false as const, errorCode: 'unused' })) };
  const actionContext = () => ({ surface: 'agent' as const, authority: 'account_automation' as const });
  return createProductionWorkflowRunCoordinator({
    token: 'token',
    accountId,
    machineId,
    resolveAccountEncryption: async () => ({ kind: 'available', witness: currentness }) as never,
    isAcceptedAuthorizationCurrent: async () => true,
    execution: {
      credentials: { token: 'token', encryption: null } as never,
      serverId: 'server-1',
      resolveMachineOperationProtocolCapabilities: async () => ({
        sessionInputAdmission: { protocolVersions: [1, 2] },
      }),
      machineAdmissionTransport: vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' })) as never,
      resolveExistingSessionConversation: async () => ({ sessionId, machineId, directory: input.directory }),
      sessionInput: input.sessionInput as never,
      detachedRun: { actionExecutor: unusedRunActions as never, buildActionContext: actionContext as never },
      attachedRun: {
        actionExecutor: unusedRunActions as never,
        buildActionContext: actionContext as never,
        sendInput: vi.fn() as never,
      },
    },
    // The SCM/worktree owner is reached through the daemon-applied plugin
    // runtime, which is a real process boundary and is absent here. Every
    // definition below selects the accepted project checkout, so only the
    // recorded-workspace verification and accepted-target inspection are
    // substituted; path canonicalization stays with its canonical owner.
    prepareAcceptedWorkspaceTarget: async () => ({
      ok: true,
      workspaceTarget: { project: { machineId, directory: input.directory, checkoutRootPath: input.directory } },
    }),
    workspaceScm: { verifyRecordedWorkspace: async () => 'available' as const },
    onCommittedTransition: vi.fn(),
    ...(input.resultDeliveryTransport ? {
      resultDelivery: {
        credentials: { token: 'token', encryption: null } as never,
        resolveMachineOperationProtocolCapabilities: async () => ({ sessionInputAdmission: { protocolVersions: [1, 2] } }),
        machineAdmissionTransport: input.resultDeliveryTransport as never,
      },
    } : {}),
    storage: input.storage as never,
  });
}

/** Loses exactly one terminal parent settlement, leaving every durable row intact. */
function storageLosingFirstSettlement(kit: WorkflowRunStorageTestkit) {
  let pending = true;
  return {
    execute: async (operation: WorkflowRunStorageTestkitOperation, options?: Readonly<{ signal?: AbortSignal }>) => {
      if (pending && String(operation.operation) === 'transition' && String(operation.state) !== 'running') {
        pending = false;
        throw new Error('simulated_daemon_loss_before_settlement');
      }
      return await kit.execute(operation, options);
    },
    settlementWasLost: () => !pending,
  };
}

function openRowProgress(kit: WorkflowRunStorageTestkit, index: WorkflowRunInvocationIndexV1) {
  const row = kit.rowById(index.id);
  if (!row) throw new Error('missing_row');
  const opened = openWorkflowProgressStoredEnvelopeV1({
    mode: 'plain',
    binding: {
      v: 1, purpose: 'invocation_progress', accountId, runId: index.runId,
      recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
      memberOrdinal: index.memberOrdinal, attempt: index.attempt,
    },
    envelope: parseWorkflowStoredContentEnvelopeV1(row.contentEnvelope),
  });
  if (opened.kind !== 'available') throw new Error(opened.kind);
  return WorkflowProgressEnvelopeV1Schema.parse(opened.content);
}

function rowFor(kit: WorkflowRunStorageTestkit, blockId: string): WorkflowRunInvocationIndexV1 | undefined {
  return kit.rows()
    .map((row) => row.index)
    .find((index) => openRowProgress(kit, index).invocationPath.blockId === blockId);
}

function fanOutDefinition(failurePolicy: 'collect_outcomes' | 'fail_stop'): WorkflowDefinitionV1 {
  return {
    version: 1,
    inputs: [],
    defaults: retainedConversationDefaults(),
    blocks: [
      {
        kind: 'parallel',
        id: 'fan',
        failurePolicy,
        branches: [
          { id: 'healthy', blocks: [step('good')] },
          { id: 'broken', blocks: [step('bad'), step('must-not-run')] },
        ],
      },
      step('summary', {
        input: [{ kind: 'result', producer: { blockId: 'fan', scope: { kind: 'current' } }, path: [] }],
      }),
    ],
    finalOutput: { kind: 'result', producer: { blockId: 'summary', scope: { kind: 'current' } }, path: [] },
  };
}

describe('composed Workflow front door and claimed execution', () => {
  it('keeps a successful Run inspectable and sends nothing when configured delivery has no selected final output', async () => {
    const runId = '10101010-1010-4010-8010-101010101010';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1, inputs: [], defaults: retainedConversationDefaults(), blocks: [step('work')],
    };
    const acceptedEnvelope = sealDirectAccepted({ runId, definition, directory, deliverResult: true });
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct', originSessionId: sessionId },
      acceptedEnvelope, resultDeliveryState: 'pending',
    });
    const sessionInput = sessionInputBoundary();
    const deliveryTransport = vi.fn(async () => ({ status: 'accepted' as const, localId: 'must-not-send' }));
    const coordinate = workflowDaemonProcess({ storage: kit, sessionInput, directory, resultDeliveryTransport: deliveryTransport });

    await expect(coordinate({
      protocol: 'v3', automationId: null, runId, attempt: 0, expectedRevision: 0,
      accountCurrentness: currentness, acceptedSnapshotEnvelope: acceptedEnvelope,
    } as never)).resolves.toMatchObject({ state: 'succeeded' });

    expect(deliveryTransport).not.toHaveBeenCalled();
    expect(openRowProgress(kit, rowFor(kit, 'work')!).result).toBe('work');
    expect(kit.run()).toMatchObject({
      state: 'succeeded', workflowCustodyState: 'settled',
      workflowResultDeliveryState: { kind: 'unavailable', reason: 'workflow_outcome_unresolved' },
    });
  });

  it.each<{
    expectedState: 'paused' | 'interrupted';
    outcomes: Readonly<Record<string, LeafOutcome>>;
    pauseAfter: string | null;
  }>([
    { expectedState: 'paused', outcomes: {}, pauseAfter: 'first' },
    { expectedState: 'interrupted', outcomes: { first: 'failed' }, pauseAfter: null },
  ])('does not attempt configured direct delivery after a $expectedState parent commit', async ({ expectedState, outcomes, pauseAfter }) => {
    const runId = expectedState === 'paused'
      ? '13131313-1313-4313-8313-131313131313'
      : '14141414-1414-4414-8414-141414141414';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [step('first'), step('must-not-run')],
      finalOutput: { kind: 'result', producer: { blockId: 'must-not-run', scope: { kind: 'current' } }, path: [] },
    };
    const acceptedEnvelope = sealDirectAccepted({ runId, definition, directory, deliverResult: true });
    const kit = createWorkflowRunStorageTestkit({
      runId,
      machineId,
      origin: { kind: 'direct', originSessionId: sessionId },
      acceptedEnvelope,
      resultDeliveryState: 'pending',
    });
    const sessionInput = sessionInputBoundary(outcomes, {
      onObserve: async (label) => {
        if (label === pauseAfter) kit.requestControl('pause_requested');
      },
    });
    const deliveryTransport = vi.fn(async () => ({ status: 'accepted' as const, localId: 'must-not-send' }));
    const coordinate = workflowDaemonProcess({ storage: kit, sessionInput, directory, resultDeliveryTransport: deliveryTransport });

    await expect(coordinate({
      runId,
      attempt: 0,
      expectedRevision: 0,
      accountCurrentness: currentness,
      acceptedEnvelope,
    } as never)).resolves.toMatchObject({ state: expectedState });

    expect(deliveryTransport).not.toHaveBeenCalled();
    expect(kit.calls.filter((operation) => operation.operation === 'result-delivery.settle')).toEqual([]);
    expect(kit.run()).toMatchObject({
      state: expectedState,
      workflowCustodyState: 'pending',
      workflowResultDeliveryState: 'pending',
    });
  });

  it('propagates persisted live cancellation on the existing heartbeat into the exact Session leaf once', async () => {
    const directory = await projectDirectory();
    vi.useFakeTimers();
    try {
      const runId = '12121212-1212-4212-8212-121212121212';
      const definition: WorkflowDefinitionV1 = {
        version: 1, inputs: [], defaults: retainedConversationDefaults(),
        blocks: [step('active'), step('must-not-admit')],
      };
      const kit = createWorkflowRunStorageTestkit({
        runId, machineId, origin: { kind: 'direct' },
        acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
      });
      let observationStarted!: () => void;
      const started = new Promise<void>((resolve) => { observationStarted = resolve; });
      const sessionInput = sessionInputBoundary();
      sessionInput.cancel.mockImplementationOnce(async () => {
        expect(kit.run()).toMatchObject({ workflowCustodyState: 'pending' });
        return { kind: 'turn_cancel_requested' as const };
      });
      sessionInput.observe.mockImplementationOnce(async (request) => {
        observationStarted();
        await new Promise<void>((resolve) => request.signal?.addEventListener('abort', () => resolve(), { once: true }));
        return { ok: false as const, code: 'cancelled' };
      });
      const claimClient = {
        startRun: vi.fn(),
        heartbeatRun: vi.fn(async () => { kit.requestControl('cancel_requested'); }),
        succeedRun: vi.fn(), failRun: vi.fn(),
      };
      const running = executeClaimedRun({
        token: 'token', machineId, claimClient: claimClient as never, spawnSession: vi.fn(),
        heartbeatMs: 1_000, leaseDurationMs: 120_000,
        coordinateWorkflowRun: workflowDaemonProcess({ storage: kit, sessionInput, directory }) as never,
        claimed: {
          protocol: 'v3', automation: null, accountCurrentness: currentness,
          run: { id: runId, automationId: null, attempt: 0, revision: kit.run().revision, origin: { kind: 'direct' }, workflowAcceptedSnapshotEnvelope: kit.acceptedEnvelope()!, triggerId: null },
        } as never,
      });
      await started;
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(running).resolves.toBeUndefined();

      expect(claimClient.heartbeatRun).toHaveBeenCalledOnce();
      expect(sessionInput.cancel).toHaveBeenCalledOnce();
      expect(sessionInput.cancel).toHaveBeenCalledWith(expect.objectContaining({ sessionId, localId: 'active' }));
      expect(sessionInput.enqueue.mock.calls.map(([request]) => leafLabel(request.text))).toEqual(['active']);
      expect(rowFor(kit, 'active')?.lifecycle).toBe('cancel_requested');
      expect(rowFor(kit, 'must-not-admit')).toBeUndefined();
      expect(kit.calls.filter((operation) => operation.operation === 'transition' && operation.state !== 'running')).toEqual([]);
      expect(kit.run()).toMatchObject({ state: 'running', workflowCustodyState: 'pending' });
    } finally {
      vi.useRealTimers();
    }
  });

  it(
    'carries a direct RPC-admitted program through one production Run owner and cannot replay a completed invocation',
    async () => {
      const runId = '11111111-1111-4111-8111-111111111111';
      const directory = await projectDirectory();
      const definition: WorkflowDefinitionV1 = {
        version: 1,
        inputs: [],
        defaults: retainedConversationDefaults(),
        blocks: [step('work')],
        finalOutput: { kind: 'result', producer: { blockId: 'work', scope: { kind: 'current' } }, path: [] },
      };
      const kit = createWorkflowRunStorageTestkit({ runId, machineId, origin: { kind: 'direct' } });
      const runOwner = createWorkflowRunActionOwner({
        resolveAccountId: async () => accountId,
        storage: kit,
        definitions: { get: vi.fn() },
        resolveEncryption: async () => ({ kind: 'available', witness: currentness }),
        prepareWorkspace: async () => ({
          ok: true,
          workspaceTarget: { project: { machineId, directory, checkoutRootPath: directory } },
        }),
      });
      const workflowActions = createWorkflowActionExecutor({
        isWorkflowFeatureEnabled: async () => true,
        definitions: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        runs: runOwner,
      });
      const actionExecutor = {
        execute: async (
          actionId: Parameters<typeof workflowActions>[0]['actionId'],
          input: unknown,
          context?: Parameters<typeof workflowActions>[0]['context'],
        ) => ({
          ok: true as const,
          // `createCliActionDeps.ts` is the canonical owner that resolves the
          // current Session's machine/directory into the Action context for
          // `workflow.run.start`; this composed executor reproduces only that
          // injection rather than a second target resolver.
          result: await workflowActions({
            actionId,
            input,
            context: { ...context, externalActionTarget: { kind: 'machine', machineId, project: { machineId, directory } } },
          } as never),
        }),
      };

      await expect(dispatchActionFromRpc({
        actionId: 'workflow.run.start',
        input: { runId, source: { kind: 'inline', definition } },
        localActionContext: {
          surface: 'rpc', authority: 'account_automation', callerPermissionMode: 'safe-yolo',
          causalPermissionAuthority: { kind: 'admittedSessionInputV1', admittedPermissionCeiling: 'safe-yolo' },
        },
        executor: actionExecutor as never,
      })).resolves.toMatchObject({ ok: true, result: { admission: 'created', run: { id: runId } } });
      const acceptedEnvelope = kit.acceptedEnvelope();
      expect(acceptedEnvelope).not.toBeNull();
      expect(openWorkflowAcceptedSnapshotStoredEnvelopeV1({
        mode: 'plain',
        binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId },
        envelope: parseWorkflowStoredContentEnvelopeV1(acceptedEnvelope!),
      })).toMatchObject({ kind: 'available', content: { origin: { kind: 'direct' }, source: { kind: 'inline' } } });

      const sessionInput = sessionInputBoundary();
      const coordinate = workflowDaemonProcess({ storage: kit, sessionInput, directory });
      const claimed = {
        protocol: 'v3',
        automation: null,
        accountCurrentness: currentness,
        run: {
          id: runId, automationId: null, attempt: 0, revision: kit.run().revision, origin: { kind: 'direct' },
          workflowAcceptedSnapshotEnvelope: acceptedEnvelope!, triggerId: null,
        },
      } as never;
      const claimClient = { startRun: vi.fn(), heartbeatRun: vi.fn(async () => {}), succeedRun: vi.fn(), failRun: vi.fn() };
      const executeClaim = async () => await executeClaimedRun({
        token: 'token', machineId, claimClient: claimClient as never, spawnSession: vi.fn(),
        heartbeatMs: 60_000, leaseDurationMs: 120_000, coordinateWorkflowRun: coordinate as never, claimed,
      });
      await executeClaim();
      // A lost claim response reclaims the same Run. The durable completed row
      // is observed, not replayed, so no second Session input is admitted.
      await executeClaim();

      const work = rowFor(kit, 'work');
      expect(work?.lifecycle).toBe('completed');
      expect(openRowProgress(kit, work!).result).toBe('work');
      expect(sessionInput.enqueue).toHaveBeenCalledOnce();
      expect(sessionInput.observe).toHaveBeenCalledOnce();
      expect(claimClient.startRun).not.toHaveBeenCalled();
      expect(kit.run()).toMatchObject({ state: 'succeeded', workflowCustodyState: 'settled' });
    },
  );
});

describe('composed Automation workflow claim and optional receipt', () => {
  it('keeps the exact optional workflowRun receipt bound to the returned Run only when the canonical schema supports it', async () => {
    // The canonical current schema owns the optional receipt shape. This
    // composed lane verifies that shape through the real Protocol owner and
    // does not invent a test-only receipt contract.
    expect(AutomationV3RunMutationResponseSchema.shape).toHaveProperty('workflowRun');
    const timestamp = 1_786_257_600_000;
    const run = {
      id: 'run-automation-receipt',
      automationId: 'automation-1',
      revision: 1,
      triggerId: null,
      triggerRetired: false,
      state: 'queued' as const,
      cause: { kind: 'manual' as const, invokedAt: timestamp },
      dueAt: timestamp,
      claimedAt: null,
      startedAt: null,
      finishedAt: null,
      claimedByMachineId: null,
      leaseExpiresAt: null,
      attempt: 0,
      errorCode: null,
      producedSessionId: null,
      executionDispatchState: null,
      executionAttempt: 0,
      replyHandoffState: 'none' as const,
      replyHandoffAttempt: 0,
      replyHandoffDueAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(AutomationV3RunMutationResponseSchema.parse({ run })).toEqual({ run });
    const workflowResponse = {
      run,
      workflowRun: { recipeKind: 'workflow-v2' as const, workflowRunId: run.id },
    };
    expect(AutomationV3RunMutationResponseSchema.parse(workflowResponse)).toEqual(workflowResponse);
    expect(AutomationV3RunMutationResponseSchema.safeParse({
      ...workflowResponse,
      workflowRun: { recipeKind: 'workflow-v2' as const, workflowRunId: 'different-run' },
    }).success).toBe(false);
    expect(AutomationV3RunMutationResponseSchema.safeParse({
      ...workflowResponse,
      workflowRun: { recipeKind: 'legacy' as const, workflowRunId: run.id },
    }).success).toBe(false);
  });

  it('reaches the same production Run owner from an Automation claim as from a direct start', async () => {
    const runId = '22222222-2222-4222-8222-222222222222';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [{ name: 'request', valueType: 'string', required: true }],
      defaults: retainedConversationDefaults(),
      blocks: [step('work', { input: [{ kind: 'input', name: 'request' }] })],
      finalOutput: { kind: 'result', producer: { blockId: 'work', scope: { kind: 'current' } }, path: [] },
    };
    // The Automation evidence opens through the real input binding owner
    // inside the coordinator path: this harness does not reimplement trigger
    // evidence parsing and fails closed on missing required input.
    expect(() => bindAutomationWorkflowInputs({ definition: { inputs: definition.inputs }, evidence: {} }))
      .toThrowError('missing_required_input');
    expect(bindAutomationWorkflowInputs({
      definition: { inputs: definition.inputs },
      evidence: { request: 'ship it' },
    })).toEqual({ request: 'ship it' });

    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'automation', automationId: 'automation-1' },
    });
    const sessionInput = sessionInputBoundary();
    const coordinate = workflowDaemonProcess({ storage: kit, sessionInput, directory });
    const claimClient = { startRun: vi.fn(), heartbeatRun: vi.fn(async () => {}), succeedRun: vi.fn(), failRun: vi.fn() };
    await executeClaimedRun({
      token: 'token', machineId, claimClient: claimClient as never, spawnSession: vi.fn(),
      heartbeatMs: 60_000, leaseDurationMs: 120_000, coordinateWorkflowRun: coordinate as never,
      claimed: {
        protocol: 'v3',
        accountCurrentness: currentness,
        automation: { id: 'automation-1' },
        run: {
          id: runId,
          automationId: 'automation-1',
          attempt: 0,
          revision: 0,
          origin: { kind: 'automation', automationId: 'automation-1' },
          recipeKind: 'workflow-v2',
          executionInputEnvelope: JSON.stringify({
            t: 'plain',
            v: { definition, project: { machineId, directory } },
          }),
          automationEvidenceEnvelope: JSON.stringify({ t: 'plain', v: { request: 'ship it' } }),
          cause: { kind: 'conversation', occurrenceKey: 'A'.repeat(43), occurredAt: 1 },
          triggerId: null,
        },
      } as never,
    });

    // Only the pre-root accepted-snapshot resolution distinguishes the two
    // origins; everything after it is the one Run/invocation owner.
    expect(kit.operations()[0]).toBe('accepted-snapshot.resolve');
    expect(kit.operations()).toEqual(expect.arrayContaining(['initialize', 'invocations.admit', 'transition']));
    expect(sessionInput.enqueue).toHaveBeenCalledOnce();
    expect(claimClient.startRun).not.toHaveBeenCalled();
    const work = rowFor(kit, 'work');
    expect(work?.lifecycle).toBe('completed');
    expect(kit.run()).toMatchObject({
      origin: { kind: 'automation', automationId: 'automation-1' },
      state: 'succeeded',
      workflowCustodyState: 'settled',
    });
  });

  it('admits a scheduled zero-input one-prompt workflow through the canonical binder into its literal child input', async () => {
    const runId = '99999999-9999-4999-8999-999999999999';
    const directory = await projectDirectory();
    const scheduledFor = 1_714_000_000_000;
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [step('work')],
      finalOutput: { kind: 'result', producer: { blockId: 'work', scope: { kind: 'current' } }, path: [] },
    };
    const cause = AutomationRunCauseSchema.parse({
      kind: 'trigger',
      triggerId: 'trigger-1',
      triggerKind: 'schedule',
      triggerRevision: 4,
      occurrenceKey: deriveAutomationOccurrenceKeyV1({
        triggerId: 'trigger-1',
        evidence: { v: 1, kind: 'schedule', scheduledFor },
      }),
      occurredAt: scheduledFor,
      evidence: { scheduledFor },
    });
    if (cause.kind !== 'trigger') throw new Error('Expected scheduled trigger cause');
    // The immutable occurrence cause retains the full schedule evidence while
    // the zero-input definition binds none of it.
    expect(cause.evidence).toEqual({ scheduledFor });

    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'automation', automationId: 'automation-1' },
    });
    const sessionInput = sessionInputBoundary();
    const coordinate = workflowDaemonProcess({ storage: kit, sessionInput, directory });
    const claimClient = { startRun: vi.fn(), heartbeatRun: vi.fn(async () => {}), succeedRun: vi.fn(), failRun: vi.fn() };
    await executeClaimedRun({
      token: 'token', machineId, claimClient: claimClient as never, spawnSession: vi.fn(),
      heartbeatMs: 60_000, leaseDurationMs: 120_000, coordinateWorkflowRun: coordinate as never,
      claimed: {
        protocol: 'v3',
        accountCurrentness: currentness,
        automation: { id: 'automation-1' },
        run: {
          id: runId,
          automationId: 'automation-1',
          attempt: 0,
          revision: 0,
          origin: { kind: 'automation', automationId: 'automation-1' },
          recipeKind: 'workflow-v2',
          executionInputEnvelope: JSON.stringify({
            t: 'plain',
            v: { definition, project: { machineId, directory } },
          }),
          automationEvidenceEnvelope: null,
          cause,
          triggerId: null,
        },
      } as never,
    });

    expect(sessionInput.enqueue).toHaveBeenCalledOnce();
    const sentText = String(sessionInput.enqueue.mock.calls[0]?.[0]?.text ?? '');
    expect(leafLabel(sentText)).toBe('work');
    expect(sentText).not.toContain('**Workflow inputs**');
    expect(sentText).not.toContain('scheduledFor');
    const work = rowFor(kit, 'work');
    expect(work?.lifecycle).toBe('completed');
    expect(kit.run()).toMatchObject({
      origin: { kind: 'automation', automationId: 'automation-1' },
      state: 'succeeded',
      workflowCustodyState: 'settled',
    });
  });
});

describe('composed fresh-process reconstruction over durable rows', () => {
  it.each([
    {
      failurePolicy: 'collect_outcomes' as const,
      expected: { state: 'succeeded', completedWithFailures: true },
      terminalState: 'succeeded',
    },
    {
      failurePolicy: 'fail_stop' as const,
      expected: { state: 'interrupted', reason: 'session_input_failed' },
      terminalState: 'interrupted',
    },
  ])(
    'recomputes the same $failurePolicy outcome from persisted rows after the daemon is replaced',
    async ({ failurePolicy, expected, terminalState }) => {
      const runId = '33333333-3333-4333-8333-333333333333';
      const directory = await projectDirectory();
      const definition = fanOutDefinition(failurePolicy);
      const kit = createWorkflowRunStorageTestkit({
        runId, machineId, origin: { kind: 'direct' },
        acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
      });

      const first = sessionInputBoundary({ bad: 'failed' });
      const lossy = storageLosingFirstSettlement(kit);
      const claim = {
        runId, attempt: 0, expectedRevision: kit.run().revision,
        accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
      };
      await expect(workflowDaemonProcess({ storage: lossy, sessionInput: first, directory })(claim as never))
        .rejects.toThrowError('simulated_daemon_loss_before_settlement');
      expect(lossy.settlementWasLost()).toBe(true);
      expect(first.enqueue.mock.calls.map(([request]) => leafLabel(request.text)))
        .not.toContain('must-not-run');
      // Nothing about the outcome survives in this process: the parent never
      // settled and the next process starts with no materialized container.
      // Under `collect_outcomes` the container itself is durably settled, so
      // reconstruction must recompute its ordered outcomes without moving a
      // terminal row back to `running` — a transition the server's invocation
      // CAS refuses and the testkit reproduces.
      expect(kit.run().state).toBe('running');
      expect(rowFor(kit, 'fan')?.lifecycle)
        .toBe(failurePolicy === 'collect_outcomes' ? 'completed' : 'needs_attention');

      const second = sessionInputBoundary();
      const replacement = workflowDaemonProcess({ storage: kit, sessionInput: second, directory });
      await expect(replacement({ ...claim, expectedRevision: kit.run().revision } as never))
        .resolves.toMatchObject(expected);
      expect(second.enqueue).not.toHaveBeenCalled();
      expect(second.observe).not.toHaveBeenCalled();
      expect(kit.run().state).toBe(terminalState);
      expect(rowFor(kit, 'bad')?.lifecycle).toBe('failed');
      expect(rowFor(kit, 'must-not-run')).toBeUndefined();
    },
  );

  it('rebinds a loop source and its durable frontier to persisted producer rows in a replacement process', async () => {
    const runId = '44444444-4444-4444-8444-444444444444';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [
        step('seed', { result: { kind: 'json', schema: { type: 'number' } } }),
        {
          kind: 'loop',
          id: 'counted',
          repetition: {
            kind: 'count',
            count: { kind: 'result', producer: { blockId: 'seed', scope: { kind: 'current' } }, path: [] },
          },
          body: [step('work')],
        },
      ],
      finalOutput: { kind: 'result', producer: { blockId: 'counted', scope: { kind: 'current' } }, path: [] },
    };
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct' },
      acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
    });
    const seeded = sessionInputBoundary();
    // `seed` declares a numeric result contract, so the Session leaf must
    // return the exact decodable text the loop count resolves from.
    seeded.observe.mockImplementation(async (request: Readonly<{ localId: string }>) => ({
      ok: true as const, sessionId, localId: request.localId,
      result: { kind: 'final_text' as const, text: request.localId === 'seed' ? '3' : request.localId },
    }));
    // Lose the daemon between the loop's three iterations: `seed` and the first
    // `work` are durable, the loop frontier has advanced, and nothing about
    // the resolved count or the previous iteration survives in memory.
    let settled = 0;
    let crashed = false;
    const lossy = {
      execute: async (operation: WorkflowRunStorageTestkitOperation, options?: Readonly<{ signal?: AbortSignal }>) => {
        if (String(operation.operation) === 'invocations.admit' && settled >= 2 && !crashed) {
          crashed = true;
          throw new Error('simulated_daemon_loss_mid_loop');
        }
        const result = await kit.execute(operation, options);
        if (String(operation.operation) === 'invocations.fact' && String(operation.lifecycle) === 'completed') settled += 1;
        return result;
      },
    };
    const claim = {
      runId, attempt: 0, expectedRevision: kit.run().revision,
      accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
    };
    await expect(workflowDaemonProcess({ storage: lossy, sessionInput: seeded, directory })(claim as never))
      .rejects.toThrowError('simulated_daemon_loss_mid_loop');
    expect(seeded.enqueue.mock.calls.map(([request]) => leafLabel(request.text))).toEqual(['seed', 'work']);
    const loopRow = rowFor(kit, 'counted');
    expect(openRowProgress(kit, loopRow!).container).toMatchObject({
      kind: 'loop', mode: 'count', count: '3', nextMemberIndex: '1',
    });

    const replacement = sessionInputBoundary();
    await expect(workflowDaemonProcess({ storage: kit, sessionInput: replacement, directory })({
      ...claim, expectedRevision: kit.run().revision,
    } as never)).resolves.toMatchObject({
      state: 'succeeded',
      finalOutput: [{ work: 'work' }, { work: 'work' }, { work: 'work' }],
    });
    // The replacement resolves the count from the persisted `seed` row rather
    // than a rescanned name, replays nothing, and runs only iteration one.
    expect(replacement.enqueue.mock.calls.map(([request]) => leafLabel(request.text))).toEqual(['work', 'work']);
    expect(kit.run().state).toBe('succeeded');

    const completedRestart = sessionInputBoundary();
    await expect(workflowDaemonProcess({ storage: kit, sessionInput: completedRestart, directory })({
      ...claim, expectedRevision: kit.run().revision,
    } as never)).resolves.toMatchObject({
      state: 'succeeded',
      finalOutput: [{ work: 'work' }, { work: 'work' }, { work: 'work' }],
    });
    expect(completedRestart.enqueue).not.toHaveBeenCalled();
  });

  it('reconstructs all prior evaluator outcomes through the production store without replaying evaluator turns', async () => {
    const runId = '55555555-5555-4555-8555-555555555555';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [{
        kind: 'loop', id: 'judged',
        repetition: {
          kind: 'evaluate', maxIterations: 3, history: 'all',
          evaluator: step('evaluate', {
            result: { kind: 'decision', decisions: ['continue', 'stop'] },
          }),
        },
        body: [step('body')],
      }],
    };
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct' },
      acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
    });
    const first = sessionInputBoundary();
    let bodyObservations = 0;
    first.observe.mockImplementation(async (request: Readonly<{ localId: string }>) => {
      if (request.localId === 'body') {
        bodyObservations += 1;
        if (bodyObservations === 3) throw new Error('simulated_daemon_loss_before_third_evaluator');
        return {
          ok: true as const, sessionId, localId: request.localId,
          result: { kind: 'final_text' as const, text: 'body-result' },
        };
      }
      return {
        ok: true as const, sessionId, localId: request.localId,
        result: { kind: 'final_text' as const, text: JSON.stringify('continue') },
      };
    });
    const claim = {
      runId, attempt: 0, expectedRevision: kit.run().revision,
      accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
    };
    await expect(workflowDaemonProcess({ storage: kit, sessionInput: first, directory })(claim as never))
      .rejects.toThrowError('simulated_daemon_loss_before_third_evaluator');

    const replacement = sessionInputBoundary();
    replacement.observe.mockImplementation(async (request: Readonly<{ localId: string }>) => ({
      ok: true as const, sessionId, localId: request.localId,
      result: {
        kind: 'final_text' as const,
        text: request.localId === 'evaluate' ? JSON.stringify('stop') : 'body-result',
      },
    }));
    await expect(workflowDaemonProcess({ storage: kit, sessionInput: replacement, directory })({
      ...claim, expectedRevision: kit.run().revision,
    } as never)).resolves.toMatchObject({ state: 'succeeded' });

    const evaluatorInputs = kit.rows()
      .map(({ index }) => openRowProgress(kit, index))
      .filter((progress) => progress.invocationPath.blockId === 'evaluate')
      .sort((left, right) => {
        const leftIndex = left.invocationPath.scope.find((part) => part.kind === 'iteration')?.index ?? 0;
        const rightIndex = right.invocationPath.scope.find((part) => part.kind === 'iteration')?.index ?? 0;
        return leftIndex - rightIndex;
      })
      .map((progress) => isWorkflowJsonObject(progress.input) && Array.isArray(progress.input.input)
        ? progress.input.input
        : []);
    expect(evaluatorInputs).toEqual([
      [],
      [{ kind: 'evaluation_history', evaluations: ['continue'] }],
      [{ kind: 'evaluation_history', evaluations: ['continue', 'continue'] }],
    ]);

    const completedRestart = sessionInputBoundary();
    await expect(workflowDaemonProcess({ storage: kit, sessionInput: completedRestart, directory })({
      ...claim, expectedRevision: kit.run().revision,
    } as never)).resolves.toMatchObject({ state: 'succeeded' });
    expect(completedRestart.enqueue).not.toHaveBeenCalled();
  });
});

describe('composed boundary pause across admitted siblings', () => {
  it('drains an already admitted fail-stop sibling instead of aborting it when pause closes the next admission', async () => {
    const runId = '55555555-5555-4555-8555-555555555555';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [{
        kind: 'parallel',
        id: 'fan',
        failurePolicy: 'fail_stop',
        branches: [
          { id: 'slow', blocks: [step('slow-1')] },
          { id: 'quick', blocks: [step('quick-1'), step('quick-2')] },
        ],
      }],
    };
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct' },
      acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
    });

    let releaseSlow!: () => void;
    const slowSettles = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let slowAborted = false;
    const sessionInput = sessionInputBoundary({}, {
      onObserve: async (label, signal) => {
        if (label !== 'slow-1') return;
        signal?.addEventListener('abort', () => { slowAborted = true; });
        await slowSettles;
      },
    });

    let pauseRequested = false;
    const storage = {
      execute: async (operation: WorkflowRunStorageTestkitOperation, options?: Readonly<{ signal?: AbortSignal }>) => {
        if (!pauseRequested && String(operation.operation) === 'invocations.fact' && String(operation.lifecycle) === 'completed') {
          // `quick-1` is the only leaf that can settle while `slow-1` is gated.
          pauseRequested = true;
          const committed = await kit.execute(operation, options);
          kit.requestControl('pause_requested');
          return committed;
        }
        const result = await kit.execute(operation, options);
        // Release the admitted sibling only once the coordinator has actually
        // observed the pause at the next admission boundary.
        if (pauseRequested && String(operation.operation) === 'get') setTimeout(releaseSlow, 0);
        return result;
      },
    };

    await expect(workflowDaemonProcess({ storage, sessionInput, directory })({
      runId, attempt: 0, expectedRevision: kit.run().revision,
      accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
    } as never)).resolves.toMatchObject({ state: 'paused' });

    expect(slowAborted).toBe(false);
    expect(rowFor(kit, 'slow-1')?.lifecycle).toBe('completed');
    expect(rowFor(kit, 'quick-1')?.lifecycle).toBe('completed');
    expect(rowFor(kit, 'quick-2')).toBeUndefined();
    expect(kit.run().state).toBe('paused');
  });
});

describe('composed durable rows carry no fabricated defaults', () => {
  it('admits omitted-concurrency siblings together and persists no capacity wait or observation deadline', async () => {
    const runId = '66666666-6666-4666-8666-666666666666';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [{
        kind: 'parallel',
        id: 'fan',
        failurePolicy: 'collect_outcomes',
        branches: [
          { id: 'left', blocks: [step('left-1')] },
          { id: 'right', blocks: [step('right-1')] },
        ],
      }],
    };
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct' },
      acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
    });
    // Neither sibling may settle before both are admitted. A fabricated
    // concurrency fallback of one would deadlock this gate rather than merely
    // reordering work.
    let admitted = 0;
    let releaseBoth!: () => void;
    const bothAdmitted = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const sessionInput = sessionInputBoundary({}, {
      onObserve: async () => {
        admitted += 1;
        if (admitted >= 2) releaseBoth();
        await bothAdmitted;
      },
    });
    const lifecycles: string[] = [];
    const storage = {
      execute: async (operation: WorkflowRunStorageTestkitOperation, options?: Readonly<{ signal?: AbortSignal }>) => {
        if (typeof operation.lifecycle === 'string') lifecycles.push(operation.lifecycle);
        return await kit.execute(operation, options);
      },
    };
    await expect(workflowDaemonProcess({ storage, sessionInput, directory })({
      runId, attempt: 0, expectedRevision: kit.run().revision,
      accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
    } as never)).resolves.toMatchObject({ state: 'succeeded' });
    expect(admitted).toBe(2);
    expect(lifecycles).not.toContain('waiting_for_capacity');
    for (const row of kit.rows()) {
      expect(openRowProgress(kit, row.index).observationDeadline).toBeUndefined();
    }
  }, 20_000);

  it('queues only an authored container limit and persists one absolute deadline only for an authored timeout', async () => {
    const runId = '77777777-7777-4777-8777-777777777777';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [{
        kind: 'parallel',
        id: 'fan',
        failurePolicy: 'collect_outcomes',
        maxConcurrent: 1,
        branches: [
          { id: 'first', blocks: [step('untimed')] },
          { id: 'second', blocks: [step('timed', { timeoutMs: 60_000 })] },
        ],
      }],
    };
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct' },
      acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
    });
    const lifecycles: string[] = [];
    const storage = {
      execute: async (operation: WorkflowRunStorageTestkitOperation, options?: Readonly<{ signal?: AbortSignal }>) => {
        if (typeof operation.lifecycle === 'string') lifecycles.push(operation.lifecycle);
        return await kit.execute(operation, options);
      },
    };
    await expect(workflowDaemonProcess({ storage, sessionInput: sessionInputBoundary(), directory })({
      runId, attempt: 0, expectedRevision: kit.run().revision,
      accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
    } as never)).resolves.toMatchObject({ state: 'succeeded' });
    expect(lifecycles).toContain('waiting_for_capacity');
    expect(openRowProgress(kit, rowFor(kit, 'untimed')!).observationDeadline).toBeUndefined();
    expect(openRowProgress(kit, rowFor(kit, 'timed')!).observationDeadline).toMatchObject({ kind: 'at' });
  });
});

describe('composed off-page child attention discovery', () => {
  it('finds a nested attention row beyond the first page and opens its private progress at the Action host', async () => {
    const runId = '88888888-8888-4888-8888-888888888888';
    const directory = await projectDirectory();
    const definition: WorkflowDefinitionV1 = {
      version: 1,
      inputs: [],
      defaults: retainedConversationDefaults(),
      blocks: [
        step('opening'),
        {
          kind: 'parallel',
          id: 'fan',
          failurePolicy: 'collect_outcomes',
          branches: [{ id: 'stuck', blocks: [step('awaiting-human')] }],
        },
      ],
    };
    const kit = createWorkflowRunStorageTestkit({
      runId, machineId, origin: { kind: 'direct' },
      acceptedEnvelope: sealDirectAccepted({ runId, definition, directory }),
      // One row per page, so the nested attention row cannot be on page one.
      invocationPageSize: 1,
    });
    const lossy = storageLosingFirstSettlement(kit);
    await expect(workflowDaemonProcess({
      storage: lossy,
      sessionInput: sessionInputBoundary({ 'awaiting-human': 'needs_attention' }),
      directory,
    })({
      runId, attempt: 0, expectedRevision: kit.run().revision,
      accountCurrentness: currentness, acceptedEnvelope: kit.acceptedEnvelope()!,
    } as never)).rejects.toThrowError('simulated_daemon_loss_before_settlement');
    // The parent never settled, so the actionable child row — not a parent
    // state — is the only attention signal available to an observer.
    expect(kit.run().state).toBe('running');

    const runOwner = createWorkflowRunActionOwner({
      resolveAccountId: async () => accountId,
      storage: kit,
      definitions: { get: vi.fn() },
      resolveEncryption: async () => ({ kind: 'available', witness: currentness }),
      prepareWorkspace: async () => ({
        ok: true,
        workspaceTarget: { project: { machineId, directory, checkoutRootPath: directory } },
      }),
    });
    const workflowActions = createWorkflowActionExecutor({
      isWorkflowFeatureEnabled: async () => true,
      definitions: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      runs: runOwner,
    });
    const context = { surface: 'rpc' as const, authority: 'account_automation' as const };
    const invoke = async (actionId: string, input: unknown) => await workflowActions({ actionId, input, context } as never);

    type InvocationDetail = Readonly<{
      invocation: Readonly<{ progress: Readonly<{ invocationPath: Readonly<{ blockId: string; scope: readonly unknown[] }> }> }>;
    }>;
    let cursor: string | undefined;
    let pages = 0;
    let attentionPage = 0;
    let attention: InvocationDetail | undefined;
    do {
      const page = await invoke('workflow.run.invocations.list', {
        runId, lifecycles: ['waiting_for_approval', 'needs_attention', 'cancel_requested', 'outcome_uncertain'],
        ...(cursor ? { cursor } : {}),
      }) as Readonly<{ invocations: readonly WorkflowRunInvocationIndexV1[]; nextCursor?: string }>;
      pages += 1;
      for (const index of page.invocations) {
        // Exact private detail is opened only at the authorized Action host;
        // the server page carries structural index columns alone.
        const detail = await invoke('workflow.run.invocations.get', { runId, invocationId: index.id }) as InvocationDetail;
        if (detail.invocation.progress.invocationPath.blockId !== 'awaiting-human') continue;
        attention = detail;
        attentionPage = pages;
      }
      cursor = page.nextCursor;
    } while (cursor && !attention);
    expect(attention).toBeDefined();
    expect(attentionPage).toBeGreaterThan(1);
    expect(attention!.invocation.progress.invocationPath).toMatchObject({
      blockId: 'awaiting-human',
      scope: [{ kind: 'branch', blockId: 'fan', branchId: 'stuck' }],
    });

    // The server's indexed actionable predicate is owned and proven by
    // `workflowRunService.integration.spec.ts`; this asserts the composed CLI
    // path surfaces it instead of waiting out the caller's deadline.
    await expect(invoke('workflow.run.wait', { runId, timeoutSeconds: 1 }))
      .resolves.toMatchObject({ observation: 'needs_attention' });
  });
});

describe('composed Git workspace through the canonical SCM owner', () => {
  it('uses canonical path normalization and exercises shared plus revision-pinned worktree modes without force-removal', async () => {
    // Cross-platform path normalization stays with the canonical owner. No
    // test-only path helper is introduced here.
    await expect(prepareWorkflowAcceptedWorkspaceTarget({
      projectTarget: { machineId, directory: '~/repo/packages/app' },
      definition: { version: 1, inputs: [], defaults: {}, blocks: [step('only')] },
      env: { HOME: '/Users/alice' },
      platform: 'darwin',
      pathIsDirectory: async (path) => path === '/Users/alice/repo/packages/app',
      inspectLocation: async () => ({ inspection: { rootPath: '/Users/alice/repo' } }),
    })).resolves.toMatchObject({
      ok: true,
      workspaceTarget: { project: { directory: '/Users/alice/repo/packages/app', checkoutRootPath: '/Users/alice/repo' } },
    });
    expect(normalizeWorkflowProjectTarget({
      projectTarget: { machineId, directory: 'C:\\Users\\alice2\\repo' },
      env: { USERPROFILE: 'C:\\Users\\alice' },
      platform: 'win32',
    })).toMatchObject({ directory: 'C:\\Users\\alice2\\repo' });

    const execFileAsync = promisify(execFile);
    const root = await mkdtemp(join(tmpdir(), 'happier-composed-workspace-'));
    const git = createGitWorkflowWorkspaceTestDependencies();
    try {
      const directory = join(root, 'packages', 'app');
      await mkdir(directory, { recursive: true });
      await writeFile(join(root, 'README.md'), 'original\n', 'utf8');
      await writeFile(join(directory, 'index.ts'), 'export const fixture = true;\n', 'utf8');
      await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: root });
      await execFileAsync('git', ['add', 'README.md', 'packages/app/index.ts'], { cwd: root });
      await execFileAsync('git', [
        '-c', 'user.name=Workflow Test',
        '-c', 'user.email=workflow-test@example.invalid',
        'commit', '-m', 'test: seed composed workspace',
      ], { cwd: root });
      const revision = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
      await writeFile(join(root, 'README.md'), 'unstaged-after-staged\n', 'utf8');
      await writeFile(join(root, 'untracked.txt'), 'untracked\n', 'utf8');
      const dirtyStatus = (await execFileAsync('git', ['status', '--short'], { cwd: root })).stdout;
      expect(dirtyStatus).not.toBe('');

      const projectWorkspace = { machineId, directory, checkoutRootPath: root };
      // Shared checkout reuses the exact dirty source through the real SCM
      // owner. There is no reset, merge, commit, or force-removal here.
      const shared = await resolveWorkflowWorkspace({
        selection: { kind: 'project_checkout' },
        defaultSelection: { kind: 'project_checkout' },
        projectWorkspace,
        runId: 'run-composed-git',
        logicalInvocationRecordId: 'shared',
        deps: {},
      });
      expect(shared).toEqual({ ok: true, workspace: projectWorkspace });

      const created = await resolveWorkflowWorkspace({
        selection: { kind: 'new_worktree', source: { kind: 'workflow' } },
        defaultSelection: { kind: 'project_checkout' },
        projectWorkspace,
        runId: 'run-composed-git',
        logicalInvocationRecordId: 'isolated',
        deps: git,
      });
      expect(created).toMatchObject({
        ok: true,
        workspace: { machineId, checkout: { kind: 'git_worktree' } },
      });
      if (!created.ok) throw new Error(created.code);
      expect(created.workspace.checkoutRootPath).not.toBe(root);
      expect(created.workspace.directory).toBe(join(created.workspace.checkoutRootPath, 'packages', 'app'));
      // A workflow fork is committed-only: dirty and untracked source state
      // stays at the source and never enters the new worktree.
      expect(await readFile(join(created.workspace.checkoutRootPath, 'README.md'), 'utf8')).toBe('original\n');
      await expect(readFile(join(created.workspace.checkoutRootPath, 'untracked.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: created.workspace.checkoutRootPath })).stdout.trim()).toBe(revision);
      expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('unstaged-after-staged\n');

      // The coordinator row-local resolver binds from-step scope through the
      // same durable store owner used by execution.
      const store = createInMemoryWorkflowCoordinatorStore();
      const sourceKey = workflowInvocationKey({ runId: 'run-composed-git', blockId: 'a', scope: [], attempt: 0 });
      await store.ensureIntent({ key: sourceKey, recordId: 'inv-a', runId: 'run-composed-git', blockId: 'a', path: { blockId: 'a', scope: [] }, attempt: 0, acceptedAtMs: 1, lifecycle: 'completed', workspace: { descriptor: projectWorkspace } });
      const targetKey = workflowInvocationKey({ runId: 'run-composed-git', blockId: 'b', scope: [], attempt: 0 });
      const target = await store.ensureIntent({ key: targetKey, recordId: 'inv-b', runId: 'run-composed-git', blockId: 'b', path: { blockId: 'b', scope: [] }, attempt: 0, acceptedAtMs: 2, lifecycle: 'admitting' });
      const resolver = createCoordinatorWorkspaceResolver({
        store,
        projectWorkspace,
        scm: { verifyRecordedWorkspace: async () => 'available' as const },
      });
      await expect(resolver({
        runId: 'run-composed-git',
        definition: { version: 1, inputs: [], defaults: {}, blocks: [step('b')] },
        step: { kind: 'step', id: 'b', document: { text: 'b', references: [], attachments: [] }, input: [], result: { kind: 'text' }, execution: { workspace: { kind: 'from_step', producer: { blockId: 'a', scope: { kind: 'current' } } } } },
        invocation: target,
        scope: [],
      })).resolves.toMatchObject({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('composed Session approvals and observation deadlines', () => {
  it('passes permission ceilings and authored timeouts through canonical Session owners', async () => {
    const workspace = { machineId, directory: '/repo', checkoutRootPath: '/repo' } as const;
    const executionTarget = { kind: 'session' } as const;
    // A broader step permission than the immutable admitted ceiling is
    // rejected by the canonical Session leaf before any Session mutation.
    const deniedPrepare = vi.fn();
    const deniedEnqueue = vi.fn();
    const denied = createWorkflowSessionStepExecutor({
      credentials: { token: 'token' } as never,
      resolveMachineOperationProtocolCapabilities: async () => null,
      prepareConversation: deniedPrepare,
      materializeConversation: vi.fn(),
      sessionInput: { preflight: vi.fn(), enqueue: deniedEnqueue, observe: vi.fn(), cancel: vi.fn() },
    });
    await expect(denied({
      runId: 'run-approvals',
      step: {},
      invocation: { logicalInvocationRecordId: 'inv-1' },
      input: { text: 'work', references: [], attachments: [], values: [] },
      execution: { permissionMode: 'safe-yolo' },
      authorization: { admittedPermissionCeiling: 'read-only', principal: { kind: 'host' } },
      workspace,
      onInputAccepted: vi.fn(),
    } as never)).resolves.toEqual({ kind: 'failed', code: 'workflow_permission_escalation_denied' });
    expect(deniedPrepare).not.toHaveBeenCalled();
    expect(deniedEnqueue).not.toHaveBeenCalled();

    // Omitted timeoutMs means no authored observation deadline through the
    // real coordinator plus the real Session leaf. A present timeout persists
    // one absolute deadline. Neither path invents a numeric fallback.
    const store = createInMemoryWorkflowCoordinatorStore();
    const observedDeadlines: Array<unknown> = [];
    const enqueue = vi.fn(async () => ({ status: 'accepted' as const, localId: 'local-1' }));
    const observe = vi.fn(async (input: { deadlineMs?: number }) => {
      observedDeadlines.push(input.deadlineMs);
      return { ok: true as const, sessionId: 'session-1', localId: 'local-1', result: { kind: 'final_text' as const, text: 'done' } };
    });
    const sessionOwner = createWorkflowSessionStepExecutor({
      credentials: { token: 'token' } as never,
      resolveMachineOperationProtocolCapabilities: async () => ({
        sessionInputAdmission: { protocolVersions: [1, 2] },
      }),
      prepareConversation: async () => ({ kind: 'workflow_session_conversation', existing: null }),
      materializeConversation: async () => ({ sessionId: 'session-1', machineAdmissionTransport: vi.fn() }),
      sessionInput: {
        preflight: () => ({ ok: true }),
        enqueue: enqueue as never,
        observe: observe as never,
        cancel: vi.fn() as never,
      },
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      executeStep: sessionOwner,
      resolveWorkspace: async () => ({ ok: true as const, workspace }),
    });
    const definition = {
      version: 1 as const,
      inputs: [],
      defaults: { agentTarget },
      blocks: [
        step('no-timeout'),
        step('with-timeout', { timeoutMs: 60_000 }),
      ],
    };
    await expect(coordinator.run({ runId: 'run-deadlines', definition, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observedDeadlines[0]).toBeUndefined();
    expect(typeof observedDeadlines[1]).toBe('number');
  });
});

describe('composed practical large Run without invented limits', () => {
  it('advances 500 ordered duplicate-preserving items through the real coordinator with bounded resources', async () => {
    const runId = '99999999-9999-4999-8999-999999999999';
    const store = createInMemoryWorkflowCoordinatorStore();
    const workspace = { machineId, directory: '/repo', checkoutRootPath: '/repo' } as const;
    const executionTarget = { kind: 'session' } as const;
    // 50 practical file names repeated 10 times preserve order and
    // duplicates. This fixture proves no item/invocation quota rejects a
    // valid large Run; it does not add a product limit or timeout.
    const files = Array.from({ length: 500 }, (_, index) => `src/file-${index % 50}.ts`);
    const seen: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      executeStep: async ({ step: current, item }) => {
        seen.push(String(item?.value));
        return { kind: 'completed' as const, result: String(item?.value ?? current.id) };
      },
      resolveWorkspace: async () => ({ ok: true as const, workspace }),
    });
    const definition = {
      version: 1 as const,
      inputs: [],
      defaults: { agentTarget },
      blocks: [{
        kind: 'loop' as const,
        id: 'files',
        repetition: {
          kind: 'items' as const,
          items: { kind: 'literal' as const, value: files },
          execution: 'sequential' as const,
          failurePolicy: 'collect_outcomes' as const,
        },
        body: [step('process', { input: [{ kind: 'item', field: 'value' }] })],
      }],
    };
    await expect(coordinator.run({ runId, definition, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(seen).toEqual(files);
    const processed = [...store.records.values()].filter((record) => record.blockId === 'process');
    expect(processed).toHaveLength(500);
    expect(processed.map((record) => record.result)).toEqual(files);
  }, 20_000);
});
