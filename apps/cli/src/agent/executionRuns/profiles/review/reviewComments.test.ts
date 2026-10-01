import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEW_COMMENT_PRINCIPAL_HEADER_V1,
  ReviewCommentCreateRequestV1Schema,
  ReviewCommentPrincipalHeaderV1Schema,
  ReviewCommentTransitionRequestV1Schema,
  ReviewCommentV1Schema,
  ReviewCommentPrepareMutationRequestV1Schema,
  ReviewCommentCommitMutationRequestV1Schema,
  deriveReviewCommentStructuralMutationV1,
  splitReviewCommentV1,
  sealReviewCommentSensitiveEnvelopeV1,
  type ReviewCommentPreparedRecordV1,
  createReviewCommentPrincipalSigningInputV1,
  createActionExecutor,
  type ActionExecutorDeps,
  type ReviewCommentV1,
} from '@happier-dev/protocol';
import { createCliReviewCommentActionExecutorFromCredentials } from '@/agent/reviews/comments/executor';
import { finishExecutionRun } from '@/agent/runtime/bridges/executionRun/finishExecutionRun';
import { applyExecutionRunAction } from '@/agent/runtime/bridges/executionRun/executionRunApplyAction';
import { ExecutionRunHostBridge } from '@/agent/runtime/bridges/executionRun/ExecutionRunHostBridge';
import type { ExecutionRunState } from '@/agent/runtime/bridges/executionRun/executionRunTypes';
import { createReviewRunCommentService, projectReviewRunTriage } from './reviewComments';
import { createActionToolExecutorBridge } from '@/agent/tools/happierTools/createActionToolExecutorBridge';
import { createCliActionDeps } from '@/session/actions/createCliActionDeps';

// Only HTTP and environment configuration are substituted. Snapshot, protocol,
// signing, event envelopes, triage mapping, and terminalization remain real.
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn() } }));
const environment = vi.hoisted(() => ({ homeDir: '' }));
vi.mock('@/configuration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/configuration')>();
  return { ...actual, configuration: { ...actual.configuration, get happyHomeDir() { return environment.homeDir; } } };
});

let root = '';
const terminalWrites = new Map<string, Promise<void>>();
const signingKeys = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const workspace = { machineId: 'machine-1', path: '/repo' };
const findings = [
  { id: 'file-finding', title: 'Validate input', severity: 'high' as const, category: 'correctness' as const, filePath: 'a.ts', startLine: 1, summary: 'Reject invalid input.' },
  { id: 'global-finding', title: 'Missing rollback', severity: 'medium' as const, category: 'testing' as const, summary: 'Exercise rollback.' },
];

function run(): ExecutionRunState {
  return {
    runId: 'review-run', callId: 'review-call', sidechainId: 'review-sidechain', sessionId: 'session-1', depth: 0,
    intent: 'review', backendId: 'claude', backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
    instructions: 'Review.', permissionMode: 'read_only', retentionPolicy: 'ephemeral', runClass: 'bounded',
    ioMode: 'request_response', status: 'running', startedAtMs: 1,
    intentInput: { reviewedFingerprint: 'launch-fingerprint' }, display: { groupId: 'panel-1' },
  };
}

function commentForCreate(body: unknown, state: ReviewCommentV1['state'] = 'proposed'): ReviewCommentV1 {
  const input = ReviewCommentCreateRequestV1Schema.parse(body);
  const { eventEnvelope, authorIntent, clientMutationId, ...fields } = input;
  return ReviewCommentV1Schema.parse({
    ...fields,
    v: 1, id: `comment-${input.findingId}`, threadId: `comment-${input.findingId}`, accountId: 'account-1',
    bodyVersion: 1, author: { kind: 'agent', agentId: 'claude', sessionId: 'session-1' },
    state, flags: {}, dispositions: {}, edits: [], transitions: [], createdAt: 1, updatedAt: 1, serverRevision: 3,
  });
}

function transport() {
  return createCliReviewCommentActionExecutorFromCredentials({
    credentials: { token: 'token-1', encryption: null },
    resolveAccountId: () => 'account-1',
    // Account mode and installation signing key are genuine server/OS boundaries.
    resolveAccountEncryptionMode: async () => 'plain',
    resolvePrincipalSigningContext: async () => ({
      machineId: workspace.machineId, installationId: 'installation-1',
      privateKeyBase64Url: Buffer.from(signingKeys.secretKey).toString('base64url'),
    }),
  });
}

