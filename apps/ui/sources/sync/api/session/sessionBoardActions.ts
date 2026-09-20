import {
    applySessionBoardItemPlacementV1, applySessionBoardLayoutOperationV1, removeSessionBoardItemPlacementsV1,
    isSessionSurfaceItemSourceCompatible, bindSessionBoardMutationRequestV1,
    classifySessionBoardMutationTransportResultV1,
    createSessionBoardFailureV1, createSessionBoardOutcomeUnknownFailureV1,
    projectSessionBoardActionFailureV1, projectSessionBoardFeatureGateFailureV1, projectSessionBoardGetResultV1,
    projectSessionBoardAdapterFailureV1,
    SessionBoardGetInputV1Schema,
    SessionBoardItemRemoveInputV1Schema, SessionBoardLayoutUpdateInputV1Schema,
    SessionBoardItemUpsertInputV1Schema, SessionBoardLayoutV1Schema, SessionBoardMutationV1Schema,
    SessionBoardMutationActionResultV1Schema, SessionSurfaceItemV1Schema,
    type SessionBoardGetResultV1, type SessionBoardItemPlacementParticipantV1,
    type SessionBoardLayoutV1, type SessionBoardReadProjectionEntryV1,
} from '@happier-dev/protocol/sessions/board';
import type { ActionExecutorDeps } from '@happier-dev/protocol/actions';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import type {
    HostSessionSystemRecordAddress,
    HostSessionSystemRecordListQuery,
    SessionSystemRecordFetchResult,
    SessionSystemRecordTransportOptions,
} from '@/sync/domains/sessionSystemRecords/transport';
import type { SessionSystemRecordRepository } from '@/sync/domains/sessionSystemRecords/repository';
import { openSessionSystemRecord, type OpenSessionSystemRecordResult } from '@/sync/domains/sessionSystemRecords/codec';
import { sealSessionStoredContent, type SessionStoredContentContext } from '@/sync/encryption/sessionStoredContent';
import type { PluginUiProjectionModel } from '@/sync/domains/plugins/ui/projection';
import { selectPluginInlineSurfacePlacementsBySurface } from '@/sync/domains/plugins/ui/surfacePlacementSelectors';
import { classifyHttpMutationRequestFailure } from '@/sync/http/mutationRequestOutcome';

function projectRecordOwnerFailure(
    actionId: Parameters<NonNullable<ActionExecutorDeps['sessionBoardAction']>>[0]['actionId'],
    status: Exclude<SessionSystemRecordFetchResult<unknown>, Readonly<{ status: 'ok'; value: unknown }>>['status'],
) {
    return status === 'feature_disabled'
        ? projectSessionBoardFeatureGateFailureV1(actionId)
        : createSessionBoardFailureV1(status);
}

