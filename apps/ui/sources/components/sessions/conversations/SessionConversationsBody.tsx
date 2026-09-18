import * as React from 'react';
import { FlatList, Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { SessionDiscussionOpenedSummaryV1 } from '@happier-dev/protocol';

import { SessionDiscussionRow } from './SessionDiscussionRow';
import { useOpenSessionDiscussion } from './useOpenSessionDiscussion';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Text } from '@/components/ui/text/Text';
import { useSessionAgentActivityRoster } from '@/hooks/session/useSessionAgentActivity';
import { createSessionDiscussionClient } from '@/sync/api/session/sessionDiscussionActions';
import {
    useServerCredentialAccountScopeBindings,
    type ServerCredentialAccountScopeBinding,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import type { SessionDiscussionRepositoryStatus } from '@/sync/ops/sessionDiscussions/sessionDiscussionRepository';
import { getSessionDiscussionRepository } from '@/sync/ops/sessionDiscussions/sessionDiscussionRepositoryRegistry';
import { useSessionDiscussionRepositorySnapshot } from '@/sync/ops/sessionDiscussions/useSessionDiscussionRepositorySnapshot';
import { t } from '@/text';
import { SessionDiscussionAgentActivityReference } from './SessionDiscussionAgentActivityReference';
import {
    buildSessionDiscussionActivityItems,
    sessionDiscussionActivityItemKey,
    type SessionDiscussionActivityItem,
} from './sessionDiscussionActivityItems';
import { useOpenSessionAgentConversation } from './useOpenSessionAgentConversation';
import { useSessionConversationsAvailability } from './useSessionConversationsAvailability';

const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.colors.surface.base },
    list: { flex: 1, minHeight: 0 },
    listContent: { flexGrow: 1 },
    sectionHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, backgroundColor: theme.colors.surface.base },
    sectionHeaderFirst: { borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    sectionHeaderLater: { borderTopWidth: 1, borderTopColor: theme.colors.border.default, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default, marginTop: 8 },
    heading: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: theme.colors.text.primary },
    quietAction: { minHeight: minimumInteractiveTargetSize, justifyContent: 'center', paddingHorizontal: 8 },
    quietActionText: { color: theme.colors.accent.blue, fontSize: 13, fontWeight: '600' },
    sectionEmpty: { paddingHorizontal: 16, paddingVertical: 14, color: theme.colors.text.secondary },
    sectionNotice: { paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    center: { minHeight: 120, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    status: { color: theme.colors.text.secondary },
    retry: { minHeight: minimumInteractiveTargetSize, justifyContent: 'center', paddingHorizontal: 8 },
    retryText: { color: theme.colors.accent.blue, fontWeight: '600' },
    archivedSection: { borderTopWidth: 1, borderTopColor: theme.colors.border.default },
    archivedDisclosure: { minHeight: minimumInteractiveTargetSize, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    archivedLabel: { flex: 1, minWidth: 0, color: theme.colors.text.secondary, fontWeight: '600' },
    archivedEmpty: { paddingHorizontal: 16, paddingVertical: 14, color: theme.colors.text.secondary },
    more: { minHeight: minimumInteractiveTargetSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    moreText: { color: theme.colors.accent.blue, fontWeight: '600' },
}));

/** The one sentence a section states about why it currently shows nothing new. */
function readListNotice(status: SessionDiscussionRepositoryStatus): string | null {
    switch (status) {
        case 'offline': return t('session.collaboration.discussion.offline');
        case 'revoked': return t('session.access.removedTitle');
        case 'locked': return t('session.access.preparing');
        case 'error': return t('session.collaboration.discussion.loadError');
        default: return null;
    }
}

type SessionDiscussionListItem = SessionDiscussionActivityItem
    | Readonly<{ kind: 'archived_disclosure' }>
    | Readonly<{ kind: 'archived_discussion'; discussion: SessionDiscussionOpenedSummaryV1 }>
    | Readonly<{ kind: 'archived_loading' | 'archived_empty' | 'archived_error' | 'archived_load_more' }>;

function sessionDiscussionListItemKey(item: SessionDiscussionListItem): string {
    switch (item.kind) {
        case 'archived_discussion': return `archived:${item.discussion.id}`;
        case 'archived_disclosure':
        case 'archived_loading':
        case 'archived_empty':
        case 'archived_error':
        case 'archived_load_more': return item.kind;
        default: return sessionDiscussionActivityItemKey(item);
    }
}

/**
 * Lane 05 canonical Conversations body: the one component Lane 04's responsive
 * Collaboration host mounts for its Conversations mode.
 *
 * This is the moved owner of the former Lane 04 temporary seed. Repository,
 * paging, and action decisions live here exactly once; Lane 04 owns placement,
 * modes, and responsive navigation, never list state.
 */
export function SessionConversationsBody(props: Readonly<{
    address: SessionAddress;
    scope: ServerAccountScope;
}>): React.ReactElement | null {
    const requestedServerIds = React.useMemo(() => [props.address.serverId], [props.address.serverId]);
    const bindings = useServerCredentialAccountScopeBindings(requestedServerIds);
    const binding = React.useMemo(() => [...bindings.values()][0] ?? null, [bindings]);
    const available = useSessionConversationsAvailability(props.address.serverId);
    if (!available || !binding || !areServerAccountScopesEqual(binding.scope, props.scope)) return null;
    return <SessionConversationsBodyReady address={props.address} scope={props.scope} accountLifetime={binding} />;
}

/**
 * The Conversations body: one activity-ordered virtualized list with two
 * semantic sections.
 *
 * Both sections are projections, not stores. Human rows come from the discussion
 * repository and Agent conversations from the canonical Agent activity owner, so
 * this list never learns a second opinion about what exists or what state a Run
 * is in.
 *
 * Both headings and their distinct creation actions are list items, so exactly
 * one scroller and virtualization owner sits under the surface's flex body.
 */
function SessionConversationsBodyReady(props: Readonly<{
    address: SessionAddress;
    scope: ServerAccountScope;
    accountLifetime: ServerCredentialAccountScopeBinding;
}>): React.ReactElement {
    const client = React.useMemo(() => createSessionDiscussionClient({ session: props.address, availability: 'full_collaboration' }), [props.address]);
    const repository = React.useMemo(() => getSessionDiscussionRepository({
        scope: props.scope,
        address: props.address,
        client,
        accountLifetime: props.accountLifetime,
    }), [client, props.accountLifetime, props.address, props.scope]);
    const snapshot = useSessionDiscussionRepositorySnapshot(repository);
    const { openDiscussion, openNewDiscussion, activeDiscussionKey } = useOpenSessionDiscussion({ address: props.address, sourceSurface: 'collaboration' });
    const { openAgentConversation, openNewAgentConversation } = useOpenSessionAgentConversation({ address: props.address });
    const activity = useSessionAgentActivityRoster({
        sessionId: props.address.sessionId,
        serverId: props.address.serverId,
    });
    const [archivedExpanded, setArchivedExpanded] = React.useState(false);
    const active = snapshot.lists.active;
    const archived = snapshot.lists.archived;

    React.useEffect(() => {
        const unmount = repository.mount();
        if (repository.getSnapshot().lists.active.status === 'idle') void repository.refreshList('active');
        return unmount;
    }, [repository]);

    React.useEffect(() => {
        if (archivedExpanded && repository.getSnapshot().lists.archived.status === 'idle') {
            void repository.refreshList('archived');
        }
    }, [archivedExpanded, repository]);

    const toggleArchived = React.useCallback(() => {
        setArchivedExpanded((current) => !current);
    }, []);

    const items = React.useMemo<readonly SessionDiscussionListItem[]>(() => {
        const primary = buildSessionDiscussionActivityItems({
            discussions: active.items,
            agentEntries: activity.entries,
            readSubagentForEntry: activity.readSubagentForEntry,
            humanListPending: active.status === 'idle' || (active.status === 'loading' && active.items.length === 0),
        });
        if (!archivedExpanded) return [...primary, { kind: 'archived_disclosure' }];
        const archivedItems: SessionDiscussionListItem[] = [{ kind: 'archived_disclosure' }];
        if (archived.status === 'loading' && archived.items.length === 0) archivedItems.push({ kind: 'archived_loading' });
        else if ((archived.status === 'error' || archived.status === 'offline' || archived.status === 'revoked') && archived.items.length === 0) archivedItems.push({ kind: 'archived_error' });
        else if (archived.items.length === 0) archivedItems.push({ kind: 'archived_empty' });
        else {
            archivedItems.push(...archived.items.map((discussion) => ({ kind: 'archived_discussion' as const, discussion })));
            if (archived.nextCursor) archivedItems.push({ kind: 'archived_load_more' });
        }
        return [...primary, ...archivedItems];
    }, [active.items, active.status, activity.entries, activity.readSubagentForEntry, archived.items, archived.nextCursor, archived.status, archivedExpanded]);

    const humanNotice = readListNotice(active.status);
    const renderItem = React.useCallback(({ item }: Readonly<{ item: SessionDiscussionListItem }>) => {
        switch (item.kind) {
            case 'human_section':
                return (
                    <View
                        style={[styles.sectionHeader, styles.sectionHeaderFirst]}
                        accessibilityRole="header"
                        testID="session-human-conversations-section"
                    >
                        <Text style={styles.heading}>{t('session.collaboration.conversations')}</Text>
                        {active.status === 'loading' && active.items.length > 0 ? <ActivitySpinner size="small" /> : null}
                        <IconButton
                            testID="session-discussion-new"
                            iconName="plus"
                            size={36}
                            minimumInteractiveTargetSize={minimumInteractiveTargetSize}
                            accessibilityLabel={t('session.collaboration.discussion.newDiscussion')}
                            onPress={openNewDiscussion}
                        />
                    </View>
                );
            case 'human_discussion':
                return (
                    <SessionDiscussionRow
                        discussion={item.discussion}
                        selected={activeDiscussionKey === item.discussion.id}
                        onPress={() => openDiscussion(item.discussion.id, item.discussion.title)}
                    />
                );
            case 'human_empty':
                return active.status === 'loading'
                    ? <View style={styles.center}><ActivitySpinner size="small" /><Text style={styles.status}>{t('session.collaboration.discussion.loading')}</Text></View>
                    : <Text style={styles.sectionEmpty}>{t('session.collaboration.discussion.emptyActive')}</Text>;
            case 'agent_section':
                return (
                    <View style={[styles.sectionHeader, styles.sectionHeaderLater]} accessibilityRole="header" testID="session-agent-conversations-section">
                        <Text style={styles.heading}>{t('session.collaboration.agentConversations')}</Text>
                        <Pressable
                            testID="session-agent-conversation-new"
                            accessibilityRole="button"
                            accessibilityLabel={t('session.subagents.panel.newAgentConversation')}
                            style={({ pressed }) => [styles.quietAction, pressed ? { opacity: 0.7 } : null]}
                            onPress={openNewAgentConversation}
                        >
                            <Text style={styles.quietActionText}>{t('session.subagents.panel.newAgentConversation')}</Text>
                        </Pressable>
                    </View>
                );
            case 'agent_conversation':
                return (
                    <SessionDiscussionAgentActivityReference
                        entry={item.entry}
                        subagent={item.subagent}
                        onPress={() => openAgentConversation(item.runId)}
                    />
                );
            case 'agent_empty':
                return <Text style={styles.sectionEmpty}>{t('session.collaboration.emptyAgentConversations')}</Text>;
            case 'archived_disclosure':
                return (
                    <Pressable
                        testID="session-discussion-archived-disclosure"
                        accessibilityRole="button"
                        accessibilityState={{ expanded: archivedExpanded }}
                        accessibilityLabel={t('session.collaboration.discussion.archivedDisclosure')}
                        onPress={toggleArchived}
                        style={({ pressed }) => [styles.archivedSection, styles.archivedDisclosure, pressed ? { opacity: 0.7 } : null]}
                    >
                        <Text style={styles.archivedLabel}>{t('session.collaboration.discussion.archived')}</Text>
                        <Icon name={archivedExpanded ? 'caret-up' : 'caret-down'} size={16} />
                    </Pressable>
                );
            case 'archived_discussion':
                return <SessionDiscussionRow discussion={item.discussion} selected={activeDiscussionKey === item.discussion.id} onPress={() => openDiscussion(item.discussion.id, item.discussion.title)} />;
            case 'archived_loading':
                return <View style={styles.center}><ActivitySpinner size="small" /></View>;
            case 'archived_empty':
                return <Text style={styles.archivedEmpty}>{t('session.collaboration.discussion.emptyArchived')}</Text>;
            case 'archived_error':
                return <View style={styles.center}><Text style={styles.status}>{readListNotice(archived.status) ?? t('session.collaboration.discussion.loadError')}</Text><Pressable style={styles.retry} accessibilityRole="button" onPress={() => void repository.refreshList('archived')}><Text style={styles.retryText}>{t('session.collaboration.discussion.retry')}</Text></Pressable></View>;
            case 'archived_load_more':
                return <Pressable testID="session-discussion-archived-load-more" style={styles.more} accessibilityRole="button" onPress={() => void repository.loadMoreList('archived')}><Text style={styles.moreText}>{t('session.collaboration.discussion.loadMore')}</Text></Pressable>;
        }
    }, [active.items.length, active.status, activeDiscussionKey, archived.status, archivedExpanded, openAgentConversation, openDiscussion, openNewAgentConversation, openNewDiscussion, repository, toggleArchived]);

    return (
        <View style={styles.root} testID="session-discussion-activity-list">
            {humanNotice ? (
                <View style={styles.sectionNotice} testID="session-discussion-list-notice">
                    <Text style={styles.status}>{humanNotice}</Text>
                    {active.status === 'error' || active.status === 'offline' ? (
                        <Pressable
                            testID="session-discussion-list-retry"
                            accessibilityRole="button"
                            style={styles.retry}
                            onPress={() => void repository.refreshList('active')}
                        >
                            <Text style={styles.retryText}>{t('session.collaboration.discussion.retry')}</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            <FlatList
                style={styles.list}
                contentContainerStyle={styles.listContent}
                accessibilityRole="list"
                accessibilityLabel={t('session.collaboration.conversations')}
                data={items}
                keyExtractor={sessionDiscussionListItemKey}
                renderItem={renderItem}
                onEndReachedThreshold={0.35}
                onEndReached={() => { if (active.nextCursor && active.status !== 'loading') void repository.loadMoreList('active'); }}
            />
        </View>
    );
}
