import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createAccountScopedCryptoMaterialSnapshotV1, convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1,
    CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
    prepareWorkflowRunDataKeyV1, WorkflowRunRecipientCensusResponseV1Schema,
    sealWorkflowAcceptedSnapshotStoredEnvelopeV1, serializeWorkflowStoredContentEnvelopeV1,
    validateWorkflowDefinition,
    WorkflowRunStartRequestV1Schema,
    SessionTriggerUpdateRequestV1Schema,
    type AvailableAutomationAccountEncryptionV1,
    type AutomationDefinitionCreateRequest,
    type AutomationDefinitionDetail,
    type AutomationDefinitionListItem,
    type AutomationDefinitionReconcileRequest,
    type AutomationTriggerDefinitionInput,
} from '@happier-dev/protocol';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { storage } from '@/sync/domains/state/storage';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { setServerProfileIdentityForUrl } from '@/sync/domains/server/serverProfiles';
import { captureLazyActionAccountContext } from './actionAccountContext';
import { createFrontDoorActionExecute } from './frontDoorRuntimeActionExecutor';
import type { WorkflowActionTransport } from './workflowActionTransport';
import type { Artifact, ArtifactCreateRequest } from '@/sync/domains/artifacts/artifactTypes';
import { buildWorkflowReviewedRunSeed } from '@/sync/domains/workflows/workflowReviewedRunSeed';
import { buildWorkflowEditorDraftFromDefinition, validateWorkflowEditorDraft } from '@/sync/domains/workflows/workflowAuthoring';

// Only HTTP and device credential storage are substituted; Account composition,
// feature decisions, content codecs, the front door and relay remain real.
const runtimeFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: (...args: unknown[]) => runtimeFetch(...args) }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const accountId = 'workflow-account';
const runId = '00000000-0000-4000-8000-000000000001';
const definition = validateWorkflowDefinition({ version: 1,
    defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
    blocks: ['Do the thing'],
}).normalizedDefinition!;
const triggerSetRow = (id: string, workflowDefinitionId: string, scopeSessionId: string | null = null): AutomationDefinitionListItem => ({
    id, name: 'Workflow triggers', description: null, enabled: true, workflowDefinitionId, scopeSessionId,
    targetType: null, existingSessionId: null, templateVersion: 1, lastRunAt: null, createdAt: 1, updatedAt: 1,
    assignments: [{ machineId: 'machine-a', enabled: true, priority: 0, updatedAt: 1 }], triggers: [],
});
const scheduleTrigger = { kind: 'schedule' as const, enabled: true,
    schedule: { kind: 'interval' as const, scheduleExpr: null, everyMs: 60_000, timezone: null } };
