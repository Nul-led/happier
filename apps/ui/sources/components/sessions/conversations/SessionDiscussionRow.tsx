import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { SessionDiscussionOpenedSummaryV1 } from '@happier-dev/protocol';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Text } from '@/components/ui/text/Text';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import { t } from '@/text';
import { formatShortRelativeTime } from '@/utils/time/formatShortRelativeTime';

const styles = StyleSheet.create((theme) => ({
    root: {
        minHeight: 64,
        paddingHorizontal: 16,
        paddingVertical: 11,
        justifyContent: 'center',
        gap: 5,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.subtle,
    },
    pressed: { backgroundColor: theme.colors.surface.inset },
    // The row a mounted Details resource is showing stays visibly the selected
    // one, so a wide layout never leaves the list and the pane disagreeing.
    selected: { backgroundColor: theme.colors.surface.selected },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: theme.colors.text.primary },
    recentAuthors: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6 },
    recentAuthorAvatar: { borderRadius: 16, borderWidth: 2, borderColor: theme.colors.surface.base },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.accent.blue },
    meta: { color: theme.colors.text.secondary, fontSize: 12 },
}));

type SessionDiscussionRecentAuthorPresentation = Readonly<{
    accountId: string;
    imageUrl: string | null;
    label: string;
}>;

function buildSessionDiscussionRecentAuthorPresentations(
    discussion: SessionDiscussionOpenedSummaryV1,
): readonly SessionDiscussionRecentAuthorPresentation[] {
    const latestActor = discussion.latestMessage.accountActor;
    return discussion.recentAuthorAccountIds.map((accountId) => {
        if (latestActor?.accountId === accountId && latestActor.accountId === discussion.latestMessage.authorAccountId) {
            return {
                accountId,
                imageUrl: latestActor.profile?.avatarUrl ?? null,
                label: latestActor.profile === null
                    ? t('message.accountActorFormerMember')
                    : formatAccountDisplayName(latestActor.profile) ?? t('message.accountActorUnnamedMember'),
            };
        }
        return {
            accountId,
            imageUrl: null,
            label: t('session.collaboration.discussion.collaborator'),
        };
    });
}

export function buildSessionDiscussionRowMeta(input: Readonly<{
    unreadCount: number;
    unreadMentionCount: number;
    messageCount: number;
    producedByAgent: boolean;
    relativeTime: string;
    labels: Readonly<{
        unread: (count: number) => string;
        mentions: (count: number) => string;
        messages: (count: number) => string;
        viaAgent: string;
        collaborator: string;
    }>;
}>): readonly string[] {
    return [
        input.unreadMentionCount > 0 ? input.labels.mentions(input.unreadMentionCount) : '',
        input.unreadCount > 0 ? input.labels.unread(input.unreadCount) : '',
        input.labels.messages(input.messageCount),
        input.producedByAgent ? input.labels.viaAgent : input.labels.collaborator,
        input.relativeTime,
    ].filter((value) => value.length > 0);
}

export function buildSessionDiscussionRowAccessibilityLabel(input: Readonly<{
    title: string;
    visualMeta: readonly string[];
    unreadMentionCount: number;
    mentionLabel: (count: number) => string;
}>): string {
    const accessibleMeta = input.visualMeta.map((item, index) => (
        index === 0 && input.unreadMentionCount > 0
            ? input.mentionLabel(input.unreadMentionCount)
            : item
    ));
    return `${input.title}. ${accessibleMeta.join(', ')}`;
}

export function SessionDiscussionRow(props: Readonly<{
    discussion: SessionDiscussionOpenedSummaryV1;
    onPress: () => void;
    selected?: boolean;
}>): React.ReactElement {
    const title = props.discussion.title ?? t('session.collaboration.discussion.encryptedTitle');
    const recentAuthors = buildSessionDiscussionRecentAuthorPresentations(props.discussion);
    const meta = buildSessionDiscussionRowMeta({
        unreadCount: props.discussion.unreadCount,
        unreadMentionCount: props.discussion.unreadMentionCount,
        messageCount: props.discussion.messageSeq,
        producedByAgent: props.discussion.latestMessage.producerV1 !== null,
        relativeTime: formatShortRelativeTime(props.discussion.latestMessage.createdAt),
        labels: {
            unread: (count) => t('session.collaboration.discussion.unreadCount', { count }),
            mentions: (count) => t('session.collaboration.discussion.unreadMentionCount', { count }),
            messages: (count) => t('session.collaboration.discussion.messageCount', { count }),
            viaAgent: t('session.collaboration.discussion.viaAgent'),
            collaborator: t('session.collaboration.discussion.collaborator'),
        },
    });
    return (
        <Pressable
            testID={`session-discussion-row-${props.discussion.id}`}
            accessibilityRole="button"
            accessibilityLabel={buildSessionDiscussionRowAccessibilityLabel({
                title,
                visualMeta: meta,
                unreadMentionCount: props.discussion.unreadMentionCount,
                mentionLabel: (count) => t('session.collaboration.discussion.unreadMentionCount', { count }),
            })}
            accessibilityState={{ selected: props.selected ?? false }}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.root,
                props.selected ? styles.selected : null,
                pressed ? styles.pressed : null,
            ]}
        >
            <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={2}>{title}</Text>
                {recentAuthors.length > 0 ? <View
                    testID={`session-discussion-row-recent-authors-${props.discussion.id}`}
                    accessible
                    accessibilityLabel={recentAuthors.map((author) => author.label).join(', ')}
                    style={styles.recentAuthors}
                >
                    {recentAuthors.map((author, index) => <View
                        key={author.accountId}
                        testID={`session-discussion-row-recent-author-${props.discussion.id}-${author.accountId}`}
                        accessible={false}
                        importantForAccessibility="no-hide-descendants"
                        style={[styles.recentAuthorAvatar, { marginLeft: index === 0 ? 0 : -7 }]}
                    >
                        <Avatar id={author.accountId} imageUrl={author.imageUrl} size={20} />
                    </View>)}
                </View> : null}
                {props.discussion.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text style={styles.meta} numberOfLines={1}>{meta.join(' · ')}</Text>
        </Pressable>
    );
}
