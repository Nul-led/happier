import type { PluginActionInputById, PluginInvocableActionId } from './actions/service.js';
import type {
    InteractionTransientApprovalAuthorRequestV1,
    InteractionTransientApprovalResultV1,
    InteractionTransientConfirmationAuthorRequestV1,
    InteractionTransientConfirmationResultV1,
    InteractionTransientQuestionsAuthorRequestV1,
    InteractionTransientQuestionsResultV1,
} from '@happier-dev/protocol';
import type { JsonValue } from './identity.js';
import type { Disposable, PluginCancellationOptions } from './lifecycle.js';
/** @realm daemon */
export type { PluginInvocationSurface } from './invocation.js';

/**
 * The Protocol owns transient interaction shape, bounds, and terminal
 * vocabulary. The SDK publishes only the author inputs and terminal results;
 * host-stamped request custody and settlement remain host-private.
 */
export type {
    InteractionTerminalStatusV1,
    InteractionTransientApprovalAuthorRequestV1,
    InteractionTransientApprovalResultV1,
    InteractionTransientAuthorQuestionV1,
    InteractionTransientAuthorRequestV1,
    InteractionTransientChoiceSelectionV1,
    InteractionTransientConfirmationAuthorRequestV1,
    InteractionTransientConfirmationResultV1,
    InteractionTransientQuestionAnswerV1,
    InteractionTransientQuestionsAuthorRequestV1,
    InteractionTransientQuestionsResultV1,
    InteractionTransientResultV1,
} from '@happier-dev/protocol';

/**
 * Reversible viewer-local presentation intent for the exact mounted Session.
 * Protocol owns validation and transport; this structural projection keeps the
 * public Plugin SDK declaration graph self-contained.
 */
export type CurrentSessionPresentationIntentV1 =
    | { kind: 'chat.return' }
    | { kind: 'board.open'; mode: 'beside_chat' | 'focus' }
    | { kind: 'board.view.select'; viewId: string }
    | { kind: 'board.item.reveal'; widgetId: string; viewId?: string }
    | { kind: 'companion.show' }
    | { kind: 'companion.hide' }
    | {
        kind: 'companion.item.add';
        item: { kind: 'builtin'; id: 'session_summary' }
            | { kind: 'widget'; widgetId: string };
        index?: number;
    }
    | {
        kind: 'companion.item.remove';
        item: { kind: 'builtin'; id: 'session_summary' }
            | { kind: 'widget'; widgetId: string };
    }
    | {
        kind: 'companion.item.move';
        item: { kind: 'builtin'; id: 'session_summary' }
            | { kind: 'widget'; widgetId: string };
        toIndex: number;
    }
    | { kind: 'companion.edge.set'; edge: 'leading' | 'trailing' }
    | { kind: 'companion.collapse.set'; collapsed: boolean }
    | { kind: 'companion.density.set'; density: 'compact' | 'comfortable' }
    | { kind: 'companion.open_full' };

export type InteractionOptions = PluginCancellationOptions;
export type InteractionSeverity = 'info' | 'warning' | 'error';

export type UiWidget = Readonly<{
    placement: 'beforeComposer' | 'afterComposer';
    lines: readonly string[];
}>;

export type ApprovalRequestStatus =
    | 'open'
    | 'approved'
    | 'rejected'
    | 'executed'
    | 'failed'
    | 'canceled';

export type ApprovalRequest = Readonly<{
    approvalRequestId: string;
    status: ApprovalRequestStatus;
    actionId: string;
    input: JsonValue;
    summary: string;
    createdAtMs: number;
    updatedAtMs: number;
    decision?: Readonly<{ kind: 'approve' | 'reject'; decidedAtMs: number }>;
    execution?: Readonly<{
        executedAtMs: number;
        ok: boolean;
        result?: JsonValue;
        errorCode?: string;
        error?: string;
    }>;
}>;

export type ApprovalQueueListItem = Readonly<{
    approvalRequestId: string;
    status: ApprovalRequestStatus;
    actionId: string;
    summary: string;
    sessionId?: string;
    serverId?: string;
    updatedAtMs: number;
}>;

export type ApprovalQueueQuery = Readonly<{
    status?: ApprovalRequest['status'];
    limit?: number;
}>;

export type ApprovalQueueRequest<
    TActionId extends PluginInvocableActionId = PluginInvocableActionId,
> = Readonly<{
    actionId: TActionId;
    input: PluginActionInputById[TActionId];
    summary?: string;
}>;

export type ApprovalQueueRequestResult = Readonly<{ approvalRequestId: string }>;
export type ApprovalQueueSnapshot = Readonly<{
    items: readonly ApprovalQueueListItem[];
}>;

export interface ApprovalQueueService {
    request<TActionId extends PluginInvocableActionId>(
        request: ApprovalQueueRequest<TActionId>,
        options?: InteractionOptions,
    ): Promise<ApprovalQueueRequestResult>;
    get(
        approvalRequestId: string,
        options?: InteractionOptions,
    ): Promise<ApprovalRequest | null>;
    list(
        query?: ApprovalQueueQuery,
        options?: InteractionOptions,
    ): Promise<ApprovalQueueSnapshot>;
    watch(
        query: ApprovalQueueQuery | undefined,
        listener: (snapshot: ApprovalQueueSnapshot) => void | Promise<void>,
        options?: InteractionOptions,
    ): Promise<Disposable>;
}

export interface InteractionsService {
    requestApproval(
        request: InteractionTransientApprovalAuthorRequestV1,
        options?: InteractionOptions,
    ): Promise<InteractionTransientApprovalResultV1>;
    askQuestions(
        request: InteractionTransientQuestionsAuthorRequestV1,
        options?: InteractionOptions,
    ): Promise<InteractionTransientQuestionsResultV1>;
    confirm(
        request: InteractionTransientConfirmationAuthorRequestV1,
        options?: InteractionOptions,
    ): Promise<InteractionTransientConfirmationResultV1>;
    readonly approvals: ApprovalQueueService;
}

export interface PresentationService {
    /** Applies one reversible presentation intent to the exact current Session UI. */
    present(
        intent: CurrentSessionPresentationIntentV1,
        options?: PluginCancellationOptions,
    ): Promise<void>;
    notify(
        message: string,
        options?: Readonly<{ severity?: InteractionSeverity; signal?: AbortSignal }>,
    ): Promise<void>;
    readonly status: Readonly<{
        set(key: string, text: string | null, options?: PluginCancellationOptions): Promise<void>;
    }>;
    readonly widget: Readonly<{
        set(key: string, widget: UiWidget | null, options?: PluginCancellationOptions): Promise<void>;
    }>;
    readonly composer: Readonly<{
        replace(text: string, options?: PluginCancellationOptions): Promise<void>;
    }>;
}