export function createSessionBoardActionAdapter(options: SessionSystemRecordTransportOptions & Readonly<{
    session: SessionAddress;
    repository: SessionSystemRecordRepository;
    contentContext: SessionStoredContentContext | null;
    capabilities: SessionBoardGetResultV1['capabilities'];
    resolveInstalledSurfaceProjection?: (session: SessionAddress, signal?: AbortSignal) => Promise<PluginUiProjectionModel | null>;
    /** Retain the exact sealed request before dispatch for post-dispatch scope-retirement recovery. */
    onMutationPrepared?: (details: ReturnType<typeof createSessionBoardOutcomeUnknownFailureV1>['details']) => void;
    /** Observe the canonical HTTP issue boundary; preparation alone is not dispatch. */
    onMutationIssued?: () => void;
}>): NonNullable<ActionExecutorDeps['sessionBoardAction']> {
    const records = {
        async read(session: SessionAddress, address: HostSessionSystemRecordAddress) {
            const query = { type: 'read' as const, address };
            const stop = options.repository.subscribe(session, query, () => {});
            try {
                await options.repository.refresh(session, query);
                const snapshot = options.repository.getSnapshot(session, query);
                if (snapshot.lastError) return snapshot.lastError;
                return snapshot.data ? { status: 'ok' as const, value: snapshot.data } : { status: 'not_found' as const };
            } finally {
                stop();
            }
        },
        async list(session: SessionAddress, input: HostSessionSystemRecordListQuery) {
            const query = { type: 'list' as const, ...input };
            const stop = options.repository.subscribe(session, query, () => {});
            try {
                await options.repository.refresh(session, query);
                const snapshot = options.repository.getSnapshot(session, query);
                if (snapshot.lastError) return snapshot.lastError;
                return snapshot.data ? { status: 'ok' as const, value: snapshot.data } : { status: 'invalid_response' as const };
            } finally {
                stop();
            }
        },
    };
    function open<T>(record: Parameters<typeof openSessionSystemRecord<T>>[0]['record'], address: HostSessionSystemRecordAddress, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<OpenSessionSystemRecordResult<T>> {
        return openSessionSystemRecord<T>({ record, address, context: options.contentContext, decode: (value) => {
            const parsed = schema.safeParse(value);
            return parsed.success ? { status: 'ready' as const, value: parsed.data } : { status: 'malformed' as const };
        } });
    }
    async function readLayout(
        session: SessionAddress,
        actionId: Parameters<NonNullable<ActionExecutorDeps['sessionBoardAction']>>[0]['actionId'],
    ) {
        const stored = await records.read(session, { owner: 'host', namespace: 'surface', kind: 'layout.v1', localId: 'layout' });
        if (stored.status === 'not_found') return { ok: true as const, layout: null };
        if (stored.status !== 'ok') return projectRecordOwnerFailure(actionId, stored.status);
        const opened = await open(stored.value, { owner: 'host', namespace: 'surface', kind: 'layout.v1', localId: 'layout' }, SessionBoardLayoutV1Schema);
        if (opened.status !== 'ready') return createSessionBoardFailureV1(opened.status);
        return { ok: true as const, layout: { revision: stored.value.revision, document: opened.value } };
    }
    async function put(actionId: Parameters<NonNullable<ActionExecutorDeps['sessionBoardAction']>>[0]['actionId'], sessionId: string, input: unknown, intent: unknown, signal?: AbortSignal) {
        if (actionId === 'session.board.get') return createSessionBoardFailureV1('unsupported_action');
        const declared = bindSessionBoardMutationRequestV1({ sessionId, mutation: SessionBoardMutationV1Schema.parse(input) });
        const mutation = declared.body;
        const body = JSON.stringify(mutation);
        if (signal?.aborted) return createSessionBoardFailureV1('cancelled');
        const outcomeUnknown = createSessionBoardOutcomeUnknownFailureV1({
            actionId,
            serverId: options.session.serverId,
            sessionId,
            requestBody: body,
            mutationRequest: mutation,
            intent,
        });
        options.onMutationPrepared?.(outcomeUnknown.details);
        // A sent mutation may have committed even when its acknowledgement is lost.
        const invalidate = () => options.repository.invalidate(options.session);
        let issued = false;
        let response: Response;
        try {
            response = await options.request(declared.path, {
                method: declared.method, headers: { 'Content-Type': 'application/json' }, body, signal,
            }, { onIssued: () => {
                issued = true;
                options.onMutationIssued?.();
            } });
        } catch (error) {
            invalidate();
            const disposition = classifyHttpMutationRequestFailure({ error, issued, signal });
            if (disposition === 'outcome_unknown') return outcomeUnknown;
            if (disposition === 'cancelled') return projectSessionBoardAdapterFailureV1({ code: 'cancelled' });
            return projectSessionBoardAdapterFailureV1(error, 'offline');
        }
        invalidate();
        let value: unknown;
        try { value = await response.json(); } catch { value = undefined; }
        const settlement = classifySessionBoardMutationTransportResultV1({
            actionId,
            serverId: options.session.serverId,
            sessionId,
            intent,
            requestBody: body,
            mutationRequest: mutation,
            status: response.status,
            body: value,
        });
        return settlement.kind === 'applied'
            ? { ok: true as const, result: settlement.result }
            : settlement.result;
    }
    const execute: NonNullable<ActionExecutorDeps['sessionBoardAction']> = async ({ actionId, input, context, signal }) => {
        if (options.session.serverId !== options.scope.serverId || (context.serverId && context.serverId !== options.scope.serverId)) return createSessionBoardFailureV1('server_target_mismatch');
        if (signal?.aborted) return createSessionBoardFailureV1('cancelled');
        if (!options.capabilities.readTranscript || (actionId !== 'session.board.get' && !options.capabilities.editSessionRecords)) return createSessionBoardFailureV1('session_board_forbidden');
        if (actionId === 'session.board.get') {
            const parsed = SessionBoardGetInputV1Schema.safeParse(input);
            if (!parsed.success) return createSessionBoardFailureV1('session_board_invalid');
            const args = parsed.data;
            const sessionId = args.sessionId ?? context.defaultSessionId;
            if (!sessionId) return createSessionBoardFailureV1('session_board_invalid');
            if (sessionId !== options.session.sessionId) return createSessionBoardFailureV1('session_board_forbidden');
            const session = { serverId: options.scope.serverId, sessionId };
            const layout = await readLayout(session, actionId);
            if (!layout.ok) return layout;
            const listed = args.itemIds === undefined
                ? await records.list(session, { namespace: 'surface', kind: 'item.v1', limit: args.limit, cursor: args.cursor })
                : null;
            if (listed && listed.status !== 'ok') return projectRecordOwnerFailure(actionId, listed.status);
            const entries = listed?.status === 'ok'
                ? listed.value.records.map((value) => ({ status: 'ok' as const, value }))
                : await Promise.all([...new Set(args.itemIds)].map((localId) => records.read(session, { owner: 'host', namespace: 'surface', kind: 'item.v1', localId })));
            const projectedEntries: SessionBoardReadProjectionEntryV1[] = [];
            for (const entry of entries) {
                if (entry.status !== 'ok') { projectedEntries.push({ status: 'unavailable' }); continue; }
                const record = entry.value;
                const opened = await open(record, { owner: 'host', namespace: 'surface', kind: 'item.v1', localId: record.address.localId }, SessionSurfaceItemV1Schema);
                if (opened.status !== 'ready') { projectedEntries.push({ status: 'unavailable' }); continue; }
                projectedEntries.push({ status: 'ready', itemId: record.address.localId, revision: record.revision, item: opened.value });
            }
            return projectSessionBoardGetResultV1({ serverId: session.serverId, sessionId, capabilities: options.capabilities,
                layout: layout.layout, entries: projectedEntries,
                ...(args.itemIds !== undefined ? { requestedItemIds: args.itemIds } : {}),
                incomplete: listed?.status === 'ok' && listed.value.hasNext, page: listed?.status === 'ok'
                    ? { cursor: listed.value.nextCursor, hasNext: listed.value.hasNext } : { cursor: null, hasNext: false },
            });
        }
        if (actionId === 'session.board.layout.update' || actionId === 'session.board.item.remove') {
            const parsed = actionId === 'session.board.layout.update'
                ? SessionBoardLayoutUpdateInputV1Schema.safeParse(input) : SessionBoardItemRemoveInputV1Schema.safeParse(input);
            if (!parsed.success) return createSessionBoardFailureV1('session_board_invalid');
            const args = parsed.data;
            const sessionId = args.sessionId ?? context.defaultSessionId;
            if (!sessionId) return createSessionBoardFailureV1('session_board_invalid');
            if (sessionId !== options.session.sessionId) return createSessionBoardFailureV1('session_board_forbidden');
            const current = await readLayout({ serverId: options.scope.serverId, sessionId }, actionId);
            if (!current.ok) return current;
            if ((current.layout?.revision ?? null) !== args.expectedLayoutRevision) {
                return projectSessionBoardActionFailureV1({
                    error: 'session_board_revision_conflict',
                    currentLayoutRevision: current.layout?.revision ?? null,
                });
            }
            const layout = current.layout?.document ?? { v: 1 as const, tabs: [] };
            const edit = 'operation' in args ? applySessionBoardLayoutOperationV1(layout, args.operation) : removeSessionBoardItemPlacementsV1(layout, args.itemId);
            if (!edit.ok) return createSessionBoardFailureV1(edit.error);
            let itemPlacementParticipant: SessionBoardItemPlacementParticipantV1 | undefined;
            if ('operation' in args && args.operation.op === 'item.place') {
                const participant = await records.read(
                    { serverId: options.scope.serverId, sessionId },
                    { owner: 'host', namespace: 'surface', kind: 'item.v1', localId: args.operation.itemId },
                );
                if (participant.status === 'not_found') return createSessionBoardFailureV1('session_board_item_not_found');
                if (participant.status !== 'ok') return projectRecordOwnerFailure(actionId, participant.status);
                itemPlacementParticipant = {
                    itemId: args.operation.itemId,
                    expectedItemRevision: participant.value.revision,
                };
            }
            const sealed = await sealSessionStoredContent(options.contentContext, edit.layout);
            if (sealed.status !== 'ready') return createSessionBoardFailureV1(sealed.status);
            const result = await put(actionId, sessionId, { operation: 'operation' in args ? 'update_layout' : 'remove_item',
                expectedLayoutRevision: args.expectedLayoutRevision, layoutContent: sealed.content,
                ...(itemPlacementParticipant ? { itemPlacementParticipant } : {}),
                ...('itemId' in args ? { itemId: args.itemId, expectedItemRevision: args.expectedItemRevision } : {}),
            }, args, signal);
            if (!result.ok) return result;
            return SessionBoardMutationActionResultV1Schema.parse({ v: 1, serverId: options.scope.serverId, sessionId, result: result.result, destination: null });
        }
        const parsed = SessionBoardItemUpsertInputV1Schema.safeParse(input);
        if (!parsed.success) return createSessionBoardFailureV1('session_board_invalid');
        const args = parsed.data;
        const sessionId = args.sessionId ?? context.defaultSessionId;
        if (!sessionId) return createSessionBoardFailureV1('session_board_invalid');
        if (sessionId !== options.session.sessionId) return createSessionBoardFailureV1('session_board_forbidden');
        const session = { serverId: options.scope.serverId, sessionId };
        const current = await records.read(session, { owner: 'host', namespace: 'surface', kind: 'item.v1', localId: args.itemId });
        if (current.status !== 'ok' && current.status !== 'not_found') return projectRecordOwnerFailure(actionId, current.status);
        if ((current.status === 'ok' ? current.value.revision : null) !== args.expectedItemRevision) {
            return projectSessionBoardActionFailureV1({
                error: 'session_board_revision_conflict',
                currentItemRevision: current.status === 'ok' ? current.value.revision : null,
            });
        }
        if (current.status === 'ok') {
            const opened = await open(current.value, { owner: 'host', namespace: 'surface', kind: 'item.v1', localId: args.itemId }, SessionSurfaceItemV1Schema);
            if (opened.status !== 'ready') return createSessionBoardFailureV1(opened.status);
            if (!isSessionSurfaceItemSourceCompatible(opened.value, args.item)) return createSessionBoardFailureV1('session_board_source_conflict');
        }
        // New installed references require PEP admission. Existing items may
        // update their content/chrome after the source-identity check above.
        if (args.item.source.kind === 'installedSurface' && current.status === 'not_found') {
            const projection = await options.resolveInstalledSurfaceProjection?.(session, signal);
            const placements = projection ? selectPluginInlineSurfacePlacementsBySurface(projection, args.item.source.surface, 'sessionWidget') : [];
            if (placements.length !== 1 || placements[0]!.availability.state !== 'available') return createSessionBoardFailureV1('unsupported_action');
        }
        let layout: SessionBoardLayoutV1 | null = null;
        let expectedLayoutRevision: string | null = null;
        if (args.placement) {
            const storedLayout = await readLayout(session, actionId);
            if (!storedLayout.ok) return storedLayout;
            layout = storedLayout.layout?.document ?? { v: 1, tabs: [] };
            expectedLayoutRevision = storedLayout.layout?.revision ?? null;
            const edited = applySessionBoardItemPlacementV1(layout, { itemId: args.itemId, placement: args.placement });
            if (!edited.ok) return createSessionBoardFailureV1(edited.error);
            layout = edited.layout;
        }
        const itemContent = await sealSessionStoredContent(options.contentContext, args.item);
        if (itemContent.status !== 'ready') return createSessionBoardFailureV1(itemContent.status);
        const layoutContent = layout ? await sealSessionStoredContent(options.contentContext, layout) : null;
        if (layoutContent && layoutContent.status !== 'ready') return createSessionBoardFailureV1(layoutContent.status);
        const request = SessionBoardMutationV1Schema.parse({
            operation: 'upsert_item', itemId: args.itemId, expectedItemRevision: args.expectedItemRevision,
            itemContent: itemContent.content,
            ...(layoutContent?.status === 'ready' ? { placement: { expectedLayoutRevision, layoutContent: layoutContent.content } } : {}),
        });
        const result = await put(actionId, sessionId, request, args, signal);
        if (!result.ok) return result;
        const tab = layout?.tabs.find((entry) => entry.items.some((placement) => placement.itemId === args.itemId));
        const placement = tab?.items.find((entry) => entry.itemId === args.itemId);
        return SessionBoardMutationActionResultV1Schema.parse({
            v: 1, serverId: session.serverId, sessionId, result: result.result,
            destination: tab && placement ? { tabId: tab.id, width: placement.width } : null,
            preview: { title: args.item.title, sourceKind: args.item.source.kind },
        });
    };
    return async (args) => {
        try {
            return await execute(args);
        } catch (error) {
            return projectSessionBoardAdapterFailureV1(error);
        }
    };
}