// The server's Automation definition owner is the external persistent boundary.
// This in-memory stand-in applies only the stored row shape and CAS; trigger
// semantics, sealing and Account currentness run through the real UI host.
function storedTrigger(triggerId: string, trigger: AutomationTriggerDefinitionInput, revision = 0): AutomationDefinitionDetail['triggers'][number] {
    if (trigger.kind !== 'schedule') throw new Error('fixture_supports_schedule_triggers_only');
    return { ...trigger, id: triggerId as AutomationDefinitionDetail['triggers'][number]['id'], revision, createdAt: 1, updatedAt: 1, nextRunAt: 2, triggerDefinitionEnvelope: null };
}
function createdAutomation(input: AutomationDefinitionCreateRequest): AutomationDefinitionDetail {
    return { id: input.automationId, name: input.name, description: input.description ?? null, enabled: input.enabled,
        workflowDefinitionId: input.workflowDefinitionId ?? null, scopeSessionId: input.scopeSessionId ?? null,
        targetType: null, existingSessionId: null, templateVersion: 1, lastRunAt: null, createdAt: 1, updatedAt: 1,
        assignments: (input.assignments ?? []).map((value) => ({ machineId: value.machineId, enabled: value.enabled ?? true, priority: value.priority ?? 0, updatedAt: 1 })),
        triggers: input.triggers.map((value) => storedTrigger(value.triggerId, value.trigger)),
        ...(input.executionRecipe ? { executionRecipe: input.executionRecipe } : {}) } as AutomationDefinitionDetail;
}
function reconciledAutomation(row: AutomationDefinitionDetail, input: AutomationDefinitionReconcileRequest): AutomationDefinitionDetail {
    return { ...row, enabled: input.enabled, templateVersion: row.templateVersion + 1,
        ...(input.workflowDefinitionId === undefined ? {} : { workflowDefinitionId: input.workflowDefinitionId }),
        ...(input.executionRecipe ? { executionRecipe: input.executionRecipe } : {}),
        assignments: input.assignments.map((value) => ({ machineId: value.machineId, enabled: value.enabled ?? true, priority: value.priority ?? 0, updatedAt: 2 })),
        triggers: input.triggers.map((item) => {
            if (item.kind === 'new') return storedTrigger(item.triggerId, item.trigger);
            const current = row.triggers.find((trigger) => trigger.id === item.triggerId)!;
            const changed = item.enabled !== undefined || item.trigger !== undefined;
            return { ...current, ...(item.enabled === undefined ? {} : { enabled: item.enabled }), revision: changed ? current.revision + 1 : current.revision };
        }) };
}
function listedAutomation(row: AutomationDefinitionDetail): AutomationDefinitionListItem {
    const { executionRecipe: _recipe, templateCiphertext: _template, triggers, ...item } = row;
    return { ...item, triggers: triggers.map(({ triggerDefinitionEnvelope: _envelope, ...trigger }) => trigger) } as AutomationDefinitionListItem;
}
afterEach(() => { runtimeFetch.mockReset(); vi.restoreAllMocks(); });

