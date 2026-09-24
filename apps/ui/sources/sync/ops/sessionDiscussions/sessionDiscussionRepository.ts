import type {
    SessionDraftAddressV2,
    SessionDiscussionCreateResultV1,
    SessionDiscussionDetailsResultV1,
    SessionDiscussionListInputV1,
    SessionDiscussionListResultV1,
    SessionDiscussionMessageContentV1,
    SessionDiscussionOpenedMessageV1,
    SessionDiscussionOpenedSummaryV1,
    SessionDiscussionPostResultV1,
    SessionDiscussionReadResultV1,
    SessionDiscussionReadStateResultV1,
} from '@happier-dev/protocol';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionDraftCurrentness } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import type { SessionDiscussionClientOutcome } from '@/sync/api/session/sessionDiscussionActions';
import { watchMountedSessionDiscussions, type MountedSessionDiscussionChangeWatch } from '@/sync/domains/session/discussions/sessionDiscussionChangeWatch';

export type SessionDiscussionRepositoryClient = Readonly<{
    list(input?: Omit<SessionDiscussionListInputV1, 'sessionId'>, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionListResultV1>>;
    get(discussionId: string, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionDetailsResultV1>>;
    read(discussionId: string, input?: Readonly<{ beforeSeq?: number; afterSeq?: number; limit?: number }>, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionReadResultV1>>;
    create(input: Readonly<{ creationLocalId: string; messageLocalId: string; title: string; content: SessionDiscussionMessageContentV1; mentionedAccountIds?: readonly string[] }>, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionCreateResultV1>>;
    post(input: Readonly<{ discussionId: string; localId: string; content: SessionDiscussionMessageContentV1; mentionedAccountIds?: readonly string[] }>, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionPostResultV1>>;
    rename(discussionId: string, title: string, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionDetailsResultV1>>;
    archive(discussionId: string, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionDetailsResultV1>>;
    restore(discussionId: string, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionDetailsResultV1>>;
    readState(discussionId: string, lastReadSeq: number, signal?: AbortSignal): Promise<SessionDiscussionClientOutcome<SessionDiscussionReadStateResultV1>>;
}>;

export type SessionDiscussionRepositoryStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'locked' | 'error' | 'revoked';
export type SessionDiscussionMutationStatus = 'sending' | 'checking' | 'outcome_unknown' | 'approval_pending' | 'failed' | 'observed_success';
/**
 * How a settled failure can be left behind: a transient failure keeps its
 * identity for an explicit retry, a definitive refusal is dismissed and the
 * retained draft is sent again as a fresh attempt.
 */
export type SessionDiscussionMutationRecovery = 'retry' | 'dismiss';

export type SessionDiscussionDraftSubmission = Readonly<{
    scope: ServerAccountScope;
    address: Extract<SessionDraftAddressV2, { kind: 'discussion' | 'newDiscussion' }>;
    currentness: SessionDraftCurrentness;
}>;

type CreateIntent = Readonly<{
    kind: 'create';
    creationLocalId: string;
    messageLocalId: string;
    title: string;
    content: SessionDiscussionMessageContentV1;
    mentionedAccountIds?: readonly string[];
    draftSubmission: SessionDiscussionDraftSubmission;
}>;

type PostIntent = Readonly<{
    kind: 'post';
    discussionId: string;
    localId: string;
    content: SessionDiscussionMessageContentV1;
    mentionedAccountIds?: readonly string[];
    draftSubmission: SessionDiscussionDraftSubmission;
}>;

type MutationIntent = CreateIntent | PostIntent;

export type SessionDiscussionRepositoryMutation = Readonly<{
    kind: MutationIntent['kind'];
    localId: string;
    messageLocalId?: string;
    discussionId?: string;
    status: SessionDiscussionMutationStatus;
    artifactId?: string;
    errorCode?: string;
    recovery?: SessionDiscussionMutationRecovery;
    content: SessionDiscussionMessageContentV1;
    mentionedAccountIds?: readonly string[];
    draftSubmission: SessionDiscussionDraftSubmission;
}>;

type ListPage = Readonly<{
    requestCursor: string | null;
    rows: readonly SessionDiscussionOpenedSummaryV1[];
    nextCursor: string | null;
    incomplete: boolean;
}>;

export type SessionDiscussionRepositoryListSnapshot = Readonly<{
    items: readonly SessionDiscussionOpenedSummaryV1[];
    nextCursor: string | null;
    status: SessionDiscussionRepositoryStatus;
    errorCode: string | null;
    incomplete: boolean;
}>;

export type SessionDiscussionRepositoryThreadSnapshot = Readonly<{
    summary: SessionDiscussionOpenedSummaryV1 | null;
    messages: readonly SessionDiscussionOpenedMessageV1[];
    hasMoreOlder: boolean;
    messageSeq: number;
    status: SessionDiscussionRepositoryStatus;
    errorCode: string | null;
    incomplete: boolean;
}>;

/**
 * Whether this Session has any archived Discussion at all. `unknown` is the
 * honest answer before a read settles and after one is refused; a reader must
 * never present it as emptiness.
 */
export type SessionDiscussionArchivedExistence = 'unknown' | 'empty' | 'present';

export type SessionDiscussionRepositorySnapshot = Readonly<{
    address: SessionAddress;
    lists: Readonly<Record<'active' | 'archived', SessionDiscussionRepositoryListSnapshot>>;
    archivedExistence: SessionDiscussionArchivedExistence;
    threads: Readonly<Record<string, SessionDiscussionRepositoryThreadSnapshot>>;
    mutations: Readonly<Record<string, SessionDiscussionRepositoryMutation>>;
}>;

export type SessionDiscussionRepositoryMutationOutcome<T> =
    | Readonly<{ kind: 'succeeded'; value: T }>
    | Readonly<{ kind: 'checking' }>
    | Readonly<{ kind: 'approval_request_created'; artifactId: string }>
    | Readonly<{ kind: 'failed'; errorCode: string }>;

export type SessionDiscussionReadStateWriteOutcome =
    | Readonly<{ kind: 'succeeded'; lastReadSeq: number }>
    | Readonly<{ kind: 'retryable'; errorCode: string }>
    | Readonly<{ kind: 'stopped'; errorCode: string }>;

const EMPTY_LIST: SessionDiscussionRepositoryListSnapshot = Object.freeze({ items: [], nextCursor: null, status: 'idle', errorCode: null, incomplete: false });

function emptyThread(): SessionDiscussionRepositoryThreadSnapshot {
    return { summary: null, messages: [], hasMoreOlder: false, messageSeq: 0, status: 'idle', errorCode: null, incomplete: false };
}

function stableJsonEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function retainStableRow<T extends Readonly<{ id: string }>>(existing: ReadonlyMap<string, T>, incoming: T): T {
    const current = existing.get(incoming.id);
    return current && stableJsonEqual(current, incoming) ? current : incoming;
}

function flattenListPages(pages: readonly ListPage[], previous: readonly SessionDiscussionOpenedSummaryV1[]): readonly SessionDiscussionOpenedSummaryV1[] {
    const previousById = new Map(previous.map((row) => [row.id, row]));
    const seen = new Set<string>();
    const rows: SessionDiscussionOpenedSummaryV1[] = [];
    for (const page of pages) {
        for (const row of page.rows) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            rows.push(retainStableRow(previousById, row));
        }
    }
    return rows;
}

export function mergeSessionDiscussionMessages(
    previous: readonly SessionDiscussionOpenedMessageV1[],
    incoming: readonly SessionDiscussionOpenedMessageV1[],
): readonly SessionDiscussionOpenedMessageV1[] {
    const previousById = new Map(previous.map((row) => [row.id, row]));
    const byId = new Map<string, SessionDiscussionOpenedMessageV1>();
    for (const row of [...previous, ...incoming]) byId.set(row.id, retainStableRow(previousById, row));
    return [...byId.values()].sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id));
}

function statusForFailure(errorCode: string): SessionDiscussionRepositoryStatus {
    if (errorCode === 'offline' || errorCode === 'unavailable' || errorCode === 'canceled') return 'offline';
    if (errorCode === 'locked' || errorCode === 'session_discussion_encryption_mode_mismatch') return 'locked';
    if (errorCode === 'forbidden' || errorCode === 'session_discussion_read_denied') return 'revoked';
    return 'error';
}

function isExplicitAccessLoss(errorCode: string): boolean {
    return errorCode === 'forbidden'
        || errorCode === 'session_discussion_read_denied'
        // Protected Discussion reads intentionally collapse a missing resource and
        // lost access into the same nondisclosing result. Once private content was
        // loaded, retaining it is unsafe whichever underlying condition caused it.
        || errorCode === 'session_discussion_not_found';
}

/**
 * A definitive refusal will be earned again by resending the identical intent:
 * the typed domain vocabulary says the request itself, the target, or the
 * viewer's standing was refused. Everything else (offline, transport, a
 * pending E2EE key, an unknown code) keeps the identity for an explicit retry.
 */
function isDefinitiveMutationRefusal(errorCode: string): boolean {
    return errorCode === 'session_discussion_post_denied'
        || errorCode === 'session_discussion_manage_denied'
        || errorCode === 'session_discussion_invalid_content'
        || errorCode === 'session_discussion_invalid_mention'
        || errorCode === 'session_discussion_archived'
        || errorCode === 'session_discussion_session_archived'
        || errorCode === 'session_discussion_encryption_mode_mismatch'
        || errorCode === 'session_discussion_idempotency_conflict'
        || errorCode === 'session_discussions_unavailable';
}

function recoveryForFailure(errorCode: string): SessionDiscussionMutationRecovery {
    return isDefinitiveMutationRefusal(errorCode) ? 'dismiss' : 'retry';
}

function isPermanentReadStateRefusal(errorCode: string): boolean {
    return isExplicitAccessLoss(errorCode)
        || errorCode === 'session_not_tracked'
        || errorCode === 'session_discussion_read_cursor_invalid'
        || errorCode === 'session_discussions_unavailable';
}

export function createSessionDiscussionRepository(options: Readonly<{
    address: SessionAddress;
    client: SessionDiscussionRepositoryClient;
}>) {
    const listeners = new Set<() => void>();
    const listPages: Record<'active' | 'archived', ListPage[]> = { active: [], archived: [] };
    const intents = new Map<string, MutationIntent>();
    let client = options.client;
    let mountedWatch: MountedSessionDiscussionChangeWatch | null = null;
    let mountReferences = 0;
    let accessLossEpoch = 0;
    let snapshot: SessionDiscussionRepositorySnapshot = {
        address: options.address,
        lists: { active: EMPTY_LIST, archived: EMPTY_LIST },
        archivedExistence: 'unknown',
        threads: {},
        mutations: {},
    };

    const publish = (next: SessionDiscussionRepositorySnapshot) => {
        if (next === snapshot) return;
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const purgeAccessLost = (errorCode: string) => {
        accessLossEpoch += 1;
        listPages.active = [];
        listPages.archived = [];
        intents.clear();
        const revoked: SessionDiscussionRepositoryListSnapshot = Object.freeze({
            items: [], nextCursor: null, status: 'revoked', errorCode, incomplete: false,
        });
        publish({
            address: options.address,
            lists: { active: revoked, archived: revoked },
            archivedExistence: 'unknown',
            threads: {},
            mutations: {},
        });
    };
    const updateList = (state: 'active' | 'archived', value: SessionDiscussionRepositoryListSnapshot) => publish({
        ...snapshot, lists: { ...snapshot.lists, [state]: value },
    });
    const updateThread = (discussionId: string, value: SessionDiscussionRepositoryThreadSnapshot) => publish({
        ...snapshot, threads: { ...snapshot.threads, [discussionId]: value },
    });
    const updateMutation = (localId: string, value: SessionDiscussionRepositoryMutation | null) => {
        const mutations = { ...snapshot.mutations };
        if (value) mutations[localId] = value;
        else delete mutations[localId];
        publish({ ...snapshot, mutations });
    };
    const markMutationObservedSuccess = (localId: string) => {
        const current = snapshot.mutations[localId];
        if (!current) return;
        const { artifactId: _artifactId, errorCode: _errorCode, recovery: _recovery, ...retained } = current;
        updateMutation(localId, { ...retained, status: 'observed_success' });
    };
    const updateArchivedExistence = (value: SessionDiscussionArchivedExistence) => {
        if (snapshot.archivedExistence === value) return;
        publish({ ...snapshot, archivedExistence: value });
    };
    const applyListPages = (state: 'active' | 'archived', status: SessionDiscussionRepositoryStatus, errorCode: string | null) => {
        const pages = listPages[state];
        const current = snapshot.lists[state];
        const items = flattenListPages(pages, current.items);
        updateList(state, {
            items,
            nextCursor: pages.at(-1)?.nextCursor ?? null,
            status,
            errorCode,
            incomplete: pages.some((page) => page.incomplete),
        });
        // Loaded archived rows are a stronger answer than the bounded probe, so
        // the list settling replaces it. A failed or still-loading read leaves
        // the last proven answer alone rather than inventing emptiness.
        if (state === 'archived' && (status === 'ready' || status === 'locked')) {
            updateArchivedExistence(items.length > 0 ? 'present' : 'empty');
        }
    };
    const applySummary = (row: SessionDiscussionOpenedSummaryV1) => {
        const state = row.archivedAt === null ? 'active' : 'archived';
        const other = state === 'active' ? 'archived' : 'active';
        listPages[other] = listPages[other].map((page) => ({
            ...page,
            rows: page.rows.filter((item) => item.id !== row.id),
        }));
        let replacedExisting = false;
        listPages[state] = listPages[state].map((page) => ({
            ...page,
            rows: page.rows.map((item) => {
                if (item.id !== row.id) return item;
                replacedExisting = true;
                return row;
            }),
            incomplete: page.incomplete || row.title === null,
        }));
        if (listPages[state].length === 0) {
            listPages[state].push({ requestCursor: null, rows: [row], nextCursor: null, incomplete: row.title === null });
        } else if (!replacedExisting) {
            const first = listPages[state][0]!;
            listPages[state][0] = { ...first, rows: [row, ...first.rows], incomplete: first.incomplete || row.title === null };
        }
        applyListPages(other, snapshot.lists[other].status, snapshot.lists[other].errorCode);
        applyListPages(state, 'ready', null);
        const thread = snapshot.threads[row.id];
        if (thread) updateThread(row.id, { ...thread, summary: row });
    };

    const loadListPage = async (state: 'active' | 'archived', cursor: string | null, signal?: AbortSignal) => {
        const outcome = await client.list({ state, ...(cursor ? { cursor } : {}) }, signal);
        if (outcome.kind !== 'succeeded') return outcome;
        return { kind: 'succeeded' as const, value: {
            requestCursor: cursor,
            rows: outcome.value.discussions,
            nextCursor: outcome.value.nextCursor,
            incomplete: outcome.value.incomplete,
        } satisfies ListPage };
    };

    /**
     * One bounded archived read taken beside the active refresh, so a reader can
     * tell whether an archived Discussion exists before deciding to offer the
     * archived disclosure. It loads no page: the archived list stays lazy and
     * keeps its own pagination for when the reader actually opens it.
     */
    const probeArchivedExistence = async (signal?: AbortSignal): Promise<void> => {
        if (listPages.archived.length > 0) return;
        const operationEpoch = accessLossEpoch;
        const outcome = await client.list({ state: 'archived', limit: 1 }, signal);
        if (operationEpoch !== accessLossEpoch) return;
        if (outcome.kind !== 'succeeded') {
            if (outcome.kind === 'failed' && isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
            return;
        }
        updateArchivedExistence(outcome.value.discussions.length > 0 ? 'present' : 'empty');
    };

    const refreshList = async (state: 'active' | 'archived', signal?: AbortSignal): Promise<void> => {
        const operationEpoch = accessLossEpoch;
        const retained = snapshot.lists[state];
        updateList(state, { ...retained, status: 'loading', errorCode: null });
        const pageCount = Math.max(1, listPages[state].length);
        const replacement: ListPage[] = [];
        let cursor: string | null = null;
        for (let index = 0; index < pageCount; index += 1) {
            const outcome = await loadListPage(state, cursor, signal);
            if (operationEpoch !== accessLossEpoch) return;
            if (outcome.kind !== 'succeeded') {
                const code = outcome.kind === 'failed' ? outcome.errorCode : 'outcome_unknown';
                if (isExplicitAccessLoss(code)) purgeAccessLost(code);
                else updateList(state, { ...retained, status: statusForFailure(code), errorCode: outcome.kind === 'failed' ? outcome.errorCode : outcome.kind });
                return;
            }
            replacement.push(outcome.value);
            cursor = outcome.value.nextCursor;
            if (!cursor) break;
        }
        listPages[state] = replacement;
        applyListPages(state, replacement.some((page) => page.incomplete) ? 'locked' : 'ready', null);
        if (state === 'active') await probeArchivedExistence(signal);
    };

    const loadMoreList = async (state: 'active' | 'archived', signal?: AbortSignal): Promise<void> => {
        const cursor = listPages[state].at(-1)?.nextCursor ?? null;
        if (!cursor) return;
        const retained = snapshot.lists[state];
        const operationEpoch = accessLossEpoch;
        updateList(state, { ...retained, status: 'loading', errorCode: null });
        const outcome = await loadListPage(state, cursor, signal);
        if (operationEpoch !== accessLossEpoch) return;
        if (outcome.kind !== 'succeeded') {
            const code = outcome.kind === 'failed' ? outcome.errorCode : 'outcome_unknown';
            if (isExplicitAccessLoss(code)) purgeAccessLost(code);
            else updateList(state, { ...retained, status: statusForFailure(code), errorCode: outcome.kind === 'failed' ? outcome.errorCode : outcome.kind });
            return;
        }
        const pageIndex = listPages[state].findIndex((page) => page.requestCursor === cursor);
        if (pageIndex >= 0) listPages[state][pageIndex] = outcome.value;
        else listPages[state].push(outcome.value);
        applyListPages(state, outcome.value.incomplete ? 'locked' : 'ready', null);
    };

    const refreshMessages = async (discussionId: string, signal?: AbortSignal): Promise<void> => {
        const operationEpoch = accessLossEpoch;
        const retained = snapshot.threads[discussionId] ?? emptyThread();
        updateThread(discussionId, { ...retained, status: 'loading', errorCode: null });
        let messages = retained.messages;
        let messageSeq = retained.messageSeq;
        let observedHasMoreOlder: boolean | null = null;
        const received: SessionDiscussionOpenedMessageV1[] = [];
        // A retained row the Session cipher could not open kept no ciphertext, so it
        // is completed by asking the Discussion owner for it again under the current
        // key rather than resuming after the highest retained sequence.
        const firstLockedIndex = messages.findIndex((row) => row.content === null);
        let afterSeq = firstLockedIndex >= 0
            ? (firstLockedIndex === 0 ? undefined : messages[firstLockedIndex - 1]!.seq)
            : messages.at(-1)?.seq;
        for (;;) {
            const outcome = await client.read(discussionId, afterSeq === undefined ? {} : { afterSeq }, signal);
            if (operationEpoch !== accessLossEpoch) return;
            if (outcome.kind !== 'succeeded') {
                const code = outcome.kind === 'failed' ? outcome.errorCode : outcome.kind;
                if (isExplicitAccessLoss(code)) purgeAccessLost(code);
                else if (statusForFailure(code) === 'revoked') {
                    updateThread(discussionId, { ...emptyThread(), status: 'revoked', errorCode: code });
                } else {
                    // Reporting this read's failure must not republish the thread as it
                    // looked before the await: another surface may have loaded newer
                    // messages, and the pages this read did receive are still valid.
                    const failed = mergeSessionDiscussionMessages(
                        (snapshot.threads[discussionId] ?? retained).messages,
                        received,
                    );
                    updateThread(discussionId, {
                        ...(snapshot.threads[discussionId] ?? retained),
                        messages: failed,
                        incomplete: failed.some((row) => row.content === null),
                        status: statusForFailure(code), errorCode: code,
                    });
                }
                return;
            }
            received.push(...outcome.value.messages);
            messages = mergeSessionDiscussionMessages(messages, outcome.value.messages);
            if (afterSeq === undefined) observedHasMoreOlder = outcome.value.hasMoreOlder;
            messageSeq = Math.max(messageSeq, outcome.value.messageSeq);
            const highest = messages.at(-1)?.seq ?? 0;
            if (highest >= messageSeq
                || outcome.value.messages.length === 0
                || (afterSeq !== undefined && highest <= afterSeq)) {
                break;
            }
            afterSeq = highest;
        }
        // Another mounted surface can publish newer rows while this read is in
        // flight, so the response reconciles against the current thread instead of
        // the snapshot it captured before awaiting.
        const current = snapshot.threads[discussionId] ?? retained;
        const merged = mergeSessionDiscussionMessages(current.messages, received);
        const incomplete = merged.some((row) => row.content === null);
        updateThread(discussionId, {
            ...current,
            messages: merged,
            hasMoreOlder: observedHasMoreOlder ?? current.hasMoreOlder,
            messageSeq: Math.max(current.messageSeq, messageSeq),
            status: incomplete ? 'locked' : 'ready',
            errorCode: null,
            incomplete,
        });
        for (const intent of intents.values()) {
            if (intent.kind === 'post'
                && intent.discussionId === discussionId
                && merged.some((row) => row.localId === intent.localId)) {
                markMutationObservedSuccess(intent.localId);
            }
        }
    };

    const refreshDiscussion = async (discussionId: string, signal?: AbortSignal): Promise<void> => {
        const operationEpoch = accessLossEpoch;
        const retained = snapshot.threads[discussionId] ?? emptyThread();
        const outcome = await client.get(discussionId, signal);
        if (operationEpoch !== accessLossEpoch) return;
        if (outcome.kind !== 'succeeded') {
            const code = outcome.kind === 'failed' ? outcome.errorCode : outcome.kind;
            if (isExplicitAccessLoss(code)) purgeAccessLost(code);
            else updateThread(discussionId, {
                ...(statusForFailure(code) === 'revoked' ? emptyThread() : retained),
                status: statusForFailure(code), errorCode: code,
            });
            return;
        }
        applySummary(outcome.value.discussion);
        // `applySummary` only refreshes a thread that already exists. A reader opening
        // an existing Discussion for the first time in this repository lifetime has no
        // thread yet, so the summary this get just proved must seed it; otherwise the
        // following message read creates an empty thread and the Discussion renders
        // unavailable after a successful load. Other summary producers (list rows,
        // lifecycle results) deliberately do not create threads.
        if (!snapshot.threads[discussionId]) {
            updateThread(discussionId, { ...emptyThread(), summary: outcome.value.discussion });
        }
        await refreshMessages(discussionId, signal);
    };

    const loadOlderMessages = async (discussionId: string, signal?: AbortSignal): Promise<void> => {
        const retained = snapshot.threads[discussionId] ?? emptyThread();
        const operationEpoch = accessLossEpoch;
        const beforeSeq = retained.messages[0]?.seq;
        if (beforeSeq === undefined || !retained.hasMoreOlder) return;
        updateThread(discussionId, { ...retained, status: 'loading', errorCode: null });
        const outcome = await client.read(discussionId, { beforeSeq }, signal);
        if (operationEpoch !== accessLossEpoch) return;
        if (outcome.kind !== 'succeeded') {
            const code = outcome.kind === 'failed' ? outcome.errorCode : outcome.kind;
            if (isExplicitAccessLoss(code)) purgeAccessLost(code);
            else updateThread(discussionId, {
                ...(snapshot.threads[discussionId] ?? retained),
                status: statusForFailure(code),
                errorCode: code,
            });
            return;
        }
        const current = snapshot.threads[discussionId] ?? retained;
        const merged = mergeSessionDiscussionMessages(current.messages, outcome.value.messages);
        const incomplete = merged.some((row) => row.content === null);
        updateThread(discussionId, {
            ...current,
            messages: merged,
            hasMoreOlder: outcome.value.hasMoreOlder,
            messageSeq: Math.max(current.messageSeq, outcome.value.messageSeq),
            status: incomplete ? 'locked' : 'ready',
            errorCode: null,
            incomplete,
        });
    };

    const recordMutation = (intent: MutationIntent, status: SessionDiscussionMutationStatus, detail?: Readonly<{ artifactId?: string; errorCode?: string; recovery?: SessionDiscussionMutationRecovery }>) => {
        const localId = intent.kind === 'create' ? intent.creationLocalId : intent.localId;
        intents.set(localId, intent);
        updateMutation(localId, {
            kind: intent.kind, localId,
            ...(intent.kind === 'create' ? { messageLocalId: intent.messageLocalId } : { discussionId: intent.discussionId }),
            status,
            content: intent.content,
            ...(intent.mentionedAccountIds ? { mentionedAccountIds: intent.mentionedAccountIds } : {}),
            draftSubmission: intent.draftSubmission,
            ...detail,
        });
    };

    const completeCreate = (intent: CreateIntent, value: SessionDiscussionCreateResultV1) => {
        applySummary(value.discussion);
        const retained = snapshot.threads[value.discussion.id] ?? emptyThread();
        updateThread(value.discussion.id, {
            ...retained,
            summary: value.discussion,
            messages: mergeSessionDiscussionMessages(retained.messages, [value.firstMessage]),
            messageSeq: value.discussion.messageSeq,
            hasMoreOlder: retained.messages.length > 0 ? retained.hasMoreOlder : false,
            status: value.firstMessage.content === null ? 'locked' : 'ready',
            errorCode: null,
            incomplete: retained.incomplete || value.firstMessage.content === null,
        });
        markMutationObservedSuccess(intent.creationLocalId);
    };

    const completePost = (intent: PostIntent, value: SessionDiscussionPostResultV1) => {
        const retained = snapshot.threads[intent.discussionId] ?? emptyThread();
        updateThread(intent.discussionId, {
            ...retained,
            messages: mergeSessionDiscussionMessages(retained.messages, [value.message]),
            messageSeq: value.messageSeq,
            status: value.message.content === null ? 'locked' : 'ready',
            errorCode: null,
            incomplete: retained.incomplete || value.message.content === null,
        });
        markMutationObservedSuccess(intent.localId);
    };

    const findCreatedDiscussionInList = async (
        intent: CreateIntent,
        state: 'active' | 'archived',
        operationEpoch: number,
        signal?: AbortSignal,
    ): Promise<
        | { kind: 'found'; row: SessionDiscussionOpenedSummaryV1 }
        | { kind: 'absent' }
        | { kind: 'unavailable' }
    > => {
        let cursor: string | null = null;
        const visitedCursors = new Set<string>();
        for (;;) {
            const outcome = await client.list({ state, ...(cursor ? { cursor } : {}) }, signal);
            if (operationEpoch !== accessLossEpoch) return { kind: 'unavailable' };
            if (outcome.kind !== 'succeeded') {
                if (outcome.kind === 'failed' && isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
                return { kind: 'unavailable' };
            }
            const found = outcome.value.discussions.find((row) => row.creationLocalId === intent.creationLocalId);
            if (found) return { kind: 'found', row: found };
            const nextCursor = outcome.value.nextCursor;
            if (!nextCursor || visitedCursors.has(nextCursor)) return { kind: 'absent' };
            visitedCursors.add(nextCursor);
            cursor = nextCursor;
        }
    };

    const reconcileCreate = async (intent: CreateIntent, signal?: AbortSignal): Promise<boolean> => {
        const operationEpoch = accessLossEpoch;
        // A create can commit and then be archived — by this Account elsewhere
        // or by another collaborator — before the one-shot reconciler runs.
        // Observing only the active projection reports a committed discussion
        // as never created and leaves the attempt open for a duplicate resend,
        // so both existing list projections are observed before concluding
        // absence. Neither adds a route: this is the same paged list owner.
        let found: SessionDiscussionOpenedSummaryV1 | null = null;
        for (const state of ['active', 'archived'] as const) {
            const outcome = await findCreatedDiscussionInList(intent, state, operationEpoch, signal);
            if (outcome.kind === 'unavailable') return false;
            if (outcome.kind === 'found') {
                found = outcome.row;
                break;
            }
        }
        if (!found) return false;
        const messages = await client.read(found.id, { beforeSeq: 2 }, signal);
        if (operationEpoch !== accessLossEpoch) return false;
        if (messages.kind !== 'succeeded') {
            if (messages.kind === 'failed' && isExplicitAccessLoss(messages.errorCode)) purgeAccessLost(messages.errorCode);
            return false;
        }
        const firstMessage = messages.value.messages.find((row) => row.localId === intent.messageLocalId);
        if (!firstMessage) return false;
        completeCreate(intent, {
            v: 1,
            serverId: options.address.serverId,
            sessionId: options.address.sessionId,
            discussion: found,
            firstMessage,
        });
        return true;
    };

    const reconcilePost = async (intent: PostIntent, signal?: AbortSignal): Promise<boolean> => {
        const operationEpoch = accessLossEpoch;
        const retained = snapshot.threads[intent.discussionId] ?? emptyThread();
        const alreadyPublished = retained.messages.find((row) => row.localId === intent.localId);
        if (alreadyPublished) {
            completePost(intent, {
                v: 1,
                serverId: options.address.serverId,
                sessionId: options.address.sessionId,
                message: alreadyPublished,
                messageSeq: retained.messageSeq,
            });
            return true;
        }
        let afterSeq = retained.messages.at(-1)?.seq;
        for (;;) {
            const outcome = await client.read(
                intent.discussionId,
                afterSeq === undefined ? {} : { afterSeq },
                signal,
            );
            if (operationEpoch !== accessLossEpoch) return false;
            if (outcome.kind !== 'succeeded') {
                if (outcome.kind === 'failed' && isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
                return false;
            }
            const found = outcome.value.messages.find((row) => row.localId === intent.localId);
            if (found) {
                completePost(intent, {
                    v: 1,
                    serverId: options.address.serverId,
                    sessionId: options.address.sessionId,
                    message: found,
                    messageSeq: outcome.value.messageSeq,
                });
                return true;
            }
            const nextAfterSeq = outcome.value.messages.at(-1)?.seq;
            if (nextAfterSeq === undefined || nextAfterSeq <= (afterSeq ?? 0) || nextAfterSeq >= outcome.value.messageSeq) return false;
            afterSeq = nextAfterSeq;
        }
    };

    const reconcileIntent = async (intent: MutationIntent, signal?: AbortSignal): Promise<boolean> => (
        intent.kind === 'create'
            ? await reconcileCreate(intent, signal)
            : await reconcilePost(intent, signal)
    );

    const reconcileRecordedIntent = async (intent: MutationIntent, signal?: AbortSignal): Promise<boolean> => {
        const localId = intent.kind === 'create' ? intent.creationLocalId : intent.localId;
        let observed = false;
        try {
            observed = await reconcileIntent(intent, signal);
        } catch {
            observed = false;
        }
        if (observed) return true;

        const retained = snapshot.mutations[localId];
        if (retained?.status === 'checking' || retained?.status === 'outcome_unknown') {
            recordMutation(intent, 'outcome_unknown', { errorCode: 'outcome_unknown' });
        }
        return false;
    };

    const executeCreate = async (intent: CreateIntent, signal?: AbortSignal): Promise<SessionDiscussionRepositoryMutationOutcome<SessionDiscussionCreateResultV1>> => {
        const operationEpoch = accessLossEpoch;
        recordMutation(intent, 'sending');
        const outcome = await client.create(intent, signal);
        if (operationEpoch !== accessLossEpoch) return { kind: 'failed', errorCode: 'session_discussion_read_denied' };
        if (outcome.kind === 'succeeded') {
            completeCreate(intent, outcome.value);
            return outcome;
        }
        if (outcome.kind === 'approval_request_created') {
            recordMutation(intent, 'approval_pending', { artifactId: outcome.artifactId });
            return { kind: 'approval_request_created', artifactId: outcome.artifactId };
        }
        if (outcome.errorCode === 'outcome_unknown') {
            recordMutation(intent, 'checking');
            void reconcileRecordedIntent(intent, signal);
            return { kind: 'checking' };
        }
        if (isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
        else recordMutation(intent, 'failed', { errorCode: outcome.errorCode, recovery: recoveryForFailure(outcome.errorCode) });
        return outcome;
    };

    const executePost = async (intent: PostIntent, signal?: AbortSignal): Promise<SessionDiscussionRepositoryMutationOutcome<SessionDiscussionPostResultV1>> => {
        const operationEpoch = accessLossEpoch;
        recordMutation(intent, 'sending');
        const outcome = await client.post(intent, signal);
        if (operationEpoch !== accessLossEpoch) return { kind: 'failed', errorCode: 'session_discussion_read_denied' };
        if (outcome.kind === 'succeeded') {
            completePost(intent, outcome.value);
            return outcome;
        }
        if (outcome.kind === 'approval_request_created') {
            recordMutation(intent, 'approval_pending', { artifactId: outcome.artifactId });
            return { kind: 'approval_request_created', artifactId: outcome.artifactId };
        }
        if (outcome.errorCode === 'outcome_unknown') {
            recordMutation(intent, 'checking');
            void reconcileRecordedIntent(intent, signal);
            return { kind: 'checking' };
        }
        if (isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
        else recordMutation(intent, 'failed', { errorCode: outcome.errorCode, recovery: recoveryForFailure(outcome.errorCode) });
        return outcome;
    };

    const retry = async (localId: string, signal?: AbortSignal): Promise<SessionDiscussionRepositoryMutationOutcome<SessionDiscussionCreateResultV1 | SessionDiscussionPostResultV1>> => {
        const intent = intents.get(localId);
        if (!intent) return { kind: 'failed', errorCode: 'session_discussion_retry_not_found' };
        return intent.kind === 'create' ? executeCreate(intent, signal) : executePost(intent, signal);
    };

    const adoptPendingIntent = (intent: MutationIntent, signal?: AbortSignal): void => {
        const localId = intent.kind === 'create' ? intent.creationLocalId : intent.localId;
        if (intents.has(localId)) return;
        recordMutation(intent, 'checking');
        void reconcileRecordedIntent(intent, signal);
    };

    const applyLifecycleOutcome = (outcome: SessionDiscussionClientOutcome<SessionDiscussionDetailsResultV1>, operationEpoch: number) => {
        if (operationEpoch !== accessLossEpoch) return outcome;
        if (outcome.kind === 'succeeded') applySummary(outcome.value.discussion);
        else if (outcome.kind === 'failed' && isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
        return outcome;
    };

    const refreshLoaded = async (): Promise<void> => {
        const work: Promise<void>[] = [refreshList('active')];
        if (listPages.archived.length > 0) work.push(refreshList('archived'));
        for (const discussionId of Object.keys(snapshot.threads)) work.push(refreshDiscussion(discussionId));
        await Promise.all(work);
        await Promise.all([...intents.values()].map(async (intent) => {
            const localId = intent.kind === 'create' ? intent.creationLocalId : intent.localId;
            const status = snapshot.mutations[localId]?.status;
            if (status === 'checking' || status === 'outcome_unknown' || status === 'approval_pending') {
                await reconcileRecordedIntent(intent);
            }
        }));
    };

    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
        setClient(nextClient: SessionDiscussionRepositoryClient) { client = nextClient; },
        refreshList,
        loadMoreList,
        refreshDiscussion,
        refreshMessages,
        loadOlderMessages,
        create(input: Omit<CreateIntent, 'kind'>, signal?: AbortSignal) { return executeCreate({ kind: 'create', ...input }, signal); },
        post(input: Omit<PostIntent, 'kind'>, signal?: AbortSignal) { return executePost({ kind: 'post', ...input }, signal); },
        retry,
        adoptPendingIntent,
        acknowledgeObservedSuccess(localId: string) {
            if (snapshot.mutations[localId]?.status !== 'observed_success') return false;
            updateMutation(localId, null);
            intents.delete(localId);
            return true;
        },
        /**
         * Drops a settled failure together with its retry identity. The V2
         * draft owner still holds the text, so the next send is a fresh
         * attempt under a new local id rather than a repeat of the refused one.
         */
        dismissFailure(localId: string) {
            if (snapshot.mutations[localId]?.status !== 'failed') return false;
            updateMutation(localId, null);
            intents.delete(localId);
            return true;
        },
        async rename(discussionId: string, title: string, signal?: AbortSignal) {
            const operationEpoch = accessLossEpoch;
            return applyLifecycleOutcome(await client.rename(discussionId, title, signal), operationEpoch);
        },
        async archive(discussionId: string, signal?: AbortSignal) {
            const operationEpoch = accessLossEpoch;
            return applyLifecycleOutcome(await client.archive(discussionId, signal), operationEpoch);
        },
        async restore(discussionId: string, signal?: AbortSignal) {
            const operationEpoch = accessLossEpoch;
            return applyLifecycleOutcome(await client.restore(discussionId, signal), operationEpoch);
        },
        async setReadState(discussionId: string, lastReadSeq: number, signal?: AbortSignal): Promise<SessionDiscussionReadStateWriteOutcome> {
            const operationEpoch = accessLossEpoch;
            const outcome = await client.readState(discussionId, lastReadSeq, signal);
            if (operationEpoch !== accessLossEpoch) {
                return { kind: 'stopped', errorCode: 'session_discussion_read_denied' };
            }
            if (outcome.kind === 'succeeded') {
                return { kind: 'succeeded', lastReadSeq: outcome.value.cursor.lastReadSeq };
            }
            if (outcome.kind === 'approval_request_created') {
                return { kind: 'stopped', errorCode: 'approval_request_created' };
            }
            if (isExplicitAccessLoss(outcome.errorCode)) purgeAccessLost(outcome.errorCode);
            return isPermanentReadStateRefusal(outcome.errorCode)
                ? { kind: 'stopped', errorCode: outcome.errorCode }
                : { kind: 'retryable', errorCode: outcome.errorCode };
        },
        mount() {
            mountReferences += 1;
            if (!mountedWatch) {
                mountedWatch = watchMountedSessionDiscussions({ address: options.address, onInvalidated: () => { void refreshLoaded(); } });
            }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                mountReferences -= 1;
                if (mountReferences === 0) {
                    mountedWatch?.dispose();
                    mountedWatch = null;
                }
            };
        },
        isMounted: () => mountReferences > 0,
        clear() {
            accessLossEpoch += 1;
            mountedWatch?.dispose();
            mountedWatch = null;
            mountReferences = 0;
            listPages.active = [];
            listPages.archived = [];
            intents.clear();
            publish({ address: options.address, lists: { active: EMPTY_LIST, archived: EMPTY_LIST }, archivedExistence: 'unknown', threads: {}, mutations: {} });
        },
    };
}

export type SessionDiscussionRepository = ReturnType<typeof createSessionDiscussionRepository>;
