import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
  FeaturesResponseSchema,
  SessionAwarenessProjectionV1Schema,
  projectLegacySessionAccessCapabilitiesV1,
  type ActionExecutorContext,
} from '@happier-dev/protocol';
import {
  createAccountEncryptionCurrentnessFixture,
  createCurrentSessionProjectionRecordFixture,
  createSessionRecordFixture,
} from '@/testkit/backends/sessionFixtures';
import { createCliActionDeps } from './createCliActionDeps';
vi.mock('axios', () => ({ default: { get: vi.fn(), isAxiosError: () => false } }));
const credentials = { token: 'test-token', encryption: null } as const;
const sessionId = 'c123456789012345678901234';
/** No external-Action authorization: these reads carry the daemon credential. */
const context: ActionExecutorContext = {};
function deps() { return createCliActionDeps({token:credentials.token,credentials,sessionId,mode:'plain',ctx:null}); }
function collaborationFeatures() {
  return FeaturesResponseSchema.parse({
    features: {
      sessions: { enabled: true },
      sharing: { session: { enabled: true } },
    },
    capabilities: {},
  });
}
describe('CLI activity compatibility awareness', () => {
  beforeEach(() => vi.clearAllMocks());
  it('publishes only the bound child own report under fresh reportsTo and refuses workflow steps', async () => {
    const row = createSessionRecordFixture({ id: sessionId, encryptionMode: 'plain', metadata: '{}', reportsTo: { sessionId: 'lead' } });
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { session: row } });
    const committed: string[] = [];
    const owner = createCliActionDeps({ token: credentials.token, credentials, sessionId, mode: 'plain', ctx: null,
      publishWorkerReport: async (summary) => { committed.push(summary); return { persisted: true, localId: 'worker-report-1' }; } });
    expect(await owner.sessionWorkerPublish!({ context, summary: 'Partial finding' })).toEqual({ sessionId, leadSessionId: 'lead', localId: 'worker-report-1' });
    delete row.reportsTo;
    expect(await owner.sessionWorkerPublish!({ context, summary: 'Unrelated' })).toMatchObject({ ok: false, errorCode: 'session_worker_requires_reports_to' });
    row.reportsTo = { sessionId: 'lead' };
    row.origin = { kind: 'run_step', runId: 'workflow-run' };
    expect(await owner.sessionWorkerPublish!({ context, summary: 'Wrong carrier' })).toMatchObject({ ok: false, errorCode: 'session_worker_run_step_requires_publish_draft' });
    expect(committed).toEqual(['Partial finding']);
  });
  it('projects status through awareness while retaining released pending count fields', async () => {
    const now = Date.now();
    const row = createSessionRecordFixture({id:sessionId,encryptionMode:'plain',metadata:'{}',active:true,activeAt:now,latestTurnStatus:'in_progress',latestTurnStatusObservedAt:now,pendingCount:2,pendingPermissionRequestCount:0,pendingUserActionRequestCount:0});
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/encryption/currentness')) return {status:200,data:createAccountEncryptionCurrentnessFixture()};
      if (String(url).endsWith(`/v2/sessions/${sessionId}`)) return {status:200,data:{session:row}};
      throw new Error(`Unexpected request: ${url}`);
    });
    expect(await deps().sessionActivityGet({ context, sessionId})).toMatchObject({
      ok:true,sessionId,presence:null,working:true,blocked:false,pendingCount:2,
      pendingPermissionRequestCount:0,pendingUserActionRequestCount:0,
    });
  });
  it('reports a pending permission without inventing the request identities it cannot read', async () => {
    const now = Date.now();
    const row = createSessionRecordFixture({id:sessionId,encryptionMode:'plain',metadata:'{}',active:true,activeAt:now,pendingPermissionRequestCount:2,pendingUserActionRequestCount:0,pendingRequestObservedAt:now});
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/encryption/currentness')) return {status:200,data:createAccountEncryptionCurrentnessFixture()};
      if (String(url).endsWith(`/v2/sessions/${sessionId}`)) return {status:200,data:{session:row}};
      throw new Error(`Unexpected request: ${url}`);
    });
    const result = await deps().sessionActivityGet({ context, sessionId});
    expect(result).toMatchObject({ok:true,permissionRequired:true,blocked:true,pendingPermissionRequestCount:2});
    expect(result).not.toHaveProperty('permissionRequestIds');
  });
  it('preserves authorization failure instead of calling it not found', async () => {
    vi.mocked(axios.get).mockResolvedValue({status:403,data:{error:'forbidden'}});
    await expect(deps().sessionActivityGet({ context, sessionId})).rejects.toMatchObject({response:{status:403}});
  });
  it('retains a real not-found result and does not fetch Account content state for it', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 404, data: { error: 'session_not_found' } });
    expect(await deps().sessionActivityGet({ context, sessionId })).toMatchObject({ ok: false, errorCode: 'session_not_found' });
    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(1);
  });
  it('preserves a network failure and cancellation without substituting absence', async () => {
    const error = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    vi.mocked(axios.get).mockRejectedValue(error);
    await expect(deps().sessionActivityGet({ context, sessionId })).rejects.toBe(error);
    vi.mocked(axios.get).mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(deps().sessionActivityGet({ context, sessionId, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });
  it('answers the requested awareness view with the canonical projection instead of the digest', async () => {
    const now = Date.now();
    const row = createSessionRecordFixture({id:sessionId,encryptionMode:'plain',metadata:'{}',active:true,activeAt:now,latestTurnStatus:'in_progress',latestTurnStatusObservedAt:now,pendingCount:0,pendingPermissionRequestCount:0,pendingUserActionRequestCount:0});
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/encryption/currentness')) return {status:200,data:createAccountEncryptionCurrentnessFixture()};
      if (String(url).endsWith(`/v2/sessions/${sessionId}`)) return {status:200,data:{session:row}};
      throw new Error(`Unexpected request: ${url}`);
    });
    const result = await deps().sessionActivityGet({ context, sessionId,view:'awareness'});
    // The same projector the compatibility digest is derived from, returned unadapted: the
    // marked `v` plus the absent released digest fields are what prove the view was applied.
    expect(SessionAwarenessProjectionV1Schema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({v:1,sessionId,operational:{primary:'working'}});
    expect(result).not.toHaveProperty('ok');
    expect(result).not.toHaveProperty('pendingCount');
  });
  it.each([
    ['Team', { kind: 'team' as const, teamId: 'team-1', requiredByTeamPolicy: false }],
    ['Group', { kind: 'group' as const, teamId: 'team-1', groupId: 'group-1' }],
  ])('uses the exact Home feature snapshot for %s-aware detail acquisition', async (_label, accessSource) => {
    const now = Date.now();
    const row = createCurrentSessionProjectionRecordFixture({
      id: sessionId,
      encryptionMode: 'plain',
      metadata: '{}',
      active: true,
      activeAt: now,
      latestTurnStatus: 'in_progress',
      latestTurnStatusObservedAt: now,
      pendingCount: 0,
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 0,
      effectiveAccess: {
        v: 1,
        level: 'view',
        sources: [accessSource],
        capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view' }),
      },
      viewer: {
        readState: { state: 'not_started' },
        relevance: { relevant: false, reasons: [] },
        attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
        follow: { follows: false, notificationLevel: null },
        notification: { level: 'none', source: 'none' },
      },
    });
    const resolveServerFeaturesSnapshot = vi.fn(async () => ({
      status: 'ready' as const,
      provenance: 'authenticated' as const,
      features: collaborationFeatures(),
    }));
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/encryption/currentness')) {
        return { status: 200, data: createAccountEncryptionCurrentnessFixture() };
      }
      if (String(url).endsWith(`/v2/sessions/${sessionId}?accessProjectionVersion=1`)) {
        return { status: 200, data: { session: row } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId,
      mode: 'plain',
      ctx: null,
      resolveServerFeaturesSnapshot,
    }).sessionActivityGet({ context, sessionId, view: 'awareness' })).resolves.toMatchObject({
      v: 1,
      sessionId,
      operational: { primary: 'working' },
    });
    expect(resolveServerFeaturesSnapshot).toHaveBeenCalledTimes(1);
  });
  it('keeps the released bare detail request when the exact Home lacks feature discovery', async () => {
    const now = Date.now();
    const row = createSessionRecordFixture({
      id: sessionId,
      encryptionMode: 'plain',
      metadata: '{}',
      active: true,
      activeAt: now,
      latestTurnStatus: 'in_progress',
      latestTurnStatusObservedAt: now,
      pendingCount: 0,
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 0,
    });
    vi.mocked(axios.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/encryption/currentness')) {
        return { status: 200, data: createAccountEncryptionCurrentnessFixture() };
      }
      if (String(url).endsWith(`/v2/sessions/${sessionId}`)) {
        return { status: 200, data: { session: row } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId,
      mode: 'plain',
      ctx: null,
      resolveServerFeaturesSnapshot: async () => ({
        status: 'unsupported',
        reason: 'endpoint_missing',
      }),
    }).sessionActivityGet({ context, sessionId })).resolves.toMatchObject({ ok: true, sessionId });
  });
  it('returns a typed unsupported result when this host cannot honor windowSeconds', async () => {
    const result = await deps().sessionActivityGet({ context, sessionId, windowSeconds: 60 });

    expect(result).toEqual({
      ok: false,
      errorCode: 'unsupported_action',
      error: 'unsupported_action:session.activity.get.windowSeconds',
    });
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });
  it('preserves malformed transport results instead of calling them not found', async () => {
    vi.mocked(axios.get).mockResolvedValue({status:200,data:{wrong:'shape'}});
    await expect(deps().sessionActivityGet({ context, sessionId})).rejects.toThrow('Unexpected /v2/sessions response shape');
  });
});
