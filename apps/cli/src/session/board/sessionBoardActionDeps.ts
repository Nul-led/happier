import axios from 'axios';
import {
  applySessionBoardItemPlacementV1, applySessionBoardLayoutOperationV1, removeSessionBoardItemPlacementsV1, isSessionSurfaceItemSourceCompatible,
  classifySessionBoardMutationTransportResultV1,
  createSessionBoardOutcomeUnknownFailureV1,
  projectSessionBoardActionFailureV1, projectSessionBoardFeatureDecisionFailureV1,
  projectSessionBoardAdapterFailureV1,
  SESSION_BOARD_ACTION_INPUT_SCHEMAS_V1, SessionBoardGetInputV1Schema,
  SessionBoardItemRemoveInputV1Schema, SessionBoardLayoutUpdateInputV1Schema,
  SessionBoardItemUpsertInputV1Schema, SessionBoardLayoutV1Schema, SessionBoardMutationV1Schema,
  SessionBoardMutationActionResultV1Schema, SessionSurfaceItemV1Schema,
  SessionBoardActionFailureV1Schema,
  SESSION_BOARD_MUTATION_SERVER_TRANSPORT_V1,
  projectSessionBoardGetResultV1,
  type SessionBoardItemPlacementParticipantV1, type SessionBoardLayoutV1,
  type SessionBoardReadProjectionEntryV1, type SessionBoardActionIdV1,
} from '@happier-dev/protocol/sessions/board';
import {
  SessionSystemRecordListQuerySchema,
  DaemonContributionRegistryProjectionDescribeRequestSchema, DaemonContributionRegistryProjectionDescribeResponseSchema,
  DaemonPluginUiTargetedSurfaceRendererAvailabilityV1Schema,
} from '@happier-dev/protocol';
import type { ActionExecutorDeps } from '@happier-dev/protocol/actions';
import { isPluginUiInlineSurfaceBindingForSurfaceV1 } from '@happier-dev/protocol/plugins/ui';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { StoredCredentials } from '@/persistence';
import { configuration } from '@/configuration';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { resolveCliFeatureDecision, resolveCliFeatureDecisionForServer } from '@/features/featureDecisionService';
import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { fetchSessionById } from '@/session/transport/http/sessionsHttp';
import { callExactMachineRpc } from '@/session/transport/rpc/machineRpc';
import { resolveSessionOwningMachineId } from '@/session/services/resolveSessionOwningMachine';
import { readSessionSystemRecordV1, listSessionSystemRecordsV1 } from '@/session/transport/http/sessionSystemRecordsHttp';
import { openSessionSystemRecord, sealSessionSystemRecordContent, validateSessionSystemRecordOpenedContent } from '@/session/systemRecords/sessionSystemRecordCodec';
import { resolveSessionEncryptionContextFromCredentials, resolveSessionStoredContentEncryptionMode } from '@/session/transport/encryption/sessionEncryptionContext';
import type { SessionStoredContentCryptoContext } from '@/session/transport/encryption/sessionStoredContentCodec';
import { resolveExternalActionServerRequestHeaders, type ExternalActionHomeBinding } from '@/api/externalActionExecutionAuthorization';

function failure(code: string) { return { ok: false as const, errorCode: code, error: code }; }

function readTransportErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === 'string' ? code.trim().toUpperCase() : null;
}

function didAxiosRequestEnterTransport(error: unknown): boolean {
  return axios.isAxiosError(error) && error.request !== undefined && error.request !== null;
}

type SessionBoardActionFixedHome =
  | Readonly<{ serverId?: undefined; serverHttpBaseUrl?: undefined }>
  | Readonly<{ serverId: string; serverHttpBaseUrl: string }>;

