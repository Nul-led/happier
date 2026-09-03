import * as React from 'react';
import { Pressable, View, Platform } from 'react-native';
import { VirtualizedSectionList } from '@/components/ui/lists/virtualized/VirtualizedSectionList';
import { KeyboardAwareScreen } from '@/components/ui/keyboardAvoidance/KeyboardAwareScreen';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text/Text';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { Typography } from '@/constants/Typography';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useAllSessions, useSessionListRowStateByServerId, useSessionOrganizationPinnedSessionKeys, useSetting } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import { getSessionAvatarId, getSessionName, getSessionSubtitle } from '@/utils/sessions/sessionUtils';
import { sessionUnarchiveWithServerScope } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { Icon } from '@/components/ui/icons/Icon';
import { useIsFocused } from '@react-navigation/native';
import { useSessionListPaneSourceScopeKey } from '@/components/sessions/shell/sessionListPaneRetention';
import { SessionListSearchChrome } from '@/components/sessions/shell/search/SessionListSearchChrome';
import { hasPendingArchivedTranscriptMatch } from '@/components/sessions/shell/search/archivedTranscriptMatchState';
import { useSessionListHeaderFilterRetention } from '@/components/sessions/shell/search/useSessionListHeaderFilterRetention';
import {
    useSessionListMemorySearchAugmentationForContext,
    useSessionListMemorySearchContext,
} from '@/components/sessions/shell/search/useSessionListMemorySearchAugmentation';
import { useSessionListNavigationActions } from '@/components/sessions/shell/useSessionListNavigationActions';
import { sessionTagKey } from '@/components/sessions/shell/sessionTagUtils';
import { buildSessionListRetentionKey } from '@/components/sessions/shell/scroll/sessionListRetentionKey';
import { useSessionNavigationCursorPublisher } from '@/sync/domains/session/navigation/useSessionNavigationCursorPublisher';
import type { SessionListLikeItem } from '@/sync/domains/session/navigation/sessionNavigationOrder';
import { buildCanonicalSessionListSearchText } from '@/components/sessions/shell/useSessionListSearchTextByKey';

type ArchivedScreenSession = Session | (SessionListRenderableSession & { serverId?: string });

type ArchivedSessionsSectionKind = 'archived' | 'hidden';

type ArchivedSessionsSection = Readonly<{
    title: string;
    kind: ArchivedSessionsSectionKind;
    data: ArchivedScreenSession[];
}>;

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.background.canvas,
    },
    contentContainer: {
        flex: 1,
    },
    list: {
        flex: 1,
    },
    headerSection: {
        backgroundColor: theme.colors.background.canvas,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    headerText: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text.secondary,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    sessionCard: {
        backgroundColor: theme.colors.surface.base,
        marginHorizontal: 16,
        marginBottom: 1,
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionCardFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionCardLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionCardSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text.primary,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    actionButton: {
        width: 34,
        height: 34,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        ...Typography.default(),
    },
}));

const EMPTY_ARCHIVED_TAGS: ReadonlyArray<string> = [];
function noopSelectedTagsChange(): void {}

function canManageArchive(session: ArchivedScreenSession): boolean {
    // Owner sessions have no accessLevel set; shared sessions require admin.
    return !session.accessLevel || session.accessLevel === 'admin';
}

function getPinnedSessionKey(session: ArchivedScreenSession): string {
    const serverId = String(session.serverId ?? '').trim();
    const sessionId = String(session.id ?? '').trim();
    return serverId && sessionId ? `${serverId}:${sessionId}` : '';
}

function getArchivedSessionKey(session: ArchivedScreenSession): string {
    const serverId = String(session.serverId ?? '').trim();
    const sessionId = String(session.id ?? '').trim();
    return serverId && sessionId ? `${serverId}:${sessionId}` : sessionId;
}