async function createHarness(mode: 'plain' | 'e2ee' = 'plain', options: Readonly<{ malformed?: boolean; locked?: boolean; identity?: boolean; credentialKind?: 'account_directory' | 'ephemeral_session_runner'; automations?: readonly AutomationDefinitionListItem[]; cleanupFailure?: boolean; beforeAutomationDeleteResponse?: () => Promise<void>; beforeAutomationListResponse?: () => Promise<void> }> = {}) {
    const home = await upsertAndActivateServer({ serverUrl: `https://workflow-${mode}-${crypto.randomUUID()}.test`, scope: 'tab' });
    if (options.identity) await setServerProfileIdentityForUrl(home.serverUrl, `srv_workflow-${crypto.randomUUID()}`);
    const token = `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: accountId,
        ...(options.credentialKind ? { provenance: { v: 1, kind: options.credentialKind,
            authority: options.credentialKind === 'account_directory' ? 'present_user' : 'session_runtime' } } : {}),
    })), 'base64url')}.signature`;
    const secret = new Uint8Array(32).fill(24);
    const credentials: AuthCredentials = mode === 'plain' || options.locked ? { token } : { token, secret: encodeBase64(secret, 'base64url') };
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
    const material = mode === 'e2ee' ? createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee', material: { type: 'legacy', secret } }) : undefined;
    // Stored Run content has its own key even when the current reader is locked.
    // The real Account key seals only the owner's recipient envelope.
    const encryption: AvailableAutomationAccountEncryptionV1 = material ? {
        kind: 'available', material, witness: { mode: 'e2ee', version: 1,
            contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(material.contentPublicKeyFingerprint) },
    } : { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } };
    const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
    const preparedKey = prepareWorkflowRunDataKeyV1({ accountId, encryption, randomBytes });
    const ownerEnvelope = preparedKey.recipientKeyEnvelopes.find((entry) => entry.recipientAccountId === accountId)?.encryptedDataKey ?? null;
    const keyCensus = WorkflowRunRecipientCensusResponseV1Schema.parse({ runId, ownerAccountId: accountId, access: 'owner',
        encryptionMode: mode, dataEncryptionKey: ownerEnvelope, callerDataEncryptionKey: ownerEnvelope,
        recipients: [], visibleTeamId: null, ownerAccountCurrentness: encryption.witness,
    });
    const run = createWorkflowRunSummaryFixture({ id: runId, origin: { kind: 'direct' }, machineId: 'machine-a' });
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        ...(preparedKey.runCrypto.mode === 'e2ee'
            ? { ...preparedKey.runCrypto, randomBytes }
            : preparedKey.runCrypto),
        binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId },
        acceptedSnapshot: { definition, source: { kind: 'inline' }, inputs: {}, machineId: 'machine-a', executionTarget: { kind: 'session' },
            workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } },
            origin: { kind: 'direct' }, authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } } },
    }));
    const operations: Readonly<Record<string, unknown>>[] = [];
    const deletedResources: string[] = [];
    const artifacts = new Map<string, Artifact>();
    const automationRows = new Map<string, AutomationDefinitionDetail>();
    const automationWrites: string[] = [];
    runtimeFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
        const target = new URL(String(url));
        if (target.pathname === '/health' || target.pathname === '/v1/auth/ping') return json({});
        if (target.pathname === '/v1/features') return json({ features: { automations: { enabled: true }, workflows: { enabled: true } }, capabilities: {
            accountStoredContentCompatibility: {
                v: 1, minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                declarationTransport: 'http-header-and-socket-auth-v1',
            },
        } });
        expect(target.origin).toBe(home.serverUrl);
        if (target.pathname === '/v1/account/encryption') return json({ mode, updatedAt: 0 });
        if (target.pathname === '/v2/account/settings') return json({ content: null, version: 0 });
        if (target.pathname === '/v1/account/encryption/currentness') return json({ mode, version: 1,
            signingKeyFingerprint: null, contentKeyFingerprint: material ? convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(material.contentPublicKeyFingerprint) : null, updatedAt: 0,
            recipientEnvelopeReadiness: mode === 'plain' ? { status: 'unavailable', reason: 'plain_account' } : { status: 'available' } });
        if (target.pathname === '/v1/artifacts') {
            if (init?.method !== 'POST') return json([...artifacts.values()]);
            const input = JSON.parse(String(init.body)) as ArtifactCreateRequest;
            const row = { ...input, headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
            artifacts.set(input.id, row);
            return json(row);
        }
        if (target.pathname.startsWith('/v1/artifacts/') && target.pathname.endsWith('/access/grants')) {
            const artifactId = decodeURIComponent(target.pathname.slice('/v1/artifacts/'.length, -'/access/grants'.length));
            return json({ artifactId, ownerAccountId: accountId, access: 'owner', grants: [] });
        }
        if (target.pathname.startsWith('/v1/artifacts/')) {
            const artifactId = target.pathname.slice('/v1/artifacts/'.length);
            if (init?.method === 'DELETE') {
                deletedResources.push(artifactId);
                artifacts.delete(artifactId);
                return new Response(null, { status: 204 });
            }
            return json(artifacts.get(artifactId) ?? { error: 'not-found' }, artifacts.has(artifactId) ? 200 : 404);
        }
        if (target.pathname === '/v3/automations') {
            if (init?.method === 'POST') {
                const row = createdAutomation(JSON.parse(String(init.body)) as AutomationDefinitionCreateRequest);
                automationWrites.push(`create:${row.id}`);
                automationRows.set(row.id, row);
                return json(row);
            }
            await options.beforeAutomationListResponse?.();
            const workflowFilter = target.searchParams.get('workflowDefinitionId');
            const sessionFilter = target.searchParams.get('scopeSessionId');
            const accountInline = target.searchParams.get('scope') === 'account_inline';
            const listed = [...(options.automations ?? []), ...[...automationRows.values()].map(listedAutomation)].filter((row) => (
                (workflowFilter === null || row.workflowDefinitionId === workflowFilter)
                && (sessionFilter === null || row.scopeSessionId === sessionFilter)
                && (!accountInline || (row.workflowDefinitionId == null && row.scopeSessionId == null))
            ));
            return json({ automations: listed, nextCursor: null });
        }
        if (target.pathname.startsWith('/v3/automations/') && init?.method === 'DELETE') {
            if (options.cleanupFailure) return json({ error: 'cleanup_unavailable' }, 503);
            deletedResources.push(target.pathname.slice('/v3/automations/'.length));
            await options.beforeAutomationDeleteResponse?.();
            return json({ ok: true });
        }
        const automationId = target.pathname.startsWith('/v3/automations/') && target.pathname !== '/v3/automations/runs/workflow-storage'
            ? decodeURIComponent(target.pathname.slice('/v3/automations/'.length)) : null;
        if (automationId !== null && init?.method === 'PUT') {
            const row = automationRows.get(automationId);
            const input = JSON.parse(String(init.body)) as AutomationDefinitionReconcileRequest;
            if (!row) return json({ error: 'automation_not_found' }, 404);
            if (row.templateVersion !== input.expectedTemplateVersion) return json({ error: 'currentness_conflict' }, 409);
            const next = reconciledAutomation(row, input);
            automationWrites.push(`reconcile:${automationId}`);
            automationRows.set(automationId, next);
            return json(next);
        }
        if (automationId !== null) {
            const row = automationRows.get(automationId);
            return row ? json(row) : json({ error: 'automation_not_found' }, 404);
        }
        expect(target.pathname).toBe('/v3/automations/runs/workflow-storage');
        expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
        const operation = JSON.parse(String(init?.body)) as Readonly<Record<string, unknown>>;
        expect(operation).not.toHaveProperty('publisherMachineId');
        operations.push(operation);
        if (operation.operation === 'get') return json({ run, acceptedEnvelope: options.malformed ? '{"t":"plain","v":"bad"}' : acceptedEnvelope, checkpointEnvelope: null, resultEnvelope: null, keyCensus });
        if (operation.operation === 'run-key.census') return json(keyCensus);
        if (operation.operation === 'invocations.list') return json({ invocations: [], parentRevision: run.revision });
        if (operation.operation === 'pause') return json({ run: { ...run, state: 'pause_requested', revision: 2 }, intent: 'pause_requested' });
        if (operation.operation === 'cancel') return json({ run: { ...run, state: 'cancelled', revision: 2 }, intent: 'cancel_requested' });
        throw new Error(`unexpected_operation:${String(operation.operation)}`);
    });
    await upsertAndActivateServer({ serverUrl: `https://focused-${crypto.randomUUID()}.test`, scope: 'tab' });
    const account = await captureLazyActionAccountContext(home.id);
    // Capture follows the app's Account bootstrap; family construction happens
    // afterwards, so its real machine relay cannot re-enter storage creation.
    const { createUiWorkflowAction } = await import('./workflowActionDeps');
    const transport = vi.fn<WorkflowActionTransport>(async () => ({ run, admission: 'created' }));
    const { createDefaultActionExecutor } = await import('./defaultActionExecutor');
    // The mounted family's captured lifetime is real; the default factory still
    // owns settings policy, approval and every other Action dependency.
    const execute = createFrontDoorActionExecute(createDefaultActionExecutor({ workflowAction: createUiWorkflowAction({ account, transport }) }));
    const executeDefault = createFrontDoorActionExecute(createDefaultActionExecutor());
    const context = { surface: 'ui' as const, serverId: account.serverId, runtimeAccountId: accountId, authority: 'present_user' as const };
    return { account, execute, executeDefault, context, transport, operations, home, createUiWorkflowAction, deletedResources, artifacts, automationRows, automationWrites };
}