export function createSessionBoardActionDeps(options: Readonly<{
  credentials: StoredCredentials;
  /** Exact Home snapshot already owned by the caller's runtime/connection; never fetched here. */
  resolveServerFeaturesSnapshot?: () =>
    | CliServerFeaturesSnapshot
    | undefined
    | Promise<CliServerFeaturesSnapshot | undefined>;
}> & ExternalActionHomeBinding & SessionBoardActionFixedHome): Pick<ActionExecutorDeps, 'sessionBoardAction'> {
  if (
    (options.serverId === undefined) !== (options.serverHttpBaseUrl === undefined)
    || (options.serverId !== undefined && options.serverId.trim().length === 0)
    || (options.serverHttpBaseUrl !== undefined && options.serverHttpBaseUrl.trim().length === 0)
  ) {
    throw new Error('fixed_action_server_target_incomplete');
  }
  const serverId = options.serverId ?? configuration.activeServerId;
  const serverUrl = options.serverHttpBaseUrl ?? resolveServerHttpBaseUrl();
  async function put(
    actionId: SessionBoardActionIdV1,
    sessionId: string,
    input: unknown,
    intent: unknown,
    context: Parameters<NonNullable<ActionExecutorDeps['sessionBoardAction']>>[0]['context'],
    signal?: AbortSignal,
  ) {
    if (actionId === 'session.board.get') return failure('unsupported_action');
    const declared = SESSION_BOARD_MUTATION_SERVER_TRANSPORT_V1;
    const mutation = SessionBoardMutationV1Schema.parse(input);
    const body = JSON.stringify(mutation);
    const path = declared.path.replace(':sessionId', encodeURIComponent(sessionId));
    const authorization = resolveExternalActionServerRequestHeaders({ context, effectActionId: actionId,
      method: declared.method, path, body: mutation, daemonToken: options.credentials.token, serverIdentityId: options.serverIdentityId,
      ...(options.externalActionMachineRequestPrivateKey ? { privateKey: options.externalActionMachineRequestPrivateKey } : {}),
      ...(options.externalActionMachineInstallationId ? { installationId: options.externalActionMachineInstallationId } : {}),
    });
    if (!authorization.ok) return failure('not_authenticated');
    if (signal?.aborted) return failure('cancelled');
    let response;
    try { response = await axios.request<unknown>({ url: `${serverUrl}${path}`, method: declared.method,
      data: body, headers: { ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(), ...authorization.headers, 'Content-Type': 'application/json' },
      timeout: configuration.sessionControlHttpTimeoutMs, validateStatus: () => true, signal,
    }); } catch (error) {
      const code = readTransportErrorCode(error);
      // Same disposition the UI Board adapter uses, so one sealed mutation cannot
      // mean "offline" on one host and "outcome unknown" on the other. A coded
      // transport failure means axios reached the transport, and only a
      // connection-establishment failure then proves the Home never received
      // these exact bytes. Every other post-dispatch loss stays ambiguous: it is
      // reported with its frozen request and never replayed automatically.
      const issued = didAxiosRequestEnterTransport(error) || (code !== null && code !== 'ERR_CANCELED');
      if (!issued) {
        return projectSessionBoardAdapterFailureV1(error, signal?.aborted ? 'cancelled' : 'offline');
      }
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return projectSessionBoardAdapterFailureV1(error, 'offline');
      }
      return createSessionBoardOutcomeUnknownFailureV1({
        actionId, serverId, sessionId, requestBody: body, mutationRequest: mutation, intent,
      });
    }
    const settlement = classifySessionBoardMutationTransportResultV1({
      actionId,
      serverId,
      sessionId,
      intent,
      requestBody: body,
      mutationRequest: mutation,
      status: response.status,
      body: response.data,
    });
    return settlement.kind === 'applied'
      ? { ok: true as const, result: settlement.result }
      : SessionBoardActionFailureV1Schema.parse(settlement.result);
  }
  const sessionBoardAction: NonNullable<ActionExecutorDeps['sessionBoardAction']> = async ({ actionId, input, context, signal }) => {
    if (context.serverId && context.serverId !== serverId) return failure('server_target_mismatch');
    if (signal?.aborted) return failure('cancelled');
    const parsed = SESSION_BOARD_ACTION_INPUT_SCHEMAS_V1[actionId].safeParse(input);
    if (!parsed.success) return failure('session_board_invalid');
    const common = parsed.data;
    const sessionId = common.sessionId ?? context.defaultSessionId;
    if (!sessionId) return failure('session_board_invalid');
    const resolveAuthorizationHeaders = (request: Readonly<{ method: 'GET'; path: string }>) => {
      const authorization = resolveExternalActionServerRequestHeaders({ context, effectActionId: actionId,
        method: request.method, path: request.path, daemonToken: options.credentials.token, serverIdentityId: options.serverIdentityId,
        ...(options.externalActionMachineRequestPrivateKey ? { privateKey: options.externalActionMachineRequestPrivateKey } : {}),
        ...(options.externalActionMachineInstallationId ? { installationId: options.externalActionMachineInstallationId } : {}),
      });
      return authorization.ok ? authorization.headers : null;
    };
    // Exact-Home decision first: only a positive sessions.board decision from the caller's
    // already-owned Home snapshot may widen detail to accessProjectionVersion=1 via the
    // canonical fetchSessionById owner. Missing/malformed/unsupported snapshots retain the
    // released bare owner/direct request; this host never probes here when a resolver exists.
    let decision: Awaited<ReturnType<typeof resolveCliFeatureDecisionForServer>>['decision'];
    let serverSnapshot: CliServerFeaturesSnapshot | undefined;
    if (typeof options.resolveServerFeaturesSnapshot === 'function') {
      try {
        serverSnapshot = await options.resolveServerFeaturesSnapshot();
      } catch {
        serverSnapshot = undefined;
      }
      decision = resolveCliFeatureDecision({
        featureId: 'sessions.board',
        env: process.env,
        ...(serverSnapshot ? { serverSnapshot } : {}),
      });
    } else {
      const resolved = await resolveCliFeatureDecisionForServer({
        featureId: 'sessions.board',
        env: process.env,
        serverUrl,
        ...(context.externalActionCredential ? { resolveAuthorizationHeaders } : {}),
      });
      decision = resolved.decision;
      serverSnapshot = resolved.serverSnapshot;
    }
    if (decision.state !== 'enabled') return projectSessionBoardFeatureDecisionFailureV1(actionId, decision);
    const rawSession = await fetchSessionById({
      token: options.credentials.token,
      serverUrl,
      sessionId,
      ...(serverSnapshot ? { serverFeaturesSnapshot: serverSnapshot } : {}),
      resolveAuthorizationHeaders,
      signal,
    });
    if (!rawSession || rawSession.id !== sessionId) return failure('session_board_forbidden');
    const capabilities = rawSession.effectiveAccess?.capabilities;
    if (!capabilities?.readTranscript || (actionId !== 'session.board.get' && !capabilities.editSessionRecords)) return failure('session_board_forbidden');
    const mode = resolveSessionStoredContentEncryptionMode(rawSession);
    const ctx = mode === 'e2ee' ? resolveSessionEncryptionContextFromCredentials(options.credentials, rawSession) : null;
    if (mode === 'e2ee' && !ctx) return failure('encryption_material_unavailable');
    const crypto: SessionStoredContentCryptoContext = ctx ? { mode: 'e2ee', ctx } : { mode: 'plain', ctx: null };
    const transport = { token: options.credentials.token, serverUrl, sessionId, signal, resolveAuthorizationHeaders };
    const layoutAddress = { owner: 'host' as const, namespace: 'surface' as const, kind: 'layout.v1' as const, localId: 'layout' };
    const readLayout = async () => {
      const stored = await readSessionSystemRecordV1({ ...transport, address: layoutAddress });
      return stored ? { revision: stored.revision, document: SessionBoardLayoutV1Schema.parse(openSessionSystemRecord(crypto, stored).content) } : null;
    };
    if (actionId === 'session.board.get') {
      const args = SessionBoardGetInputV1Schema.parse(common);
      const layout = await readLayout();
      const page = args.itemIds === undefined ? await listSessionSystemRecordsV1({ ...transport,
        query: SessionSystemRecordListQuerySchema.parse({ owner: 'host', namespace: 'surface', kind: 'item.v1', limit: args.limit, cursor: args.cursor }),
      }) : null;
      const records = page ? page.records : await Promise.all([...new Set(args.itemIds)].map((localId) => readSessionSystemRecordV1({ ...transport,
        address: { owner: 'host', namespace: 'surface', kind: 'item.v1', localId },
      })));
      const entries: SessionBoardReadProjectionEntryV1[] = [];
      for (const record of records) {
        if (!record) { entries.push({ status: 'unavailable' }); continue; }
        try {
          const item = SessionSurfaceItemV1Schema.parse(openSessionSystemRecord(crypto, record).content);
          entries.push({ status: 'ready', itemId: record.address.localId, revision: record.revision, item });
        } catch { entries.push({ status: 'unavailable' }); }
      }
      return projectSessionBoardGetResultV1({ serverId, sessionId, layout, entries,
        ...(args.itemIds !== undefined ? { requestedItemIds: args.itemIds } : {}),
        incomplete: page?.hasNext === true,
        capabilities: { readTranscript: capabilities.readTranscript, editSessionRecords: capabilities.editSessionRecords },
        page: { cursor: page?.nextCursor ?? null, hasNext: page?.hasNext ?? false },
      });
    }
    if (actionId === 'session.board.layout.update' || actionId === 'session.board.item.remove') {
      const args = actionId === 'session.board.layout.update' ? SessionBoardLayoutUpdateInputV1Schema.parse(common) : SessionBoardItemRemoveInputV1Schema.parse(common);
      const current = await readLayout();
      if ((current?.revision ?? null) !== args.expectedLayoutRevision) {
        return projectSessionBoardActionFailureV1({
          error: 'session_board_revision_conflict',
          currentLayoutRevision: current?.revision ?? null,
        });
      }
      const layout = current?.document ?? { v: 1 as const, tabs: [] };
      const edit = 'operation' in args ? applySessionBoardLayoutOperationV1(layout, args.operation) : removeSessionBoardItemPlacementsV1(layout, args.itemId);
      if (!edit.ok) return failure(edit.error);
      let itemPlacementParticipant: SessionBoardItemPlacementParticipantV1 | undefined;
      if ('operation' in args && args.operation.op === 'item.place') {
        const participant = await readSessionSystemRecordV1({
          ...transport,
          address: { owner: 'host', namespace: 'surface', kind: 'item.v1', localId: args.operation.itemId },
        });
        if (!participant) return failure('session_board_item_not_found');
        itemPlacementParticipant = {
          itemId: args.operation.itemId,
          expectedItemRevision: participant.revision,
        };
      }
      const result = await put(actionId, sessionId, { operation: 'operation' in args ? 'update_layout' : 'remove_item', expectedLayoutRevision: args.expectedLayoutRevision,
        layoutContent: sealSessionSystemRecordContent(crypto, validateSessionSystemRecordOpenedContent(layoutAddress, edit.layout, 'plugin_session_record_invalid_request')),
        ...(itemPlacementParticipant ? { itemPlacementParticipant } : {}),
        ...('itemId' in args ? { itemId: args.itemId, expectedItemRevision: args.expectedItemRevision } : {}),
      }, args, context, signal);
      if (!result.ok) return result;
      return SessionBoardMutationActionResultV1Schema.parse({ v: 1, serverId, sessionId, result: result.result, destination: null });
    }
    const args = SessionBoardItemUpsertInputV1Schema.parse(common);
    const itemAddress = { owner: 'host' as const, namespace: 'surface' as const, kind: 'item.v1' as const, localId: args.itemId };
    const current = await readSessionSystemRecordV1({ ...transport, address: itemAddress });
    if ((current?.revision ?? null) !== args.expectedItemRevision) {
      return projectSessionBoardActionFailureV1({
        error: 'session_board_revision_conflict',
        currentItemRevision: current?.revision ?? null,
      });
    }
    if (current) {
      const previous = SessionSurfaceItemV1Schema.parse(openSessionSystemRecord(crypto, current).content);
      if (!isSessionSurfaceItemSourceCompatible(previous, args.item)) return failure('session_board_source_conflict');
    }
    if (args.item.source.kind === 'installedSurface' && !current) {
      const owner = resolveSessionOwningMachineId({ credentials: options.credentials, rawSession });
      // Each refusal below names its own cause through the Board family's existing
      // closed vocabulary, which the shared presentation owner already renders as a
      // distinct message. Collapsing them into `unsupported_action` told the author
      // "that isn't supported" whether the plugin was absent, declared twice, unable
      // to render here, or simply unreachable for a moment.
      if (!owner.ok || !owner.machineId) return failure('not_found');
      if (
        context.externalActionExecutionAuthorization
        && (!options.externalActionMachineInstallationId || !options.externalActionMachineRequestPrivateKey)
      ) return failure('not_authenticated');
      const response = DaemonContributionRegistryProjectionDescribeResponseSchema.safeParse(await callExactMachineRpc({
        credentials: options.credentials, serverUrl, machineId: owner.machineId,
        method: RPC_METHODS.DAEMON_MERGED_CONTRIBUTION_REGISTRY_PROJECTION_DESCRIBE,
        request: DaemonContributionRegistryProjectionDescribeRequestSchema.parse({ machineId: owner.machineId }), signal,
        ...(context.externalActionExecutionAuthorization
          && options.externalActionMachineInstallationId
          && options.externalActionMachineRequestPrivateKey
          ? {
              externalAction: {
                context,
                effectActionId: actionId,
                installationId: options.externalActionMachineInstallationId,
                privateKey: options.externalActionMachineRequestPrivateKey,
              },
            }
          : {}),
      }));
      if (!response.success) return failure('invalid_response');
      if (response.data.projection.v !== 2) return failure('unsupported_version');
      const surface = args.item.source.surface;
      const placements = Object.values(response.data.projection.familiesById.pluginUi?.entriesById ?? {}).filter((entry) => {
        if (!entry || typeof entry !== 'object' || !('binding' in entry) || !entry.binding || entry.contributionKind !== 'surfacePlacement') return false;
        return isPluginUiInlineSurfaceBindingForSurfaceV1(entry.binding, surface, 'sessionWidget');
      });
      const placement = placements[0];
      if (placements.length !== 1 || !placement || placement.contributionKind !== 'surfacePlacement') return failure('session_board_invalid');
      const availability = DaemonPluginUiTargetedSurfaceRendererAvailabilityV1Schema.safeParse(placement.availability);
      if (!availability.success) return failure('invalid_response');
      if (availability.data.state !== 'available') return failure('unsupported_action');
      const latest = await fetchSessionById({
        token: options.credentials.token,
        serverUrl,
        sessionId,
        ...(serverSnapshot ? { serverFeaturesSnapshot: serverSnapshot } : {}),
        resolveAuthorizationHeaders,
        signal,
      });
      const latestOwner = latest?.id === sessionId ? resolveSessionOwningMachineId({ credentials: options.credentials, rawSession: latest }) : null;
      if (!latestOwner?.ok || latestOwner.machineId !== owner.machineId) return failure('server_target_mismatch');
    }
    let layout: SessionBoardLayoutV1 | null = null;
    let expectedLayoutRevision: string | null = null;
    if (args.placement) {
      const currentLayout = await readLayout();
      const document = currentLayout?.document ?? { v: 1 as const, tabs: [] };
      expectedLayoutRevision = currentLayout?.revision ?? null;
      const edited = applySessionBoardItemPlacementV1(document, { itemId: args.itemId, placement: args.placement });
      if (!edited.ok) return failure(edited.error);
      layout = edited.layout;
    }
    const itemContent = sealSessionSystemRecordContent(crypto, validateSessionSystemRecordOpenedContent(itemAddress, args.item, 'plugin_session_record_invalid_request'));
    const request = SessionBoardMutationV1Schema.parse({ operation: 'upsert_item', itemId: args.itemId, expectedItemRevision: args.expectedItemRevision, itemContent,
      ...(layout ? { placement: { expectedLayoutRevision, layoutContent: sealSessionSystemRecordContent(crypto,
        validateSessionSystemRecordOpenedContent(layoutAddress, layout, 'plugin_session_record_invalid_request')) } } : {}),
    });
    const result = await put(actionId, sessionId, request, args, context, signal);
    if (!result.ok) return result;
    const tab = layout?.tabs.find((entry) => entry.items.some((placement) => placement.itemId === args.itemId));
    const placement = tab?.items.find((entry) => entry.itemId === args.itemId);
    return SessionBoardMutationActionResultV1Schema.parse({ v: 1, serverId, sessionId, result: result.result,
      destination: tab && placement ? { tabId: tab.id, width: placement.width } : null,
      preview: { title: args.item.title, sourceKind: args.item.source.kind },
    });
  };
  return { sessionBoardAction: async (args) => {
    try {
      return await sessionBoardAction(args);
    } catch (error) {
      return projectSessionBoardAdapterFailureV1(error);
    }
  } };
}
