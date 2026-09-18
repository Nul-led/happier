import * as React from 'react';
import { Platform, Pressable, View, type ViewToken } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import {
    SESSION_DISCUSSION_RECENT_AUTHOR_AVATAR_STACK_V1,
    type SessionDiscussionMessageContentV1,
    type SessionDiscussionOpenedMessageV1,
    type SessionDiscussionOpenedSummaryV1,
} from '@happier-dev/protocol';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import type { SessionDiscussionDetailsTarget } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { requestRegisteredSessionComposerFocus } from '@/components/sessions/presentation/sessionComposerPresentationTargets';
import { createDiscussionSelectionInteractiveExecutionRunDraftDetailsTab } from '@/components/sessions/runs/launcher/executionRunLauncherModel';
import { SessionDraftConflictResolution } from '@/components/sessions/drafts/SessionDraftConflictResolution';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import { publishInteractiveExecutionRunDraftNavigationIntent } from '@/components/sessions/runs/launcher/interactiveExecutionRunDraftNavigationIntent';
import { SelectMessageButton } from '@/components/sessions/transcript/messageSelection/SelectMessageButton';
import { TranscriptMessageSelectionBoundary } from '@/components/sessions/transcript/messageSelection/TranscriptMessageSelectionContext';
import { TranscriptSelectionToolbar, type TranscriptSelectionToolbarMessage } from '@/components/sessions/transcript/messageSelection/TranscriptSelectionToolbar';
import { createWebDomScrollObservation } from '@/components/sessions/transcript/viewport/driver/webDomObservation';
import { TranscriptListShell } from '@/components/sessions/transcript/viewport/shell/TranscriptListShell';
import { resolveReadOnlyTranscriptListShellFrame } from '@/components/sessions/transcript/viewport/shell/transcriptListShellCapabilities';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSessionExecutionRunLaunchability } from '@/hooks/session/useSessionExecutionRunLaunchability';
import { useSessionAgentActivityRoster } from '@/hooks/session/useSessionAgentActivity';
import { useSessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { randomUUID } from '@/platform/randomUUID';
import { createSessionDiscussionClient } from '@/sync/api/session/sessionDiscussionActions';
import {
    useServerCredentialAccountScopeBindings,
    type ServerCredentialAccountScopeBinding,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { isSessionSurfaceVisible, useSessionSurfaceVisibilitySnapshot } from '@/sync/domains/session/sessionSurfaceVisibility';
import { createSessionDiscussionVisibleReadController } from '@/sync/domains/session/discussions/sessionDiscussionVisibleReadController';
import { useSessionHumanPresence } from '@/sync/domains/session/humanPresence/useSessionHumanPresence';
import { registerSessionDiscussionHumanPresence } from '@/sync/domains/session/humanPresence/sessionHumanPresenceRuntime';
import { useSetting } from '@/sync/domains/state/storage';
import { writeSessionInitialPromptV1 } from '@/sync/domains/sessionInitialPrompt/sessionInitialPromptV1';
import type { SessionDiscussionRepository, SessionDiscussionRepositoryMutation } from '@/sync/ops/sessionDiscussions/sessionDiscussionRepository';
import { getSessionDiscussionRepository } from '@/sync/ops/sessionDiscussions/sessionDiscussionRepositoryRegistry';
import { useSessionDiscussionRepositorySnapshot } from '@/sync/ops/sessionDiscussions/useSessionDiscussionRepositorySnapshot';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import { useDeviceType } from '@/utils/platform/responsive';
import { useHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';
import { formatShortRelativeTime } from '@/utils/time/formatShortRelativeTime';
import { SessionDiscussionAgentActivityReference } from './SessionDiscussionAgentActivityReference';
import { useOpenSessionAgentConversation } from './useOpenSessionAgentConversation';
import { buildSessionDiscussionTimelineItems, type SessionDiscussionTimelineItem } from './sessionDiscussionTimelineProjection';
import { prepareDiscussionSelectionHandoff } from './prepareDiscussionSelectionHandoff';
import { sendDiscussionSelectionToSession } from './sendDiscussionSelectionToSession';
import { SessionDiscussionComposer } from './SessionDiscussionComposer';
import { buildSessionDiscussionContent, resolveSessionDiscussionCreationTitle } from './discussionComposerDocument';
import { useSessionDiscussionDraft } from './useSessionDiscussionDraft';

const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.colors.surface.base },
    body: { flex: 1, paddingHorizontal: 16, paddingTop: 18, gap: 14 },
    input: { minHeight: 46, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: theme.colors.surface.inset, color: theme.colors.text.primary, fontSize: 16, fontWeight: '600' },
    toolbar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    titleBlock: { flex: 1, minWidth: 0, gap: 2 },
    title: { minWidth: 0, fontSize: 16, fontWeight: '700' },
    headerMeta: { color: theme.colors.text.secondary, fontSize: 11 },
    recentAuthors: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8 },
    recentAuthorAvatar: { borderRadius: 20, borderWidth: 2, borderColor: theme.colors.surface.base },
    overflowAction: { minHeight: minimumInteractiveTargetSize, minWidth: minimumInteractiveTargetSize, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    action: { minHeight: minimumInteractiveTargetSize, justifyContent: 'center', paddingHorizontal: 8 },
    actionText: { color: theme.colors.accent.blue, fontWeight: '600' },
    messages: { flex: 1, minHeight: 0 },
    message: { marginHorizontal: 14, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: theme.colors.surface.inset, gap: 4, flexDirection: 'row', alignItems: 'flex-start' },
    messageGroupContinuation: { marginTop: -3, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
    messageBody: { flex: 1, minWidth: 0, gap: 4 },
    messageAttribution: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    selectionToolbar: { paddingHorizontal: 14, paddingVertical: 8 },
    selectionHandoffError: { paddingHorizontal: 14, paddingBottom: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    selectionHandoffErrorText: { flexGrow: 1, flexShrink: 1, minWidth: 0, color: theme.colors.text.destructive },
    agentMessage: { borderLeftWidth: 3, borderLeftColor: theme.colors.accent.blue },
    meta: { color: theme.colors.text.secondary, fontSize: 11 },
    timestamp: { color: theme.colors.text.secondary, fontSize: 11, alignSelf: 'flex-start' },
    deliveryStatus: { color: theme.colors.text.secondary, fontSize: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    status: { color: theme.colors.text.secondary, textAlign: 'center' },
    error: { color: theme.colors.text.destructive, textAlign: 'center' },
    retry: { minHeight: minimumInteractiveTargetSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    retryText: { color: theme.colors.accent.blue, fontWeight: '600' },
    banner: { paddingHorizontal: 14, paddingVertical: 10, color: theme.colors.text.secondary },
    fieldHint: { color: theme.colors.text.destructive },
}));
const VIEWABILITY = Object.freeze({ itemVisiblePercentThreshold: 1 });

/**
 * One presenter for the typed refusal vocabulary the repository already
 * classifies: the reason a person can act on, not a generic "Failed".
 */
function discussionFailureLabel(errorCode: string | undefined): string {
    switch (errorCode) {
        case 'offline': return t('session.collaboration.discussion.offline');
        case 'locked': return t('session.access.preparing');
        case 'session_discussion_post_denied': return t('session.collaboration.discussion.postDenied');
        case 'session_discussion_invalid_mention': return t('session.collaboration.discussion.invalidMention');
        case 'session_discussion_invalid_content': return t('session.collaboration.discussion.invalidContent');
        case 'session_discussion_archived': return t('session.collaboration.discussion.archivedNotice');
        case 'session_discussion_session_archived': return t('session.collaboration.discussion.sessionArchived');
        case 'session_discussion_encryption_mode_mismatch': return t('session.collaboration.discussion.locked');
        case 'session_discussion_idempotency_conflict': return t('session.collaboration.discussion.idempotencyConflict');
        case 'session_discussions_unavailable': return t('session.collaboration.discussion.unavailable');
        default: return t('session.collaboration.discussion.sendFailed');
    }
}

function mutationStatusLabel(mutation: Pick<SessionDiscussionRepositoryMutation, 'status' | 'errorCode'>): string | null {
    if (mutation.status === 'observed_success') return null;
    if (mutation.status === 'outcome_unknown') return t('session.collaboration.discussion.deliveryUnknown');
    if (mutation.status === 'failed') return discussionFailureLabel(mutation.errorCode);
    if (mutation.status === 'approval_pending') return t('approvals.status.open');
    if (mutation.status === 'sending') return t('session.planOutput.sending');
    return t('session.collaboration.discussion.checking');
}

/** A dismissable refusal keeps its reason visible but no longer holds the composer. */
function mutationBlocksComposer(mutation: SessionDiscussionRepositoryMutation | null): boolean {
    return mutation !== null && !(mutation.status === 'failed' && mutation.recovery === 'dismiss');
}

function textOf(
    content: SessionDiscussionMessageContentV1 | null,
    resolveAccountLabel: (accountId: string) => string | null = () => null,
): string {
    if (!content) return t('session.collaboration.discussion.contentUnavailable');
    return content.parts.map((part) => part.t === 'text'
        ? part.text
        : `@${resolveAccountLabel(part.accountId) ?? t('session.collaboration.discussion.collaborator')}`
    ).join('');
}

function discussionMessageActorLabel(message: SessionDiscussionOpenedMessageV1): string {
    const actor = message.accountActor;
    if (actor === null || actor.accountId !== message.authorAccountId) {
        return t('session.collaboration.discussion.collaborator');
    }
    if (actor.profile === null) return t('message.accountActorFormerMember');
    return formatAccountDisplayName(actor.profile) ?? t('message.accountActorUnnamedMember');
}

function discussionMessageProducerClass(message: SessionDiscussionOpenedMessageV1): string {
    return message.producerV1 === null ? 'human' : `producer:${message.producerV1.kind}`;
}

function startsDiscussionMessageGroup(
    message: SessionDiscussionOpenedMessageV1,
    previous: SessionDiscussionOpenedMessageV1 | undefined,
): boolean {
    return !previous
        || message.authorAccountId === null
        || previous.authorAccountId === null
        || previous.authorAccountId !== message.authorAccountId
        || discussionMessageProducerClass(previous) !== discussionMessageProducerClass(message);
}

function RecentDiscussionAuthors(props: Readonly<{ messages: readonly SessionDiscussionOpenedMessageV1[] }>): React.ReactElement | null {
    const authors = React.useMemo(() => {
        const seen = new Set<string>();
        const result: Array<Readonly<{
            accountId: string;
            avatarUrl: string | null;
            label: string;
        }>> = [];
        for (
            let index = props.messages.length - 1;
            index >= 0 && result.length < SESSION_DISCUSSION_RECENT_AUTHOR_AVATAR_STACK_V1;
            index -= 1
        ) {
            const message = props.messages[index];
            const actor = message?.accountActor;
            if (!message || actor === null || actor.accountId !== message.authorAccountId || seen.has(actor.accountId)) continue;
            seen.add(actor.accountId);
            result.push({
                accountId: actor.accountId,
                avatarUrl: actor.profile?.avatarUrl ?? null,
                label: discussionMessageActorLabel(message),
            });
        }
        return result;
    }, [props.messages]);
    if (authors.length === 0) return null;
    return <View
        testID="session-discussion-recent-authors"
        accessible
        accessibilityLabel={authors.map((author) => author.label).join(', ')}
        style={styles.recentAuthors}
    >
        {authors.map((author, index) => <View
            key={author.accountId}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.recentAuthorAvatar, { marginLeft: index === 0 ? 0 : -8 }]}
        >
            <Avatar id={author.accountId} imageUrl={author.avatarUrl} size={24} />
        </View>)}
    </View>;
}

function useRepository(
    scope: ServerAccountScope,
    address: SessionAddress,
    accountLifetime: ServerCredentialAccountScopeBinding,
): readonly [SessionDiscussionRepository, ReturnType<SessionDiscussionRepository['getSnapshot']>] {
    const client = React.useMemo(() => createSessionDiscussionClient({ session: address, availability: 'full_collaboration' }), [address]);
    const repository = React.useMemo(() => getSessionDiscussionRepository({
        scope,
        address,
        client,
        accountLifetime,
    }), [accountLifetime, address, client, scope]);
    const snapshot = useSessionDiscussionRepositorySnapshot(repository);
    React.useEffect(() => repository.mount(), [repository]);
    return [repository, snapshot];
}

export function SessionDiscussionDetailsView(props: Readonly<{ target: SessionDiscussionDetailsTarget; active: boolean; onCreated?: (discussion: SessionDiscussionOpenedSummaryV1) => void }>): React.ReactElement {
    const requestedServerIds = React.useMemo(() => [props.target.address.serverId], [props.target.address.serverId]);
    const bindings = useServerCredentialAccountScopeBindings(requestedServerIds);
    const binding = React.useMemo(() => [...bindings.values()][0] ?? null, [bindings]);
    const availability = useSessionCollaborationAvailability(props.target.address.serverId);
    const enabled = useFeatureEnabled('sessions.conversations', { scopeKind: 'spawn', serverId: props.target.address.serverId });
    if (!enabled || availability !== 'full_collaboration' || !binding) return <View style={styles.center}><Text style={styles.status}>{t('session.collaboration.discussion.unavailable')}</Text></View>;
    return props.target.kind === 'new'
        ? <NewDiscussion target={props.target} scope={binding.scope} accountLifetime={binding} onCreated={props.onCreated} />
        : <Discussion target={props.target} scope={binding.scope} accountLifetime={binding} active={props.active} />;
}

function NewDiscussion(props: Readonly<{ target: Extract<SessionDiscussionDetailsTarget, { kind: 'new' }>; scope: ServerAccountScope; accountLifetime: ServerCredentialAccountScopeBinding; onCreated?: (discussion: SessionDiscussionOpenedSummaryV1) => void }>) {
    const draftAddress = React.useMemo(() => ({ kind: 'newDiscussion' as const, sessionId: props.target.address.sessionId }), [props.target.address.sessionId]);
    const draft = useSessionDiscussionDraft({ scope: props.scope, address: draftAddress });
    const [repository, snapshot] = useRepository(props.scope, props.target.address, props.accountLifetime);
    const restoredAttempt = draft.pendingMutationAttempt?.kind === 'create' ? draft.pendingMutationAttempt : null;
    const ids = React.useRef({
        creationLocalId: restoredAttempt?.creationLocalId ?? randomUUID(),
        messageLocalId: restoredAttempt?.messageLocalId ?? randomUUID(),
    });
    const capture = React.useRef<ReturnType<typeof draft.captureSubmittedCurrentness> | null>(null);
    const completed = React.useRef(false);
    const [titleRequired, setTitleRequired] = React.useState(false);
    const recoveredMutation = Object.values(snapshot.mutations).find((item) => item.kind === 'create') ?? null;
    const activeCreationLocalId = recoveredMutation?.localId ?? ids.current.creationLocalId;
    const mutation = snapshot.mutations[activeCreationLocalId] ?? null;
    const composerBlocked = mutationBlocksComposer(mutation);
    const accessRevoked = snapshot.lists.active.status === 'revoked' || snapshot.lists.archived.status === 'revoked';
    const draftUnavailable = draft.status === 'offline' || draft.status === 'error' || draft.status === 'conflict';
    const repositoryUnavailable = snapshot.lists.active.status === 'offline'
        || snapshot.lists.active.status === 'locked'
        || snapshot.lists.active.status === 'error';
    const createDisabled = composerBlocked || draftUnavailable || repositoryUnavailable;
    const createUnavailableLabel = draft.status === 'offline' || snapshot.lists.active.status === 'offline'
        ? t('session.collaboration.discussion.offline')
        : snapshot.lists.active.status === 'locked'
            ? t('session.access.preparing')
            : draft.status === 'error' || snapshot.lists.active.status === 'error'
                ? t('session.collaboration.discussion.loadError')
                : null;
    React.useEffect(() => {
        if (accessRevoked) void draft.purgePresentation();
    }, [accessRevoked, draft]);
    const finish = React.useCallback(async (discussion: SessionDiscussionOpenedSummaryV1) => {
        if (completed.current) return;
        completed.current = true;
        const submitted = repository.getSnapshot().mutations[activeCreationLocalId]?.draftSubmission ?? capture.current;
        try {
            if (submitted) await draft.clearAfterObservedSuccess(submitted);
        } catch {
            completed.current = false;
            return;
        }
        repository.acknowledgeObservedSuccess(activeCreationLocalId);
        props.onCreated?.(discussion);
    }, [activeCreationLocalId, draft, props, repository]);
    React.useEffect(() => {
        const found = [...snapshot.lists.active.items, ...snapshot.lists.archived.items].find((item) => item.creationLocalId === activeCreationLocalId);
        if (found) void finish(found);
    }, [activeCreationLocalId, finish, snapshot.lists.active.items, snapshot.lists.archived.items]);
    React.useEffect(() => {
        if (!restoredAttempt || snapshot.mutations[restoredAttempt.creationLocalId]) return;
        const title = resolveSessionDiscussionCreationTitle({ title: draft.title, text: draft.text, mentions: draft.mentions });
        if (!title) return;
        repository.adoptPendingIntent({
            kind: 'create',
            creationLocalId: restoredAttempt.creationLocalId,
            messageLocalId: restoredAttempt.messageLocalId,
            title,
            content: buildSessionDiscussionContent(draft.text, draft.mentions),
            mentionedAccountIds: [...new Set(draft.mentions.map((item) => item.accountId))],
            draftSubmission: { scope: props.scope, address: draftAddress, currentness: restoredAttempt.currentness },
        });
    }, [draft.mentions, draft.text, draft.title, draftAddress, props.scope, repository, restoredAttempt, snapshot.mutations]);
    const dismissRefusal = React.useCallback(() => {
        if (mutation?.status !== 'failed') return;
        draft.releaseSubmittedAttempt();
        repository.dismissFailure(mutation.localId);
        // A refused identity is never reused: the retained draft goes out as a fresh attempt.
        ids.current = { creationLocalId: randomUUID(), messageLocalId: randomUUID() };
    }, [draft, mutation, repository]);
    const submit = React.useCallback(async (content: SessionDiscussionMessageContentV1) => {
        if (!draft.text.trim() || composerBlocked) return;
        const title = resolveSessionDiscussionCreationTitle({
            title: draft.title,
            text: draft.text,
            mentions: draft.mentions,
        });
        if (!title) {
            setTitleRequired(true);
            return;
        }
        setTitleRequired(false);
        if (mutation) dismissRefusal();
        const draftSubmission = draft.captureSubmittedCurrentness({ kind: 'create', ...ids.current });
        capture.current = draftSubmission;
        await repository.create({ ...ids.current, title, content, mentionedAccountIds: [...new Set(draft.mentions.map((item) => item.accountId))], draftSubmission });
    }, [composerBlocked, dismissRefusal, draft, mutation, repository]);
    if (accessRevoked) return <View style={styles.center} testID="session-discussion-details-empty-state"><Text style={styles.error}>{t('session.access.removedTitle')}</Text></View>;
    return <View style={styles.root} testID="session-discussion-new-details"><View style={styles.body}><TextInput testID="session-discussion-title" style={styles.input} value={draft.title} onChangeText={(title) => { draft.setTitle(title); if (title.trim()) setTitleRequired(false); }} placeholder={t('session.collaboration.discussion.titlePlaceholder')} accessibilityLabel={t('session.collaboration.discussion.titlePlaceholder')} aria-invalid={titleRequired} autoFocus />{titleRequired ? <Text testID="session-discussion-title-required" accessibilityLiveRegion="polite" style={styles.fieldHint}>{t('session.collaboration.discussion.titleRequired')}</Text> : null}{mutation?.content ? <View style={styles.message}><View style={styles.messageBody}><Text testID={`session-discussion-message-content-${mutation.messageLocalId}`}>{textOf(mutation.content)}</Text>{mutationStatusLabel(mutation) ? <Text testID={`session-discussion-message-status-${mutation.messageLocalId}`} accessibilityLiveRegion="polite" style={mutation.status === 'failed' ? styles.error : styles.deliveryStatus}>{mutationStatusLabel(mutation)}</Text> : null}<MutationRecovery mutation={mutation} onRetry={() => void repository.retry(activeCreationLocalId)} onDismiss={dismissRefusal} /></View></View> : null}</View>{draft.conflict ? <SessionDraftConflictResolution scope={props.scope} address={draftAddress} conflict={draft.conflict} /> : null}{createUnavailableLabel ? <Text style={styles.banner}>{createUnavailableLabel}</Text> : null}<SessionDiscussionComposer scope={props.scope} address={props.target.address} availability="full_collaboration" value={{ text: draft.text, mentions: draft.mentions }} onChange={draft.setComposer} disabled={createDisabled} onSend={(content) => void submit(content)} /></View>;
}

function Discussion(props: Readonly<{ target: Extract<SessionDiscussionDetailsTarget, { kind: 'discussion' }>; scope: ServerAccountScope; accountLifetime: ServerCredentialAccountScopeBinding; active: boolean }>) {
    const router = useRouter();
    const device = useDeviceType();
    const session = useSessionViewShellSession(props.target.address.sessionId, props.target.address.serverId);
    const { canLaunchExecutionRuns } = useSessionExecutionRunLaunchability(props.target.address.sessionId, session, props.target.address.serverId);
    const pane = useAppPaneScope(createSessionPaneScopeId(props.target.address.sessionId, props.target.address.serverId));
    const activity = useSessionAgentActivityRoster({
        sessionId: props.target.address.sessionId,
        serverId: props.target.address.serverId,
    });
    const presenceTarget = React.useMemo(() => ({
        serverId: props.target.address.serverId,
        sessionId: props.target.address.sessionId,
        discussionId: props.target.discussionId,
    }), [props.target.address.serverId, props.target.address.sessionId, props.target.discussionId]);
    const presence = useSessionHumanPresence(presenceTarget);
    const presenceLabel = React.useMemo(() => presence.viewers.map((viewer) => {
        const name = formatAccountDisplayName(viewer.account) ?? t('session.collaboration.unnamed');
        return viewer.typing ? `${name} ${t('session.collaboration.typing')}` : name;
    }).join(', '), [presence.viewers]);
    const transcriptBulkCopyFormat = useSetting('transcriptBulkCopyFormat');
    const sendTemplate = useSetting('transcriptMessageSendToSessionTemplate');
    const draftAddress = React.useMemo(() => ({ kind: 'discussion' as const, sessionId: props.target.address.sessionId, discussionId: props.target.discussionId }), [props.target.address.sessionId, props.target.discussionId]);
    const draft = useSessionDiscussionDraft({ scope: props.scope, address: draftAddress });
    const agentConversation = useOpenSessionAgentConversation({ address: props.target.address });
    const [repository, snapshot] = useRepository(props.scope, props.target.address, props.accountLifetime);
    const thread = snapshot.threads[props.target.discussionId];
    const discussion = thread?.summary ?? null;
    const messages = thread?.messages ?? [];
    const historicalActorLabels = React.useMemo(() => new Map(messages.flatMap((message) => {
        const actor = message.accountActor;
        if (actor === null || actor.accountId !== message.authorAccountId) return [];
        return [[actor.accountId, discussionMessageActorLabel(message)] as const];
    })), [messages]);
    const resolveAccountLabel = React.useCallback((accountId: string): string | null => {
        const historicalLabel = historicalActorLabels.get(accountId);
        if (historicalLabel) return historicalLabel;
        const viewer = presence.viewers.find((item) => item.account.accountId === accountId);
        return viewer ? formatAccountDisplayName(viewer.account) ?? t('session.collaboration.unnamed') : null;
    }, [historicalActorLabels, presence.viewers]);
    const selectableMessages = React.useMemo<readonly TranscriptSelectionToolbarMessage[]>(() => messages
        .filter((message) => message.producerV1 === null && message.authorAccountId !== null && message.content !== null)
        .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
        .map((message) => ({ id: message.id, role: 'user' as const, text: textOf(message.content, resolveAccountLabel) })), [messages, resolveAccountLabel]);
    const prepareSelection = React.useCallback((selected: ReadonlyArray<TranscriptSelectionToolbarMessage>) => prepareDiscussionSelectionHandoff({
        sessionId: props.target.address.sessionId,
        discussionId: props.target.discussionId,
        selectedMessageIds: selected.map((message) => message.id),
        messages,
        resolveAccountLabel,
        format: transcriptBulkCopyFormat,
        roleLabels: { user: t('session.collaboration.discussion.collaborator'), assistant: t('voiceActivity.format.assistant') },
    }), [messages, props.target.address.sessionId, props.target.discussionId, resolveAccountLabel, transcriptBulkCopyFormat]);
    const [localId, setLocalId] = React.useState<string | null>(null);
    const clearingLocalId = React.useRef<string | null>(null);
    const recoveredPostMutation = Object.values(snapshot.mutations).find((item) => item.kind === 'post' && item.discussionId === props.target.discussionId) ?? null;
    const restoredPostAttempt = draft.pendingMutationAttempt?.kind === 'post'
        && draft.pendingMutationAttempt.discussionId === props.target.discussionId
        ? draft.pendingMutationAttempt
        : null;
    const activePostLocalId = recoveredPostMutation?.localId ?? localId;
    const mutation = activePostLocalId ? snapshot.mutations[activePostLocalId] ?? null : null;
    const composerBlocked = mutationBlocksComposer(mutation);
    const accessRevoked = snapshot.lists.active.status === 'revoked'
        || snapshot.lists.archived.status === 'revoked'
        || thread?.status === 'revoked';
    React.useEffect(() => props.active && !accessRevoked
        ? registerSessionDiscussionHumanPresence(presenceTarget)
        : undefined, [accessRevoked, presenceTarget, props.active]);
    const draftUnavailable = draft.status === 'offline' || draft.status === 'error' || draft.status === 'conflict';
    const threadUnavailable = thread?.status === 'offline' || thread?.status === 'locked' || thread?.status === 'error';
    const mutationsDisabled = draftUnavailable || threadUnavailable;
    const detailsNotice = thread?.status === 'offline' || draft.status === 'offline'
        ? t('session.collaboration.discussion.offline')
        : thread?.status === 'locked'
            ? t('session.access.preparing')
            : thread?.status === 'error' || draft.status === 'error'
                ? t('session.collaboration.discussion.loadError')
                : null;
    React.useEffect(() => {
        if (accessRevoked) void draft.purgePresentation();
    }, [accessRevoked, draft]);
    const [rename, setRename] = React.useState<string | null>(null);
    const [lifecycleError, setLifecycleError] = React.useState(false);
    const [lifecycleMenuOpen, setLifecycleMenuOpen] = React.useState(false);
    React.useEffect(() => { void repository.refreshDiscussion(props.target.discussionId); }, [props.target.discussionId, repository]);
    React.useEffect(() => {
        if (!restoredPostAttempt || snapshot.mutations[restoredPostAttempt.localId]) return;
        repository.adoptPendingIntent({
            kind: 'post',
            discussionId: props.target.discussionId,
            localId: restoredPostAttempt.localId,
            content: buildSessionDiscussionContent(draft.text, draft.mentions),
            mentionedAccountIds: [...new Set(draft.mentions.map((item) => item.accountId))],
            draftSubmission: { scope: props.scope, address: draftAddress, currentness: restoredPostAttempt.currentness },
        });
        setLocalId(restoredPostAttempt.localId);
    }, [draft.mentions, draft.text, draftAddress, props.scope, props.target.discussionId, repository, restoredPostAttempt, snapshot.mutations]);
    React.useEffect(() => {
        if (!activePostLocalId || mutation?.status !== 'observed_success' || !messages.some((item) => item.localId === activePostLocalId) || clearingLocalId.current === activePostLocalId) return;
        clearingLocalId.current = activePostLocalId;
        void (async () => {
            try {
                await draft.clearAfterObservedSuccess(mutation.draftSubmission);
                repository.acknowledgeObservedSuccess(activePostLocalId);
                setLocalId(null);
            } catch {
                // Keep the observed-success mutation so a remount can retry the
                // same V2 draft-currentness contraction without resending.
            } finally {
                if (clearingLocalId.current === activePostLocalId) clearingLocalId.current = null;
            }
        })();
    }, [activePostLocalId, draft, messages, mutation, repository]);
    const dismissRefusal = React.useCallback(() => {
        if (mutation?.status !== 'failed') return;
        draft.releaseSubmittedAttempt();
        repository.dismissFailure(mutation.localId);
        setLocalId(null);
    }, [draft, mutation, repository]);
    const send = React.useCallback(async (content: SessionDiscussionMessageContentV1) => {
        if (!discussion?.capabilities.postMessages || !draft.text.trim() || composerBlocked) return;
        if (mutation) dismissRefusal();
        const id = randomUUID();
        const draftSubmission = draft.captureSubmittedCurrentness({ kind: 'post', discussionId: props.target.discussionId, localId: id });
        setLocalId(id);
        await repository.post({ discussionId: props.target.discussionId, localId: id, content, mentionedAccountIds: [...new Set(draft.mentions.map((item) => item.accountId))], draftSubmission });
    }, [composerBlocked, discussion?.capabilities.postMessages, dismissRefusal, draft, mutation, props.target.discussionId, repository]);
    const lifecycle = React.useCallback(async (kind: 'rename' | 'archive' | 'restore') => {
        if (!discussion) return; setLifecycleError(false);
        const result = kind === 'rename' ? await repository.rename(discussion.id, rename?.trim() ?? '') : kind === 'archive' ? await repository.archive(discussion.id) : await repository.restore(discussion.id);
        if (result.kind === 'succeeded') setRename(null); else setLifecycleError(true);
    }, [discussion, rename, repository]);
    const lifecycleActions = React.useMemo<readonly DropdownMenuItem[]>(() => discussion ? [
        ...(discussion.capabilities.rename ? [{ id: 'rename', title: t('session.collaboration.discussion.rename'), disabled: mutationsDisabled }] : []),
        ...(discussion.capabilities.archive ? [{ id: 'archive', title: t('session.collaboration.discussion.archive'), disabled: mutationsDisabled }] : []),
        ...(discussion.capabilities.restore ? [{ id: 'restore', title: t('session.collaboration.discussion.restore'), disabled: mutationsDisabled }] : []),
    ] : [], [discussion, mutationsDisabled]);
    const displayMessages = React.useMemo<readonly SessionDiscussionOpenedMessageV1[]>(() => {
        if (!mutation?.content || mutation.status === 'observed_success' || messages.some((message) => message.localId === mutation.localId)) return messages;
        return [...messages, {
            id: mutation.localId,
            discussionId: props.target.discussionId,
            localId: mutation.localId,
            seq: (messages.at(-1)?.seq ?? thread?.messageSeq ?? 0) + 1,
            authorAccountId: props.scope.accountId,
            accountActor: null,
            producerV1: null,
            content: mutation.content,
            mentionedAccountIds: [...(mutation.mentionedAccountIds ?? [])],
            createdAt: 0,
        }];
    }, [messages, mutation, props.scope.accountId, props.target.discussionId, thread?.messageSeq]);
    const items = React.useMemo(() => buildSessionDiscussionTimelineItems({ sessionId: props.target.address.sessionId, discussionId: props.target.discussionId, messages: displayMessages, subagents: activity.subagents, readExecutionRunEntry: activity.readExecutionRunEntry }), [activity.readExecutionRunEntry, activity.subagents, displayMessages, props.target.address.sessionId, props.target.discussionId]);
    const messageGroupStarts = React.useMemo(() => new Set(items.flatMap((item, index) => {
        if (item.kind !== 'human_message') return [];
        const previous = items[index - 1];
        return previous?.kind !== 'human_message' || startsDiscussionMessageGroup(item.message, previous.message)
            ? [item.message.id]
            : [];
    })), [items]);
    const openRun = React.useCallback((item: Extract<SessionDiscussionTimelineItem, { kind: 'agent_activity_reference' }>) => {
        const runId = item.entry.runId ?? item.subagent.runRef?.runId;
        if (runId) agentConversation.openAgentConversation(runId);
    }, [agentConversation]);
    const askAgentAboutSelection = React.useCallback((selected: ReadonlyArray<TranscriptSelectionToolbarMessage>) => {
        const prepared = prepareSelection(selected);
        if (!prepared) return;
        const source = { ...prepared.source, draftCorrelationId: randomUUID() };
        if (device === 'phone') {
            const navigationIntent = publishInteractiveExecutionRunDraftNavigationIntent({
                address: props.target.address,
                source,
                initialText: prepared.text,
            });
            router.push(navigationIntent.href as Href);
            return;
        }
        pane.openDetailsTab(createDiscussionSelectionInteractiveExecutionRunDraftDetailsTab({
            source,
            initialText: prepared.text,
        }), { intent: 'preview' });
    }, [device, pane, prepareSelection, props.target.address, router]);
    type PreparedSelectionHandoff = NonNullable<ReturnType<typeof prepareSelection>>;
    const [selectionHandoffRetry, setSelectionHandoffRetry] = React.useState<PreparedSelectionHandoff | null>(null);
    const [selectionHandoffRetrying, setSelectionHandoffRetrying] = React.useState(false);
    const selectionHandoffInFlight = React.useRef<Promise<void> | null>(null);
    const performSelectionHandoff = React.useCallback(async (prepared: PreparedSelectionHandoff) => {
        if (selectionHandoffInFlight.current) {
            await selectionHandoffInFlight.current;
            return;
        }
        const operation = sendDiscussionSelectionToSession({
            sessionId: props.target.address.sessionId,
            serverId: props.target.address.serverId,
            selectedText: prepared.text,
            source: prepared.source,
            template: sendTemplate,
            sourceSessionName: null,
            nowMs: Date.now,
            writeInitialPrompt: async ({ destinationSessionId, serverId, prompt }) => {
                await sync.patchSessionMetadataWithRetry(destinationSessionId, (metadata) => writeSessionInitialPromptV1({
                    metadata,
                    text: prompt.text,
                    mode: prompt.mode,
                    createdAtMs: prompt.createdAtMs,
                    source: prompt.source,
                }), { serverId });
            },
            revealPrimaryComposer: device === 'phone'
                ? () => router.replace(buildScopedSessionRouteHref(props.target.address) as Href)
                : pane.closeDetails,
            focusPrimaryComposer: () => requestRegisteredSessionComposerFocus(props.target.address),
        }).then(() => undefined);
        selectionHandoffInFlight.current = operation;
        try {
            await operation;
        } finally {
            if (selectionHandoffInFlight.current === operation) {
                selectionHandoffInFlight.current = null;
            }
        }
    }, [device, pane.closeDetails, props.target.address, router, sendTemplate]);
    const sendSelectionToComposer = React.useCallback(async (selected: ReadonlyArray<TranscriptSelectionToolbarMessage>) => {
        const prepared = prepareSelection(selected);
        if (!prepared) return;
        try {
            await performSelectionHandoff(prepared);
            setSelectionHandoffRetry(null);
        } catch {
            setSelectionHandoffRetry(prepared);
        }
    }, [performSelectionHandoff, prepareSelection]);
    const retrySelectionHandoff = React.useCallback(async () => {
        if (!selectionHandoffRetry || selectionHandoffRetrying) return;
        setSelectionHandoffRetrying(true);
        try {
            await performSelectionHandoff(selectionHandoffRetry);
            setSelectionHandoffRetry(null);
        } catch {
            // The immutable prepared selection stays available for another explicit retry.
        } finally {
            setSelectionHandoffRetrying(false);
        }
    }, [performSelectionHandoff, selectionHandoffRetry, selectionHandoffRetrying]);
    const observation = React.useMemo(() => createWebDomScrollObservation(), []);
    const frame = React.useMemo(() => resolveReadOnlyTranscriptListShellFrame({ accessKind: 'public', bottomNoticeVisible: false, platformOS: Platform.OS }), []);
    const dataKey = React.useMemo(() => `discussion:${sessionAddressKey(props.target.address)}:${props.target.discussionId}`, [props.target.address, props.target.discussionId]);
    const hostViewed = useHostActivelyViewed(); const visibility = useSessionSurfaceVisibilitySnapshot();
    const surfaceVisible = React.useMemo(() => isSessionSurfaceVisible(props.target.address.sessionId, props.target.address.serverId), [props.target.address.serverId, props.target.address.sessionId, visibility]);
    const read = React.useMemo(() => createSessionDiscussionVisibleReadController({
        writeCursor: (seq) => repository.setReadState(props.target.discussionId, seq),
    }), [props.target.discussionId, repository]);
    React.useEffect(() => read.updateEligibility({
        activeAndVisible: props.active && hostViewed && surfaceVisible,
        lastReadSeq: discussion?.lastReadSeq ?? null,
    }), [discussion?.lastReadSeq, hostViewed, props.active, read, surfaceVisible, thread?.status]);
    const canonicalMessageIds = React.useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
    const onVisible = React.useCallback((info: Readonly<{ viewableItems: readonly ViewToken<SessionDiscussionTimelineItem>[] }>) => read.observeVisibleMessageSeqs(info.viewableItems.flatMap((token) => (
        token.isViewable !== false
        && token.item?.kind === 'human_message'
        && canonicalMessageIds.has(token.item.message.id)
            ? [token.item.message.seq]
            : []
    ))), [canonicalMessageIds, read]);
    if (accessRevoked) return <View style={styles.center} testID="session-discussion-details-empty-state"><Text style={styles.error}>{t('session.access.removedTitle')}</Text></View>;
    if (!thread || thread.status === 'idle' || (thread.status === 'loading' && !discussion)) return <View style={styles.center}><Text style={styles.status}>{t('session.collaboration.discussion.loading')}</Text></View>;
    if (!discussion) {
        const status = thread?.status;
        const label = status === 'offline'
            ? t('session.collaboration.discussion.offline')
            : status === 'locked'
                ? t('session.access.preparing')
                : status === 'error'
                    ? t('session.collaboration.discussion.loadError')
                    : t('session.collaboration.discussion.unavailable');
        const retryable = status === 'offline' || status === 'error' || status === undefined;
        return <View style={styles.center} testID="session-discussion-details-empty-state"><Text style={status === 'error' ? styles.error : styles.status}>{label}</Text>{retryable ? <Pressable testID="session-discussion-details-retry" style={styles.retry} accessibilityRole="button" accessibilityLabel={t('session.collaboration.discussion.retry')} onPress={() => void repository.refreshDiscussion(props.target.discussionId)}><Text style={styles.retryText}>{t('session.collaboration.discussion.retry')}</Text></Pressable> : null}</View>;
    }
    return <TranscriptMessageSelectionBoundary sessionId={dataKey} eligibleMessageIdsInOrder={selectableMessages.map((message) => message.id)}><View style={styles.root} testID="session-discussion-details"><View style={styles.toolbar}>{rename !== null ? <TextInput testID="session-discussion-rename-input" style={[styles.input, { flex: 1 }]} value={rename} onChangeText={setRename} accessibilityLabel={t('session.collaboration.discussion.rename')} autoFocus /> : <View style={styles.titleBlock}><Text testID="session-discussion-heading" accessibilityRole="header" style={styles.title} numberOfLines={1}>{discussion.title ?? t('session.collaboration.discussion.encryptedTitle')}</Text>{presenceLabel ? <Text testID="session-discussion-presence" accessibilityLiveRegion="polite" style={styles.headerMeta} numberOfLines={1}>{presenceLabel}</Text> : null}</View>}{rename !== null ? <Action label={t('common.save')} disabled={!rename.trim() || mutationsDisabled} onPress={() => void lifecycle('rename')} /> : <RecentDiscussionAuthors messages={displayMessages} />}{rename === null && lifecycleActions.length > 0 ? <DropdownMenu open={lifecycleMenuOpen} onOpenChange={setLifecycleMenuOpen} items={lifecycleActions} onSelect={(itemId) => { setLifecycleMenuOpen(false); if (itemId === 'rename') setRename(discussion.title ?? ''); else if (itemId === 'archive' || itemId === 'restore') void lifecycle(itemId); }} matchTriggerWidth={false} maxWidthCap={260} placement="bottom" popoverAnchorAlign="end" trigger={({ toggle }) => <Pressable testID="session-discussion-actions-menu" accessibilityRole="button" accessibilityLabel={t('common.moreActions')} accessibilityHint={t('common.moreActionsHint')} onPress={toggle} style={({ pressed }) => [styles.overflowAction, { opacity: pressed ? 0.7 : 1 }]}><Icon name="dots-three" size={ICON_SIZE.md} /></Pressable>} /> : null}</View>{lifecycleError || detailsNotice ? <Text style={styles.banner}>{lifecycleError ? t('session.collaboration.discussion.loadError') : detailsNotice}</Text> : null}{draft.conflict ? <SessionDraftConflictResolution scope={props.scope} address={draftAddress} conflict={draft.conflict} /> : null}<View style={styles.messages}><TranscriptListShell<SessionDiscussionTimelineItem> key={dataKey} dataKey={dataKey} data={items} frame={frame} webDomObservation={observation} keyExtractor={(item) => item.kind === 'human_message' ? `message:${item.message.localId ?? item.message.id}` : `run:${item.entry.runId ?? item.subagent.id}`} onViewableItemsChanged={onVisible} viewabilityConfig={VIEWABILITY} onStartReached={thread.hasMoreOlder ? () => void repository.loadOlderMessages(props.target.discussionId) : undefined} onStartReachedThreshold={0.2} header={thread.hasMoreOlder ? <Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel={t('session.collaboration.discussion.loadOlder')} onPress={() => void repository.loadOlderMessages(props.target.discussionId)}><Text style={styles.retryText}>{t('session.collaboration.discussion.loadOlder')}</Text></Pressable> : null} footer={items.length === 0 ? <View style={styles.center}><Text style={styles.status}>{t('session.collaboration.discussion.emptyActive')}</Text></View> : null} renderItem={({ item }) => {
        if (item.kind === 'agent_activity_reference') return <SessionDiscussionAgentActivityReference entry={item.entry} subagent={item.subagent} onPress={() => openRun(item)} />;
        const startsGroup = messageGroupStarts.has(item.message.id);
        return <View testID={`session-discussion-message-group-${startsGroup ? 'start' : 'continuation'}-${item.message.id}`} style={[styles.message, !startsGroup ? styles.messageGroupContinuation : null, item.message.producerV1 ? styles.agentMessage : null]}>{item.message.producerV1 === null && item.message.authorAccountId !== null && item.message.content !== null && item.message.id !== mutation?.localId ? <SelectMessageButton messageId={item.message.id} enabled visible role="user" previewText={textOf(item.message.content, resolveAccountLabel)} testID={`session-discussion-select-${item.message.id}`} /> : null}<View style={styles.messageBody}><View style={styles.messageAttribution}><Text testID={`session-discussion-message-actor-${item.message.id}`} style={styles.meta}>{discussionMessageActorLabel(item.message)}</Text>{item.message.producerV1 ? <Text testID={`session-discussion-message-producer-${item.message.id}`} style={styles.meta}>{t('session.collaboration.discussion.viaAgent')}</Text> : null}</View><Text testID={`session-discussion-message-content-${item.message.id}`}>{textOf(item.message.content, resolveAccountLabel)}</Text>{item.message.createdAt > 0 ? <Text testID={`session-discussion-message-timestamp-${item.message.id}`} accessibilityRole="text" accessibilityLabel={new Date(item.message.createdAt).toLocaleString()} style={styles.timestamp}>{formatShortRelativeTime(item.message.createdAt)}</Text> : null}{item.message.localId === mutation?.localId && mutationStatusLabel(mutation) ? <Text testID={`session-discussion-message-status-${item.message.localId}`} accessibilityLiveRegion="polite" style={mutation.status === 'failed' ? styles.error : styles.deliveryStatus}>{mutationStatusLabel(mutation)}</Text> : null}{item.message.localId === mutation?.localId ? <MutationRecovery mutation={mutation} onRetry={() => void repository.retry(mutation.localId)} onDismiss={dismissRefusal} /> : null}</View></View>;
        }} /></View><View style={styles.selectionToolbar}><TranscriptSelectionToolbar selectableMessagesInOrder={selectableMessages} bulkCopyFormat={transcriptBulkCopyFormat} roleLabels={{ user: t('session.collaboration.discussion.collaborator'), assistant: t('voiceActivity.format.assistant') }} sendToSessionEnabled={discussion.capabilities.sendToSession} onSendToSession={sendSelectionToComposer} formatSelection={(selected) => prepareSelection(selected)?.text ?? null} selectionUnavailableText={t('session.collaboration.discussion.contentUnavailable')} additionalAction={discussion.capabilities.askAgent && canLaunchExecutionRuns ? { testID: 'session-discussion-selection-ask-agent', label: t('session.collaboration.discussion.selection.askAgent'), onPress: askAgentAboutSelection } : undefined} /></View>{selectionHandoffRetry ? <View style={styles.selectionHandoffError}><Text testID="session-discussion-selection-handoff-error" accessibilityLiveRegion="polite" style={styles.selectionHandoffErrorText}>{t('session.collaboration.discussion.selection.handoffError')}</Text><Pressable testID="session-discussion-selection-handoff-retry" accessibilityRole="button" accessibilityLabel={t('common.retry')} accessibilityState={selectionHandoffRetrying ? { disabled: true } : undefined} disabled={selectionHandoffRetrying} onPress={() => void retrySelectionHandoff()} style={styles.retry}><Text style={styles.retryText}>{t('common.retry')}</Text></Pressable></View> : null}{discussion.archivedAt !== null ? <Text style={styles.banner}>{t('session.collaboration.discussion.archivedNotice')}</Text> : discussion.capabilities.postMessages ? <SessionDiscussionComposer scope={props.scope} address={props.target.address} discussionId={props.target.discussionId} availability="full_collaboration" value={{ text: draft.text, mentions: draft.mentions }} onChange={draft.setComposer} disabled={composerBlocked || mutationsDisabled} onSend={(content) => void send(content)} /> : <Text style={styles.banner}>{t('session.collaboration.discussion.locked')}</Text>}</View></TranscriptMessageSelectionBoundary>;
}

/**
 * Exactly one exit per settled state: an unknown outcome or transient failure
 * retries the same identity; a definitive refusal is dismissed and the draft
 * stays for a fresh attempt.
 */
function MutationRecovery(props: Readonly<{ mutation: SessionDiscussionRepositoryMutation; onRetry: () => void; onDismiss: () => void }>) {
    const dismissable = props.mutation.status === 'failed' && props.mutation.recovery === 'dismiss';
    const retryable = props.mutation.status === 'outcome_unknown' || (props.mutation.status === 'failed' && !dismissable);
    if (dismissable) {
        return <Pressable testID="session-discussion-mutation-dismiss" style={styles.retry} accessibilityRole="button" accessibilityLabel={t('session.collaboration.discussion.dismiss')} onPress={props.onDismiss}><Text style={styles.retryText}>{t('session.collaboration.discussion.dismiss')}</Text></Pressable>;
    }
    if (retryable) {
        return <Pressable testID="session-discussion-mutation-retry" style={styles.retry} accessibilityRole="button" accessibilityLabel={t('session.collaboration.discussion.retry')} onPress={props.onRetry}><Text style={styles.retryText}>{t('session.collaboration.discussion.retry')}</Text></Pressable>;
    }
    return null;
}

function Action(props: Readonly<{ label: string; disabled?: boolean; onPress: () => void }>) {
    return <Pressable style={styles.action} disabled={props.disabled} onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.label}><Text style={styles.actionText}>{props.label}</Text></Pressable>;
}