export function buildArchivedTranscriptEligibleSessionIds(
    sessions: ReadonlyArray<ArchivedScreenSession>,
    serverId: string,
): string[] {
    const exactServerId = serverId.trim();
    if (!exactServerId) return [];
    return [...new Set(
        sessions
            .filter((session) => String(session.serverId ?? '').trim() === exactServerId)
            .map((session) => session.id),
    )];
}

function buildArchivedSearchHaystack(session: ArchivedScreenSession): string {
    return buildCanonicalSessionListSearchText({
        sessionId: session.id,
        renderable: session,
        session: 'dataEncryptionKey' in session ? session as Session : null,
    }).toLocaleLowerCase();
}

function archivedSessionMatchesSearch(
    session: ArchivedScreenSession,
    searchTokens: ReadonlyArray<string>,
    transcriptMatchedSessionKeys: ReadonlySet<string>,
): boolean {
    if (searchTokens.length === 0) return true;
    const serverId = String(session.serverId ?? '').trim();
    const sessionId = String(session.id ?? '').trim();
    if (serverId && sessionId && transcriptMatchedSessionKeys.has(sessionTagKey(serverId, sessionId))) {
        return true;
    }
    const haystack = buildArchivedSearchHaystack(session);
    return searchTokens.every((token) => haystack.includes(token));
}

function isHiddenInactiveSession(session: ArchivedScreenSession, pinnedSessionKeysV1: ReadonlyArray<string>): boolean {
    if (session.archivedAt != null) return false;
    if (session.active === true) return false;
    if ('keepVisibleWhenInactive' in session && (session as { keepVisibleWhenInactive?: boolean }).keepVisibleWhenInactive === true) return false;
    const key = getPinnedSessionKey(session);
    return key === '' || !pinnedSessionKeysV1.includes(key);
}