describe('UI Workflow Action front door', () => {
    it.each(['plain', 'e2ee'] as const)('saves a reviewed Run copy as one portable %s Artifact only on explicit create', async (mode) => {
        const h = await createHarness(mode);
        try {
            const acceptedDefinition = validateWorkflowDefinition({ ...definition,
                inputs: [{ name: 'topic', valueType: 'string', required: true }],
            }).normalizedDefinition!;
            const seed = buildWorkflowReviewedRunSeed({
                run: createWorkflowRunSummaryFixture({ id: runId, origin: { kind: 'direct' }, machineId: 'machine-a' }),
                definition: acceptedDefinition,
                acceptedContext: {
                    source: { kind: 'inline' }, metadata: { title: 'Accepted title', description: 'Accepted description' },
                    inputs: { topic: 'private accepted input' }, machineId: 'machine-a', executionTarget: { kind: 'detached_run' },
                    workspaceTarget: { project: { machineId: 'machine-a', directory: '/private/repo', checkoutRootPath: '/private/repo' } }, origin: { kind: 'direct' },
                },
            });
            const draft = buildWorkflowEditorDraftFromDefinition({ draftId: 'reviewed-copy', name: seed.name, definition: seed.definition });
            expect(h.artifacts.size).toBe(0);
            const reviewed = validateWorkflowEditorDraft({ ...draft, name: 'Edited title' });
            expect(reviewed.valid).toBe(true);
            const definitionId = '00000000-0000-4000-8000-000000000003';
            await expect(h.executeDefault('workflow.definition.create', {
                definitionId, definition: reviewed.normalizedDefinition!, metadata: { title: 'Edited title', description: 'Edited description' },
            }, h.context)).resolves.toMatchObject({ ok: true, result: { definitionId, metadata: { title: 'Edited title', description: 'Edited description' } } });
            expect(h.artifacts.size).toBe(1);
            const artifact = await h.account.workflowArtifacts.read(definitionId);
            expect(artifact?.header).toMatchObject({ metadata: { title: 'Edited title', description: 'Edited description' } });
            expect(JSON.parse(artifact!.body!)).toEqual({ kind: 'workflow-definition.v1', definition: reviewed.normalizedDefinition });
            expect(h.operations).toEqual([]);
            expect(h.transport).not.toHaveBeenCalled();
        } finally { h.account.dispose(); }
    });
    it.each([false, true])('settles workflow trigger cleanup before deleting the Artifact (cleanup failure: %s)', async (cleanupFailure) => {
        const definitionId = '00000000-0000-4000-8000-000000000002';
        const h = await createHarness('plain', { cleanupFailure, automations: [triggerSetRow('own-trigger-set', definitionId),
            triggerSetRow('session-trigger-set', definitionId, 'session-id'), triggerSetRow('other-workflow-set', runId)] });
        try {
            await expect(h.execute('workflow.definition.create', { definitionId, definition, metadata: { title: 'Workflow' } }, h.context))
                .resolves.toMatchObject({ ok: true, result: { definitionId } });
            const deletion = await h.execute('workflow.definition.delete', { definitionId }, h.context);
            if (cleanupFailure) {
                expect(deletion).toMatchObject({ ok: false });
                expect(h.artifacts.has(definitionId)).toBe(true);
                expect(h.deletedResources).toEqual([]);
            } else {
                expect(deletion).toEqual({ ok: true, result: { deleted: true, definitionId } });
                expect(h.deletedResources).toEqual(['own-trigger-set', 'session-trigger-set', definitionId]);
            }
            expect(h.transport).not.toHaveBeenCalled();
        } finally { h.account.dispose(); }
    });
    it('refuses the Artifact delete if credentials retire while trigger cleanup settles', async () => {
        const definitionId = '00000000-0000-4000-8000-000000000004';
        const h = await createHarness('plain', { automations: [triggerSetRow('own-trigger-set', definitionId)],
            beforeAutomationDeleteResponse: async () => {
                expect(await TokenStorage.setCredentialsForServerUrl(h.home.serverUrl, { serverId: h.account.serverId }, { token: 'replacement-account' })).toBe(true);
            },
        });
        try {
            await expect(h.execute('workflow.definition.create', { definitionId, definition, metadata: { title: 'Workflow' } }, h.context))
                .resolves.toMatchObject({ ok: true, result: { definitionId } });
            await expect(h.execute('workflow.definition.delete', { definitionId }, h.context)).resolves.toMatchObject({ ok: false });
            expect(h.deletedResources).toEqual(['own-trigger-set']);
            expect(h.artifacts.has(definitionId)).toBe(true);
            expect(h.transport).not.toHaveBeenCalled();
        } finally {
            h.account.dispose();
            await TokenStorage.removeCredentialsForServerUrl(h.home.serverUrl, { serverId: h.account.serverId });
        }
    });
    it('accepts the captured Home through its equivalent local profile id', async () => {
        const h = await createHarness('plain', { identity: true });
        try {
            expect(h.account.serverId).not.toBe(h.home.id);
            await expect(h.execute('workflow.definition.list', {}, { ...h.context, serverId: h.home.id }))
                .resolves.toEqual({ ok: true, result: { definitions: [] } });
            expect(h.transport).not.toHaveBeenCalled();
        } finally { h.account.dispose(); }
    });

    it('retains host authorization for a non-present-user definition delete', async () => {
        const h = await createHarness();
        try {
            const { authority: _authority, ...context } = h.context;
            await h.createUiWorkflowAction({ account: h.account, transport: h.transport })({
                actionId: 'workflow.definition.delete', input: { definitionId: runId },
                context: { ...context, surface: 'agent', externalActionTarget: { kind: 'machine', machineId: 'relay-a' } },
            });
            expect(h.transport).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'relay-a', method: 'workflow.definition.delete' }));
            expect(h.deletedResources).toEqual([]);
            expect(h.operations).toEqual([]);
        } finally { h.account.dispose(); }
    });

    it.each(['account_directory', 'ephemeral_session_runner'] as const)('keeps %s credentials on their authorized host relay', async (credentialKind) => {
        const h = await createHarness('plain', { credentialKind });
        try {
            await h.createUiWorkflowAction({ account: h.account, transport: h.transport })({ actionId: 'workflow.definition.list', input: {},
                context: { ...h.context, externalActionTarget: { kind: 'machine', machineId: 'relay-a' } } });
            expect(h.transport).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'relay-a', method: 'workflow.definition.list' }));
            expect(h.operations).toEqual([]);
        } finally { h.account.dispose(); }
    });

    it.each(['plain', 'e2ee'] as const)('opens %s retained content and records controls on the captured Home with all daemons offline', async (mode) => {
        const h = await createHarness(mode);
        try {
            await expect(h.execute('workflow.definition.list', {}, h.context)).resolves.toEqual({ ok: true, result: { definitions: [] } });
            await expect(h.execute('workflow.run.get', { runId }, h.context)).resolves.toMatchObject({ ok: true, result: { definition } });
            await expect(h.execute('workflow.run.pause', { runId, expectedRevision: 1 }, h.context)).resolves.toMatchObject({ ok: true, result: { intent: 'pause_requested' } });
            await expect(h.execute('workflow.run.cancel', { runId, expectedRevision: 1 }, h.context)).resolves.toMatchObject({ ok: true, result: { intent: 'cancel_requested' } });
            expect(h.transport).not.toHaveBeenCalled();
            expect(h.operations.map((operation) => operation.operation)).toContain('get');
        } finally { h.account.dispose(); }
    });

    it('keeps starts on the exact Machine relay', async () => {
        const h = await createHarness();
        try {
            const target = { kind: 'machine' as const, machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } };
            await expect(h.execute('workflow.run.start', { runId, source: { kind: 'inline', definition } }, { ...h.context, externalActionTarget: target }))
                .resolves.toMatchObject({ ok: true, result: { admission: 'created' } });
            expect(h.transport).toHaveBeenCalledWith(expect.objectContaining({ serverId: h.account.serverId, accountId, machineId: 'machine-a',
                payload: { v: 1, kind: 'targeted_action_rpc', target, input: { runId, source: { kind: 'inline', definition } } } }));
            expect(h.operations).toEqual([]);
        } finally { h.account.dispose(); }
    });

    it('uses an online relay when the first visible Machine has stale presence', async () => {
        const h = await createHarness();
        try {
            await upsertAndActivateServer({ serverUrl: h.home.serverUrl, scope: 'device' });
            const machines = [
                createMachineFixture({ id: 'stale', active: true, activeAt: 1, createdAt: 2 }),
                createMachineFixture({ id: 'online', active: true, activeAt: Date.now(), createdAt: 1 }),
            ];
            storage.setState({ machineListByServerId: { [h.home.id]: machines } });
            await h.createUiWorkflowAction({ account: h.account, transport: h.transport })({
                actionId: 'workflow.run.start', input: WorkflowRunStartRequestV1Schema.parse({ runId, source: { kind: 'inline', definition } }), context: h.context,
            });
            expect(h.transport.mock.calls[0]?.[0].machineId).toBe('online');
        } finally {
            storage.setState({ machineListByServerId: {} });
            h.account.dispose();
        }
    });

    it.each(['plain', 'e2ee'] as const)('lists, adds, updates and removes %s Account triggers with no Machine', async (mode) => {
        const h = await createHarness(mode);
        try {
            const definitionId = '00000000-0000-4000-8000-000000000005';
            const project = { machineId: 'machine-a', directory: '/repo' };
            await expect(h.execute('workflow.definition.create', { definitionId, definition, metadata: { title: 'Workflow' } }, h.context))
                .resolves.toMatchObject({ ok: true });
            const added = await h.execute('workflow.trigger.add', { workflow: definitionId, project, trigger: scheduleTrigger }, h.context);
            expect(added).toMatchObject({ ok: true, result: { set: { health: 'available', project, target: { kind: 'workflow', ref: definitionId } } } });
            const automationId = (added as { result: { set: { automationId: string } } }).result.set.automationId;
            const triggerId = (added as { result: { triggerId: string } }).result.triggerId;
            const stored = h.automationRows.get(automationId)!;
            // The set context is sealed with the caller Account's current material.
            expect(stored.executionRecipe).toMatchObject({ v: 2, workflow: { t: mode === 'plain' ? 'plain' : 'encrypted' } });
            await expect(h.execute('workflow.trigger.list', { workflow: definitionId }, h.context)).resolves.toMatchObject({ ok: true,
                result: { sets: [{ automationId, health: 'available', triggers: [{ id: triggerId, enabled: true }] }] } });
            await expect(h.execute('workflow.trigger.update', { automationId, triggerId, expectedRevision: 1, patch: { enabled: false } }, h.context))
                .resolves.toMatchObject({ ok: true, result: { set: { automationId, triggers: [{ id: triggerId, enabled: false }] } } });
            await expect(h.execute('workflow.trigger.remove', { automationId, triggerId }, h.context))
                .resolves.toMatchObject({ ok: true, result: { set: { automationId, triggers: [] } } });
            expect(h.automationWrites).toEqual([`create:${automationId}`, `reconcile:${automationId}`, `reconcile:${automationId}`]);
            expect(h.transport).not.toHaveBeenCalled();
        } finally { h.account.dispose(); }
    });

    it('refuses trigger reads and writes when the captured Account retires mid-operation', async () => {
        const definitionId = '00000000-0000-4000-8000-000000000006';
        const h = await createHarness('plain', { beforeAutomationListResponse: async () => {
            expect(await TokenStorage.setCredentialsForServerUrl(h.home.serverUrl, { serverId: h.account.serverId }, { token: 'replacement-account' })).toBe(true);
        } });
        try {
            await expect(h.execute('workflow.trigger.list', { scope: 'account_inline' }, h.context)).resolves.toMatchObject({ ok: false });
            await expect(h.execute('workflow.trigger.add', { workflow: definitionId, project: { machineId: 'machine-a', directory: '/repo' },
                trigger: scheduleTrigger }, h.context)).resolves.toMatchObject({ ok: false });
            expect(h.automationWrites).toEqual([]);
            expect(h.transport).not.toHaveBeenCalled();
        } finally {
            h.account.dispose();
            await TokenStorage.removeCredentialsForServerUrl(h.home.serverUrl, { serverId: h.account.serverId });
        }
    });

    it('serves a present-user session trigger list for a closed session with no Machine', async () => {
        const h = await createHarness();
        try {
            // The Session store belongs to the active Home; make the captured Home active.
            await upsertAndActivateServer({ serverUrl: h.home.serverUrl, scope: 'device' });
            storage.getState().applySessions([createSessionFixture({ id: 'session-closed', active: false,
                metadata: { path: '/repo', host: 'host', homeDir: '/home', machineId: 'machine-a' } as ReturnType<typeof createSessionFixture>['metadata'] })]);
            await expect(h.execute('session.trigger.list', { sessionId: 'session-closed' }, h.context))
                .resolves.toEqual({ ok: true, result: { sets: [], pullRequestLinks: [] } });
            expect(h.transport).not.toHaveBeenCalled();
        } finally { h.account.dispose(); }
    });

    it('routes agent trigger writes to the host that owns agent policy, and refuses typed with no Machine', async () => {
        const h = await createHarness();
        try {
            const { authority: _authority, ...context } = h.context;
            const executeCaptured = h.createUiWorkflowAction({ account: h.account, transport: h.transport });
            await executeCaptured({ actionId: 'session.trigger.update', input: SessionTriggerUpdateRequestV1Schema.parse({
                sessionId: 'session-a', triggerId: 'trigger-a', expectedRevision: 3, patch: { enabled: false },
            }), context: { ...context, surface: 'agent', externalActionTarget: { kind: 'machine', machineId: 'machine-a' } } });
            expect(h.transport).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-a', method: 'session.trigger.update' }));
            await expect(executeCaptured({ actionId: 'workflow.trigger.add', input: {
                workflow: '00000000-0000-4000-8000-000000000007', project: { machineId: 'machine-a', directory: '/repo' }, trigger: scheduleTrigger,
            }, context: { ...context, surface: 'agent' } })).resolves.toMatchObject({ ok: false, errorCode: 'target_unavailable' });
            expect(h.automationWrites).toEqual([]);
            expect(h.transport).toHaveBeenCalledTimes(1);
        } finally { h.account.dispose(); }
    });

    it('refuses malformed content and mismatched Account scope before disclosure', async () => {
        const h = await createHarness('e2ee', { malformed: true });
        try {
            await expect(h.execute('workflow.run.get', { runId }, h.context)).resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
            // The mounted family owns this captured lifetime. The default factory
            // intentionally captures the caller's explicit Home afresh instead.
            const executeCaptured = h.createUiWorkflowAction({ account: h.account, transport: h.transport });
            await expect(executeCaptured({ actionId: 'workflow.definition.list', input: {}, context: { ...h.context, serverId: 'other-home' } }))
                .resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
            await expect(executeCaptured({ actionId: 'workflow.run.cancel', input: { runId, expectedRevision: 1 }, context: { ...h.context, runtimeAccountId: 'other-account' } }))
                .resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
            expect(h.operations).toEqual([
                { operation: 'get', runId },
                { operation: 'run-key.census', runId },
            ]);
        } finally { h.account.dispose(); }
    });

    it('fails locked E2EE material closed after an opaque Run read without private disclosure or mutation', async () => {
        const h = await createHarness('e2ee', { locked: true });
        try {
            await expect(h.createUiWorkflowAction({ account: h.account, transport: h.transport })({
                actionId: 'workflow.run.get', input: { runId }, context: h.context,
            })).resolves.toEqual({ ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' });
            // The authorized read supplies the Run owner's mode and opaque
            // envelopes. Locked material must prevent opening or returning them,
            // and must stop before recipient census/preparation or mutation.
            expect(h.operations).toEqual([{ operation: 'get', runId }]);
            // Default settings bootstrap precedes Workflow dispatch. Its missing
            // material rejection is fail-closed, not a Workflow typed result.
            await expect(h.executeDefault('workflow.run.get', { runId }, h.context)).rejects.toBeInstanceOf(Error);
            expect(h.operations).toEqual([{ operation: 'get', runId }]);
            expect(h.transport).not.toHaveBeenCalled();
        } finally { h.account.dispose(); }
    });

    it('retires captured credentials before later mutation', async () => {
        const h = await createHarness();
        try {
            expect(await TokenStorage.setCredentialsForServerUrl(h.home.serverUrl, { serverId: h.account.serverId }, {
                token: `${h.account.credentials.token}changed`,
            })).toBe(true);
            await expect(h.execute('workflow.run.cancel', { runId, expectedRevision: 1 }, h.context))
                .resolves.toMatchObject({ ok: false, errorCode: 'content_unavailable' });
            expect(h.operations).toEqual([]);
            expect(h.transport).not.toHaveBeenCalled();
        } finally {
            h.account.dispose();
            await TokenStorage.removeCredentialsForServerUrl(h.home.serverUrl, { serverId: h.account.serverId });
        }
    });
});