function plainStoredComment(comment: ReviewCommentV1) {
  const split = splitReviewCommentV1(comment);
  return { v: 1, structural: split.structural, sensitiveEnvelope: sealReviewCommentSensitiveEnvelopeV1({ ...split, mode: 'plain' }) };
}

function service() {
  return createReviewRunCommentService({ cwd: root, scope: { workspace }, execute: transport(), resolveTriageActor: () => ({ kind: 'agent', agentId: 'claude', sessionId: 'session-1' }) });
}

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'happier-review-comments-'));
  environment.homeDir = root;
  await writeFile(join(root, 'a.ts'), 'input();\n', 'utf8');
});
afterEach(async () => {
  await Promise.all(terminalWrites.values());
  await rm(root, { recursive: true, force: true });
});

describe('canonical review Run comments', () => {
  it('keeps an admitted Workflow identity in private exact-daemon transport context, not request JSON', async () => {
    let observed = false;
    const deps = createCliActionDeps({
      sessionId: 'cli-global', token: 'token-1', credentials: { token: 'token-1', encryption: null }, mode: 'plain', ctx: null,
      // The direct daemon invocation is the process transport boundary.
      machineActionDirectTargetTransport: { machineId: 'machine-1', invoke: async (_method, request, options) => {
        observed = true;
        expect(request).not.toHaveProperty('workflowRunId');
        expect(options).toMatchObject({ executionRunWorkflowRunId: 'workflow-1' });
        return { ok: true, runId: 'review-run' };
      } },
    });
    await deps.executionRunStart(null, { intent: 'review' }, { exactMachineId: 'machine-1', workflowRunId: 'workflow-1' });
    expect(observed).toBe(true);
  });
  it('does not infer user acceptance from an automatically opened comment', () => {
    const comment = commentForCreate({ workspace, sessionId: 'session-1', runId: 'review-run', findingId: 'file-finding', anchor: { kind: 'finding', runId: 'review-run', findingId: 'file-finding' }, snapshot: { kind: 'none', capturedAt: 1 }, body: 'Finding', clientMutationId: 'fixture' }, 'open');
    expect(projectReviewRunTriage([comment])).toEqual({ findings: [] });
  });

  it('reports a file snapshot failure instead of representing it as a global finding with no snapshot', async () => {
    const result = await service().materialize({ run: run(), findings: [{ ...findings[0], filePath: 'missing.ts' }], reviewedFingerprint: null });
    expect(result).toMatchObject({ status: 'failed', failures: [{ findingId: 'file-finding', errorCode: 'review_comment_snapshot_unavailable' }] });
    expect(axios.post).not.toHaveBeenCalled();
  });
  it('records a live run\'s triage only in ReviewComment and never rewrites or re-publishes the review result', async () => {
    const created = commentForCreate({ workspace, sessionId: 'session-1', runId: 'review-run', engineId: 'claude', findingId: 'file-finding', anchor: { kind: 'file', filePath: 'a.ts' }, snapshot: { kind: 'none', capturedAt: 1 }, body: 'Reject invalid input.', clientMutationId: 'fixture' }, 'proposed');
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { comment: plainStoredComment(created) } });
    vi.mocked(axios.post).mockImplementation(async (_url, body) => {
      const request = ReviewCommentTransitionRequestV1Schema.parse({ ...(body as object), commentId: created.id });
      expect(request).toMatchObject({ expectedState: 'proposed', toState: 'open', reviewTriageStatus: 'accept' });
      return { status: 200, data: { comment: { ...created, state: 'open', reviewTriageStatus: 'accept', serverRevision: 4 } } };
    });
    const payload = { runRef: { runId: 'review-run', callId: 'review-call', backendId: 'claude' }, summary: 'Findings', overviewMarkdown: 'Findings', findings: [{ ...findings[0], comment: { id: created.id, state: 'proposed' as const, serverRevision: 3, workspace } }], questions: [], assumptions: [], generatedAtMs: 2 };
    const live = { ...run(), status: 'succeeded' as const, structuredMeta: { kind: 'review_findings.v2' as const, payload } };
    const runs = new Map([[live.runId, live]]);
    const committed: unknown[] = [];
    const result = await applyExecutionRunAction({
      runId: live.runId, params: { actionId: 'review.triage', input: { findings: [{ id: 'file-finding', status: 'accept' }] } },
      runs, controllers: new Map(), voiceAgentManager: {} as never, startRun: async () => { throw new Error('not started'); },
      enqueueCommittedAcp: async (_provider, body) => { committed.push(body); return { persisted: true, delivered: true }; },
      parentProvider: 'claude', reviewComments: service(),
    });
    expect(result).toMatchObject({ ok: true, result: { triage: { findings: [{ id: 'file-finding', status: 'accept' }] }, commentIds: [created.id] } });
    expect(runs.get(live.runId)?.structuredMeta).toEqual(live.structuredMeta);
    expect((runs.get(live.runId)?.structuredMeta?.payload as { triage?: unknown }).triage).toBeUndefined();
    expect(committed).toEqual([]);
  });
  it('uses the live host Agent principal through real tool dispatch and signed HTTP, never input identity', async () => {
    const execute = transport();
    // Unreached network/RPC ports are omitted from this boundary fixture.
    const executor = createActionExecutor({ reviewCommentAction: async (args) => execute(args.actionId, args.input, {
      ...(args.reviewCommentPrincipal ? { principal: args.reviewCommentPrincipal } : {}),
    }) } as ActionExecutorDeps);
    vi.mocked(axios.get).mockImplementation(async (_url, config) => {
      const principal = ReviewCommentPrincipalHeaderV1Schema.parse(JSON.parse(Buffer.from(String(config?.headers?.[REVIEW_COMMENT_PRINCIPAL_HEADER_V1]), 'base64url').toString('utf8')));
      expect(principal.actor).toEqual({ kind: 'agent', agentId: 'claude', sessionId: 'session-1' });
      expect(config?.params).toMatchObject({ sessionId: 'session-1' });
      return { status: 200, data: { items: [], cursor: null } };
    });
    const bridge = createActionToolExecutorBridge({ executor, surface: 'agent', resolveReviewCommentActor: () => ({ kind: 'agent', agentId: 'claude', sessionId: 'session-1' }) });
    expect(await bridge.executeActionByToolName('action_execute', { actionId: 'reviews.comments.list', input: { runId: 'review-run' }, agentId: 'forged' }, 'session-1')).toMatchObject({ ok: true });
    const unbound = createActionToolExecutorBridge({ executor, surface: 'agent' });
    expect(await unbound.executeActionByToolName('action_execute', { actionId: 'reviews.comments.list', input: {} }, 'session-1')).toMatchObject({ ok: false, errorCode: 'review_comment_permission_denied' });
  });
  it('materializes every finding with actual engine identity, launch fingerprint, snapshots and a signed host intent', async () => {
    const posted: unknown[] = [];
    vi.mocked(axios.post).mockImplementation(async (_url, body, config) => {
      posted.push(body);
      const principal = ReviewCommentPrincipalHeaderV1Schema.parse(JSON.parse(Buffer.from(String(config?.headers?.[REVIEW_COMMENT_PRINCIPAL_HEADER_V1]), 'base64url').toString('utf8')));
      expect(principal.currentIntent).toMatchObject({ kind: 'review_findings_materialization', sessionId: 'session-1', runId: 'review-run', agentId: 'claude', workspace });
      const proof = principal.proof!;
      const { signatureBase64Url, ...unsignedProof } = proof;
      expect(tweetnacl.sign.detached.verify(
        createReviewCommentPrincipalSigningInputV1({ actor: principal.actor, currentIntent: principal.currentIntent, proof: unsignedProof }),
        Buffer.from(signatureBase64Url, 'base64url'), signingKeys.publicKey,
      )).toBe(true);
      return { status: 200, data: { comment: commentForCreate(body), replayed: false } };
    });

    const result = await service().materialize({ run: run(), findings, reviewedFingerprint: 'launch-fingerprint' });

    expect(result).toMatchObject({ status: 'materialized', commentIds: ['comment-file-finding', 'comment-global-finding'], engineId: 'claude' });
    expect(posted[0]).toMatchObject({ engineId: 'claude', reviewedFingerprint: 'launch-fingerprint', snapshot: { kind: 'text', selectedLines: ['input();'] }, metadata: { reviewGroupIds: ['panel-1'] } });
    expect(posted[1]).toMatchObject({ snapshot: { kind: 'none' }, findingIdentity: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('materializes automatic E2EE findings through signed authorized structure without disclosing sensitive bytes', async () => {
    const posted: unknown[] = [];
    let prepared: ReviewCommentPreparedRecordV1[] = [];
    let commitment = '';
    vi.mocked(axios.post).mockImplementation(async (url, body, config) => {
      posted.push(body);
      const principal = ReviewCommentPrincipalHeaderV1Schema.parse(JSON.parse(Buffer.from(String(config?.headers?.[REVIEW_COMMENT_PRINCIPAL_HEADER_V1]), 'base64url').toString('utf8')));
      const { signatureBase64Url, ...proof } = principal.proof!;
      expect(tweetnacl.sign.detached.verify(createReviewCommentPrincipalSigningInputV1({ actor: principal.actor,
        currentIntent: principal.currentIntent, proof }), Buffer.from(signatureBase64Url, 'base64url'), signingKeys.publicKey)).toBe(true);
      if (String(url).endsWith('/mutations/prepare')) {
        const request = ReviewCommentPrepareMutationRequestV1Schema.parse(body);
        commitment = request.contentCommitment;
        prepared = deriveReviewCommentStructuralMutationV1({ mutation: request.mutation, accountId: 'account-1',
          actor: principal.actor, current: [], runtime: { now: () => 100,
            createId: (kind) => kind === 'review-comment' ? 'comment-file-finding' : `${kind}-1` } }).records;
        expect(principal.currentIntent).toMatchObject({ kind: 'review_findings_materialization', effectBodySha256Base64Url: commitment });
        return { status: 200, data: { v: 1, receipt: 'receipt-1', request, records: prepared, replayed: false, failed: [] } };
      }
      const request = ReviewCommentCommitMutationRequestV1Schema.parse(body);
      expect(principal.currentIntent?.effectBodySha256Base64Url).toBe(commitment);
      return { status: 200, data: { v: 1, comments: request.records.map((record) => ({ v: 1,
        structural: prepared.find((item) => item.structural.id === record.commentId)!.structural,
        sensitiveEnvelope: record.sensitiveEnvelope })), replayed: false, failed: [] } };
    });
    const execute = createCliReviewCommentActionExecutorFromCredentials({
      credentials: { token: 'token-1', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(5) } },
      resolveAccountId: () => 'account-1',
      resolveAccountEncryptionMode: async () => 'e2ee',
      resolvePrincipalSigningContext: async () => ({
        machineId: workspace.machineId, installationId: 'installation-1',
        privateKeyBase64Url: Buffer.from(signingKeys.secretKey).toString('base64url'),
      }),
    });
    const result = await createReviewRunCommentService({ cwd: root, scope: { workspace }, execute })
      .materialize({ run: run(), findings: [findings[0]], reviewedFingerprint: null });
    const wire = JSON.stringify(posted);
    expect(wire).not.toContain(findings[0].summary);
    expect(wire).not.toContain('input();');
    expect(posted).toHaveLength(2);
    expect(result).toMatchObject({ status: 'materialized', commentIds: ['comment-file-finding'] });
  });

  it('adds current panel membership to a deduplicated comment through a separately signed CAS transition', async () => {
    const existing = commentForCreate({ workspace, sessionId: 'session-1', runId: 'older-run', engineId: 'codex', findingId: 'file-finding',
      anchor: { kind: 'file', filePath: 'a.ts' }, snapshot: { kind: 'none', capturedAt: 1 }, body: 'Finding', clientMutationId: 'older' });
    let attached = false;
    vi.mocked(axios.post).mockImplementation(async (url, body, config) => {
      if (!String(url).endsWith('/transition')) return { status: 200, data: { comment: existing, replayed: true } };
      const request = ReviewCommentTransitionRequestV1Schema.parse({ ...(body as object), commentId: existing.id });
      expect(request).toMatchObject({ expectedState: 'proposed', toState: 'proposed', expectedServerRevision: 3,
        reviewGroupId: 'panel-1' });
      const principal = ReviewCommentPrincipalHeaderV1Schema.parse(JSON.parse(Buffer.from(String(config?.headers?.[REVIEW_COMMENT_PRINCIPAL_HEADER_V1]), 'base64url').toString('utf8')));
      expect(principal.actor).toEqual({ kind: 'agent', agentId: 'claude', sessionId: 'session-1' });
      attached = true;
      return { status: 200, data: { comment: { ...existing, serverRevision: 4, metadata: { reviewGroupIds: [request.reviewGroupId] } } } };
    });
    expect(await service().materialize({ run: run(), findings: [findings[0]], reviewedFingerprint: null }))
      .toMatchObject({ status: 'materialized', commentIds: [existing.id], comments: [{ comment: { serverRevision: 4 } }] });
    expect(attached).toBe(true);
  });

  it.each([
    { currentState: 'open' as const, groups: ['panel-1'], expected: 'materialized' },
    { currentState: 'open' as const, groups: ['another-panel'], expected: 'failed' },
    { currentState: 'dismissed' as const, groups: ['panel-1'], expected: 'failed' },
  ])('accepts a concurrent re-raise only with proven membership and reopening: $currentState / $groups', async ({ currentState, groups, expected }) => {
    const existing = commentForCreate({ workspace, sessionId: 'session-1', runId: 'older-run', engineId: 'codex', findingId: 'file-finding',
      anchor: { kind: 'file', filePath: 'a.ts' }, snapshot: { kind: 'none', capturedAt: 1 }, body: 'Finding', clientMutationId: 'older' }, 'dismissed');
    vi.mocked(axios.post).mockImplementation(async (url) => String(url).endsWith('/transition')
      ? { status: 409, data: { error: 'review_comment_conflict' } }
      : { status: 200, data: { comment: existing, replayed: true } });
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { comment: plainStoredComment({
      ...existing, state: currentState, serverRevision: 4, metadata: { reviewGroupIds: groups },
    }) } });
    const result = await service().materialize({ run: run(), findings: [findings[0]], reviewedFingerprint: null });
    expect(result.status).toBe(expected);
    if (expected === 'materialized') expect(result).toMatchObject({ commentIds: [existing.id], comments: [{ comment: { state: 'open', serverRevision: 4 } }] });
    else expect(result).toMatchObject({ commentIds: [], failures: [{ errorCode: 'review_comment_conflict' }] });
  });

  it('materializes a detached workflow review with only its admitted Workflow identity, without synthesizing a Session', async () => {
    vi.mocked(axios.post).mockImplementation(async (_url, body, config) => {
      const principal = ReviewCommentPrincipalHeaderV1Schema.parse(JSON.parse(Buffer.from(String(config?.headers?.[REVIEW_COMMENT_PRINCIPAL_HEADER_V1]), 'base64url').toString('utf8')));
      expect(principal.actor).toEqual({ kind: 'workflow', runId: 'workflow-1' });
      expect(principal.currentIntent).toMatchObject({ kind: 'review_findings_materialization', workflowRunId: 'workflow-1' });
      expect(principal.currentIntent).not.toHaveProperty('sessionId');
      expect(body).not.toHaveProperty('sessionId');
      return { status: 200, data: { comment: { ...commentForCreate(body), author: principal.actor }, replayed: false } };
    });
    expect(await service().materialize({ run: { ...run(), sessionId: null }, findings: [findings[1]], reviewedFingerprint: null, workflowRunId: 'workflow-1' })).toMatchObject({ status: 'materialized', commentIds: ['comment-global-finding'] });
  });

  it('reuses a canonical dismissed finding and re-raises it with fresh CAS rather than creating another comment', async () => {
    let dismissed: ReviewCommentV1 | undefined;
    vi.mocked(axios.post).mockImplementation(async (url, body) => {
      if (!String(url).endsWith('/transition')) {
        dismissed = { ...commentForCreate(body, 'dismissed'), id: 'retained-comment', threadId: 'retained-comment', serverRevision: 8 };
        return { status: 200, data: { comment: dismissed, replayed: true } };
      }
      expect(body).toMatchObject({ expectedState: 'dismissed', expectedServerRevision: 8, toState: 'open' });
      return { status: 200, data: { comment: { ...dismissed, state: 'open', serverRevision: 9, flags: { disputed: true } } } };
    });
    const result = await service().materialize({ run: run(), findings: [findings[1]], reviewedFingerprint: null });
    expect(result).toMatchObject({ status: 'materialized', commentIds: ['retained-comment'], comments: [{ findingId: 'global-finding', comment: { id: 'retained-comment', state: 'open', serverRevision: 9 } }] });
  });

  it('preserves defer under same-state CAS after the run is evicted, and propagates a real HTTP CAS conflict', async () => {
    // A fresh host has no in-memory Run; durable references must remain usable.
    const bridge = new ExecutionRunHostBridge({ parentProvider: 'claude', cwd: root, sendAcp: async () => {}, reviewComments: service() });
    const created = commentForCreate({ workspace, sessionId: 'session-1', runId: 'review-run', engineId: 'claude', findingId: 'file-finding', anchor: { kind: 'file', filePath: 'a.ts' }, snapshot: { kind: 'none', capturedAt: 1 }, body: 'Reject invalid input.', clientMutationId: 'fixture' }, 'open');
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { comment: plainStoredComment(created) } });
    vi.mocked(axios.post).mockImplementation(async (_url, body, config) => {
      if (!body || typeof body !== 'object') throw new Error('Missing transition body');
      const principal = ReviewCommentPrincipalHeaderV1Schema.parse(JSON.parse(Buffer.from(String(config?.headers?.[REVIEW_COMMENT_PRINCIPAL_HEADER_V1]), 'base64url').toString('utf8')));
      expect(principal.actor).toEqual({ kind: 'agent', agentId: 'claude', sessionId: 'session-1' });
      const request = ReviewCommentTransitionRequestV1Schema.parse({ ...body, commentId: created.id });
      expect(request).toMatchObject({ expectedState: 'open', expectedServerRevision: 3, toState: 'open', reviewTriageStatus: 'defer' });
      return { status: 200, data: { comment: { ...created, reviewTriageStatus: 'defer', serverRevision: 4 } } };
    });
    expect(await bridge.applyAction('review-run', { actionId: 'review.triage', input: { findings: [{ id: 'file-finding', commentId: created.id, status: 'defer' }] } })).toMatchObject({ ok: true, result: { triage: { findings: [{ id: 'file-finding', status: 'defer' }] } } });
    vi.mocked(axios.post).mockImplementation(async (_url, body) => {
      if (!body || typeof body !== 'object') throw new Error('Missing transition body');
      expect(ReviewCommentTransitionRequestV1Schema.parse({ ...body, commentId: created.id })).toMatchObject({ toState: 'dismissed', expectedServerRevision: 3, reviewTriageStatus: 'reject', reason: 'Not reachable.' });
      return { status: 409, data: { error: 'review_comment_conflict' } };
    });
    expect(await bridge.applyAction('review-run', { actionId: 'review.triage', input: { findings: [{ id: 'file-finding', commentId: created.id, status: 'reject', comment: 'Not reachable.' }] } })).toMatchObject({ ok: false, errorCode: 'review_comment_conflict' });
  });

  it('keeps terminal success unobservable until canonical materialization completes', async () => {
    let release!: () => void;
    let observedRequest!: () => void;
    const requested = new Promise<void>((resolve) => { observedRequest = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(axios.post).mockImplementation(async (_url, body) => {
      observedRequest();
      await pending;
      return { status: 200, data: { comment: commentForCreate(body), replayed: false } };
    });
    const initial = run();
    const runs = new Map([[initial.runId, initial]]);
    const comments = service();
    const published: unknown[] = [];
    const finished = finishExecutionRun({
      runId: initial.runId, next: { status: 'succeeded', finishedAtMs: 2 }, toolResult: { output: { findings } },
      structuredMeta: { kind: 'review_findings.v2', payload: { runRef: { runId: initial.runId, callId: initial.callId, backendId: 'claude' }, summary: 'Findings', overviewMarkdown: 'Findings', findings, questions: [], assumptions: [], generatedAtMs: 2 } },
      runs, controllers: new Map(), budgetRegistry: null, parentProvider: 'claude',
      sendAcp: async (_provider, message) => { published.push(message); },
      enqueueMarkerWrite: async (_runId, write) => { await write(); }, terminalMarkerWritePromises: terminalWrites,
      reviewComments: comments,
    });
    await requested;
    expect(runs.get(initial.runId)?.status).toBe('running');
    expect(published).toEqual([]);
    release();
    await finished;
    expect(runs.get(initial.runId)).toMatchObject({ status: 'succeeded', latestToolResult: { commentIds: ['comment-file-finding', 'comment-global-finding'], reviewedFingerprint: 'launch-fingerprint', materialization: { kind: 'complete' } } });
    expect(runs.get(initial.runId)?.structuredMeta?.payload).toMatchObject({ findings: [{ comment: { id: 'comment-file-finding', state: 'proposed', serverRevision: 3 } }, { comment: { id: 'comment-global-finding' } }] });
    expect(published).toEqual([expect.objectContaining({ type: 'tool-result', output: expect.objectContaining({ reviewedFingerprint: 'launch-fingerprint', commentIds: ['comment-file-finding', 'comment-global-finding'] }) })]);
  });

  it.each(['launch-fingerprint', null])('retains launch fingerprint %s when invalid findings prevent review success', async (reviewedFingerprint) => {
    const initial = { ...run(), intentInput: { reviewedFingerprint } };
    const runs = new Map([[initial.runId, initial]]);
    await finishExecutionRun({
      runId: initial.runId, next: { status: 'succeeded', finishedAtMs: 2 }, toolResult: { output: 'Not structured' },
      runs, controllers: new Map(), budgetRegistry: null, parentProvider: 'claude', sendAcp: async () => {},
      enqueueMarkerWrite: async (_runId, write) => { await write(); }, terminalMarkerWritePromises: terminalWrites, reviewComments: service(),
    });
    expect(runs.get(initial.runId)).toMatchObject({ status: 'failed', error: { code: 'review_comment_materialization_failed' }, latestToolResult: { reviewedFingerprint, commentIds: [] } });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('retains successfully persisted comment ids when another finding fails materialization', async () => {
    vi.mocked(axios.post).mockImplementation(async (_url, body) => {
      const request = ReviewCommentCreateRequestV1Schema.parse(body);
      return request.findingId === 'global-finding'
        ? { status: 409, data: { error: 'review_comment_conflict' } }
        : { status: 200, data: { comment: commentForCreate(body), replayed: false } };
    });
    const initial = run();
    const runs = new Map([[initial.runId, initial]]);
    await finishExecutionRun({
      runId: initial.runId, next: { status: 'succeeded', finishedAtMs: 2 }, toolResult: { output: { findings } },
      structuredMeta: { kind: 'review_findings.v2', payload: { runRef: { runId: initial.runId, callId: initial.callId, backendId: 'claude' }, summary: 'Findings', overviewMarkdown: 'Findings', findings, questions: [], assumptions: [], generatedAtMs: 2 } },
      runs, controllers: new Map(), budgetRegistry: null, parentProvider: 'claude', sendAcp: async () => {},
      enqueueMarkerWrite: async (_runId, write) => { await write(); }, terminalMarkerWritePromises: terminalWrites, reviewComments: service(),
    });
    expect(runs.get(initial.runId)).toMatchObject({ status: 'failed', latestToolResult: {
      reviewedFingerprint: 'launch-fingerprint', commentIds: ['comment-file-finding'],
      materialization: { kind: 'partial' }, materializationFailures: [{ findingId: 'global-finding', errorCode: 'review_comment_conflict' }],
    } });
  });

  it.each(['failed', 'cancelled', 'timeout'] as const)('retains the launch fingerprint on a %s review without claiming materialization', async (status) => {
    const initial = run();
    const runs = new Map([[initial.runId, initial]]);
    await finishExecutionRun({
      runId: initial.runId, next: { status, finishedAtMs: 2 }, toolResult: { output: { status, reviewedFingerprint: 'untrusted-output-fingerprint', error: { code: 'invalid_output' } } },
      runs, controllers: new Map(), budgetRegistry: null, parentProvider: 'claude', sendAcp: async () => {},
      enqueueMarkerWrite: async (_runId, write) => { await write(); }, terminalMarkerWritePromises: terminalWrites, reviewComments: service(),
    });
    expect(runs.get(initial.runId)).toMatchObject({ status, latestToolResult: { reviewedFingerprint: 'launch-fingerprint', error: { code: 'invalid_output' } } });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