export default function ArchivedSessionsScreen() {
    const safeArea = useSafeAreaInsets();
    // Composed at render time: the module-scope stylesheet evaluates once, so a
    // baked-in `layout.maxWidth` would freeze the user's content-width preference.
    const contentMaxWidthStyle = useLayoutMaxWidthStyle();
    const contentContainerStyle = React.useMemo(
        () => [styles.contentContainer, contentMaxWidthStyle],
        [contentMaxWidthStyle],
    );
    const listContentContainerStyle = React.useMemo(
        () => ({ paddingBottom: safeArea.bottom + 64, maxWidth: contentMaxWidthStyle.maxWidth }),
        [contentMaxWidthStyle, safeArea.bottom],
    );
    const { theme } = useUnistyles();
    const navigateToSession = useNavigateToSession();
    const isFocused = useIsFocused();
    const sessionNavigationSourceScopeKey = useSessionListPaneSourceScopeKey();
    const allSessions = useAllSessions();
    const sessionListRowStateByServerId = useSessionListRowStateByServerId();
    const hideInactiveSessions = useSetting('hideInactiveSessions') === true;
    const pinnedSessionKeysV1 = useSessionOrganizationPinnedSessionKeys();
    const memorySearchContext = useSessionListMemorySearchContext();
    const searchRetentionKey = React.useMemo(() => buildSessionListRetentionKey(
        'all',
        `${sessionNavigationSourceScopeKey}\u0000archived\u0000transcript:${memorySearchContext.activeScopeKey}`,
    ), [memorySearchContext.activeScopeKey, sessionNavigationSourceScopeKey]);
    const { searchQuery, setSearchQuery } = useSessionListHeaderFilterRetention(searchRetentionKey);
    const { handleOpenUniversalSearch } = useSessionListNavigationActions();
    const searchTokens = React.useMemo(() => (
        searchQuery.trim().toLocaleLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean)
    ), [searchQuery]);
    React.useEffect(() => {
        void sync.fetchArchivedSessions().catch(() => undefined);
    }, []);

    const [completedSearchInventoryScopeKey, setCompletedSearchInventoryScopeKey] = React.useState('');
    const requestedSearchInventoryScopeRef = React.useRef('');
    React.useEffect(() => {
        if (!isFocused || searchTokens.length === 0) return;
        if (requestedSearchInventoryScopeRef.current === searchRetentionKey) return;
        requestedSearchInventoryScopeRef.current = searchRetentionKey;
        let disposed = false;
        void sync.fetchAllArchivedSessions().then(() => {
            if (!disposed && requestedSearchInventoryScopeRef.current === searchRetentionKey) {
                setCompletedSearchInventoryScopeKey(searchRetentionKey);
            }
        }).catch(() => {
            if (requestedSearchInventoryScopeRef.current === searchRetentionKey) {
                requestedSearchInventoryScopeRef.current = '';
            }
        });
        return () => {
            disposed = true;
        };
    }, [isFocused, searchRetentionKey, searchTokens.length]);

    const handleLoadMoreSessions = React.useCallback(() => {
        const requests = [sync.fetchMoreArchivedSessions()];
        if (hideInactiveSessions) {
            requests.push(sync.fetchMoreSessions());
        }
        void Promise.all(requests).catch(() => undefined);
    }, [hideInactiveSessions]);

    const cachedArchivedSessions = React.useMemo(() => {
        const byId = new Map<string, ArchivedScreenSession>();
        for (const [serverId, rowsBySessionId] of Object.entries(sessionListRowStateByServerId ?? {})) {
            if (!rowsBySessionId || typeof rowsBySessionId !== 'object') continue;
            for (const row of Object.values(rowsBySessionId)) {
                if (!row || row.archivedAt == null) continue;
                const session = {
                    ...row,
                    serverId,
                };
                if (!isUserFacingSession(session)) continue;
                byId.set(getArchivedSessionKey(session), session);
            }
        }
        return Array.from(byId.values());
    }, [sessionListRowStateByServerId]);

    const archivedSessions = React.useMemo(() => {
        const byId = new Map<string, ArchivedScreenSession>();
        for (const session of cachedArchivedSessions) {
            byId.set(getArchivedSessionKey(session), session);
        }
        for (const session of allSessions) {
            if (session.archivedAt != null && isUserFacingSession(session)) {
                byId.set(getArchivedSessionKey(session), session);
            }
        }
        return Array.from(byId.values())
            .sort((a, b) => {
                const aAt = typeof a.archivedAt === 'number' ? a.archivedAt : 0;
                const bAt = typeof b.archivedAt === 'number' ? b.archivedAt : 0;
                if (bAt !== aAt) return bAt - aAt;
                return b.updatedAt - a.updatedAt;
            });
    }, [allSessions, cachedArchivedSessions]);

    const hiddenInactiveSessions = React.useMemo(() => {
        if (!hideInactiveSessions) {
            return [];
        }
        return allSessions
            .filter((session) => isUserFacingSession(session) && isHiddenInactiveSession(session, pinnedSessionKeysV1))
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allSessions, hideInactiveSessions, pinnedSessionKeysV1]);

    // Same stable chrome and same explicit transcript request adapter as the main
    // session list, under this screen's archived/hidden corpus. The eligibility
    // travels to the canonical Home/daemon query owner so it is applied before
    // provider result limiting; this screen does not create an archived engine.
    const eligibleTranscriptSessionIds = React.useMemo(
        () => buildArchivedTranscriptEligibleSessionIds(
            [...archivedSessions, ...hiddenInactiveSessions],
            memorySearchContext.serverId,
        ),
        [archivedSessions, hiddenInactiveSessions, memorySearchContext.serverId],
    );
    const transcriptSearch = useSessionListMemorySearchAugmentationForContext(
        {
            searchQuery,
            enabled: isFocused && completedSearchInventoryScopeKey === searchRetentionKey,
            eligibleSessionIds: eligibleTranscriptSessionIds,
        },
        memorySearchContext,
    );
    const transcriptMatchedSessionTargets = transcriptSearch.memoryMatchedSessionTargets;
    const transcriptMatchedSessionKeys = React.useMemo(
        () => new Set(transcriptMatchedSessionTargets.map((target) => target.sessionKey)),
        [transcriptMatchedSessionTargets],
    );

    const sections = React.useMemo<ArchivedSessionsSection[]>(() => {
        const matchingHidden = hiddenInactiveSessions.filter(
            (session) => archivedSessionMatchesSearch(session, searchTokens, transcriptMatchedSessionKeys),
        );
        const matchingArchived = archivedSessions.filter(
            (session) => archivedSessionMatchesSearch(session, searchTokens, transcriptMatchedSessionKeys),
        );
        const out: ArchivedSessionsSection[] = [];
        if (matchingHidden.length > 0) {
            out.push({
                title: t('settingsFeatures.hiddenInactiveSessionsSectionTitle'),
                kind: 'hidden',
                data: matchingHidden,
            });
        }
        if (matchingArchived.length > 0) {
            out.push({
                title: t('sessionInfo.archivedSessions'),
                kind: 'archived',
                data: matchingArchived,
            });
        }
        return out;
    }, [archivedSessions, hiddenInactiveSessions, searchTokens, transcriptMatchedSessionKeys]);

    // A transcript match whose canonical session record has not landed on this screen
    // yet is still resolving. Saying "no results" while that is true would be untrue,
    // so the screen reports the transition instead.
    const hasPendingTranscriptMatches = React.useMemo(() => {
        if (transcriptMatchedSessionTargets.length === 0) return false;
        const rendered = new Set<string>();
        for (const section of sections) {
            for (const session of section.data) rendered.add(getArchivedSessionKey(session));
        }
        const known = new Set<string>();
        for (const session of allSessions) known.add(getArchivedSessionKey(session));
        for (const session of cachedArchivedSessions) known.add(getArchivedSessionKey(session));
        const eligible = new Set<string>();
        for (const session of archivedSessions) eligible.add(getArchivedSessionKey(session));
        for (const session of hiddenInactiveSessions) eligible.add(getArchivedSessionKey(session));
        return hasPendingArchivedTranscriptMatch({
            targetKeys: transcriptMatchedSessionTargets.map((target) => target.sessionKey),
            knownSessionKeys: known,
            eligibleSessionKeys: eligible,
            renderedSessionKeys: rendered,
        });
    }, [allSessions, archivedSessions, cachedArchivedSessions, hiddenInactiveSessions, sections, transcriptMatchedSessionTargets]);

    // The rows this screen opens, in render order. These are session records rather than
    // list rows, so the owning server is lifted onto the row shape the ordering owner reads;
    // an unscoped key would not match the server-scoped session route it has to anchor on.
    const sessionNavigationItems = React.useMemo<SessionListLikeItem[]>(
        () => sections.flatMap((section) => section.data.map((session) => ({
            type: 'session',
            sessionId: session.id,
            serverId: session.serverId,
        }))),
        [sections],
    );
    useSessionNavigationCursorPublisher({
        active: isFocused,
        origin: 'archived',
        sourceScopeKey: sessionNavigationSourceScopeKey,
        storageKind: 'all',
        items: sessionNavigationItems,
    });

    const handleUnarchive = React.useCallback((session: ArchivedScreenSession) => {
        Modal.alert(
            t('sessionInfo.unarchiveSession'),
            t('sessionInfo.unarchiveSessionConfirm'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.unarchiveSession'),
                    style: 'default',
                    onPress: async () => {
                        const result = await sessionUnarchiveWithServerScope(session.id, { serverId: session.serverId ?? null });
                        if (!result.success) {
                            Modal.alert(t('common.error'), result.message || t('sessionInfo.failedToUnarchiveSession'));
                        }
                    },
                },
            ],
        );
    }, []);

    const renderSessionCard = React.useCallback(
        (item: ArchivedScreenSession, index: number, section: ArchivedSessionsSection) => {
            const sessionName = getSessionName(item);
            const sessionSubtitle = getSessionSubtitle(item);
            const avatarId = getSessionAvatarId(item);

            const isFirst = index === 0;
            const isLast = index === section.data.length - 1;
            const isSingle = section.data.length === 1;

            return (
                <Pressable
                    key={getArchivedSessionKey(item)}
                    testID={`archived-session-row:${getArchivedSessionKey(item)}`}
                    style={[
                        styles.sessionCard,
                        isSingle ? styles.sessionCardSingle : isFirst ? styles.sessionCardFirst : isLast ? styles.sessionCardLast : null,
                    ]}
                    onPress={() => navigateToSession(item.id, item.serverId ? { serverId: item.serverId } : undefined)}
                >
                    <Avatar id={avatarId} size={48} />
                    <View style={styles.sessionContent}>
                        <Text style={styles.sessionTitle} numberOfLines={1}>
                            {sessionName}
                        </Text>
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                            {sessionSubtitle}
                        </Text>
                    </View>
                    {section.kind === 'archived' && canManageArchive(item) ? (
                        <Pressable
                            testID={`archived-session-unarchive:${getArchivedSessionKey(item)}`}
                            style={styles.actionButton}
                            onPress={() => handleUnarchive(item)}
                            accessibilityRole="button"
                            accessibilityLabel={t('sessionInfo.unarchiveSession')}
                            hitSlop={8}
                        >
                            <Icon name="arrow-arc-left" size={16} color={theme.colors.text.secondary} />
                        </Pressable>
                    ) : null}
                </Pressable>
            );
        },
        [handleUnarchive, navigateToSession, theme.colors.text.secondary],
    );

    const renderSectionHeader = React.useCallback(
        ({ section }: { section: { title?: string } }) => (
            <View style={styles.headerSection}>
                <Text style={styles.headerText}>{section.title ?? ''}</Text>
            </View>
        ),
        [],
    );

    const stopScrollEventPropagationOnWeb = React.useCallback((event: any) => {
        if (Platform.OS !== 'web') return;
        if (typeof event?.stopPropagation === 'function') event.stopPropagation();
    }, []);

    return (
        <KeyboardAwareScreen testID="archived-sessions-keyboard-frame" mode="form" style={styles.container}>
            <View style={contentContainerStyle}>
                <SessionListSearchChrome
                    allKnownTags={EMPTY_ARCHIVED_TAGS}
                    selectedTags={EMPTY_ARCHIVED_TAGS}
                    searchQuery={searchQuery}
                    onSelectedTagsChange={noopSelectedTagsChange}
                    onSearchQueryChange={setSearchQuery}
                    onSearchEverything={handleOpenUniversalSearch}
                />
                {sections.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Text testID="archived-sessions-empty-state" style={styles.emptyText}>
                            {searchTokens.length === 0
                                ? t('sessionHistory.empty')
                                : transcriptSearch.isSearchingMemory || hasPendingTranscriptMatches
                                    ? t('common.loading')
                                    : t('directSessions.browseNoSearchResults')}
                        </Text>
                    </View>
                ) : (
                    <VirtualizedSectionList
                        style={styles.list}
                        sections={sections}
                        renderItem={({ item, index, section }) => renderSessionCard(item, index, section as ArchivedSessionsSection)}
                        renderSectionHeader={renderSectionHeader}
                        keyExtractor={getArchivedSessionKey}
                        onEndReached={handleLoadMoreSessions}
                        onEndReachedThreshold={0.4}
                        webScrollHandlers={Platform.OS === 'web'
                            ? { onWheel: stopScrollEventPropagationOnWeb, onTouchMove: stopScrollEventPropagationOnWeb }
                            : undefined}
                        contentContainerStyle={listContentContainerStyle}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    />
                )}
            </View>
        </KeyboardAwareScreen>
    );
}
