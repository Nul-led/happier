import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { SessionResponsibilityCandidateV1 } from '@happier-dev/protocol';

import { formatSessionResponsibilityName } from '@/components/sessions/responsibility/formatSessionResponsibilityName';
import { formatSessionResponsibilityAccessHint } from '@/components/sessions/responsibility/formatSessionResponsibilityAccessHint';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import {
    CommandMenu,
    resolveCommandMenuComboboxAccessibility,
    useCommandMenuKeyboard,
    type CommandMenuAnchor,
    type CommandMenuItem,
} from '@/components/ui/commandMenu';
import {
    MultiTextInput,
    type MultiTextInputHandle,
    type MultiTextInputSubmitBehavior,
} from '@/components/ui/forms/MultiTextInput';
import { Text } from '@/components/ui/text/Text';
import type { SessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { listSessionDiscussionMentionCandidates } from '@/sync/api/session/sessionDiscussionActions';
import { useSetting } from '@/sync/store/hooks';
import { t } from '@/text';
import { useTextInputCaretRect } from '@/hooks/ui/textInputCaretRect';
import {
    reportSessionDiscussionTypingEdit,
    stopSessionDiscussionTyping,
} from '@/sync/domains/session/humanPresence/sessionHumanPresenceRuntime';

import {
    buildSessionDiscussionContent,
    buildSessionDiscussionContentFromPendingText,
    insertDiscussionMention,
    readActiveDiscussionMentionQuery,
    reconcileDiscussionMentionSpans,
    type DiscussionMentionSpan,
} from './discussionComposerDocument';

const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    root: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
    },
    editorRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
    },
    editorFrame: {
        flex: 1,
        minWidth: 0,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 14,
        backgroundColor: theme.colors.surface.inset,
        overflow: 'hidden',
    },
    suggestionRow: { minHeight: minimumInteractiveTargetSize, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
    suggestionText: { flex: 1, minWidth: 0 },
    suggestionName: {
        color: theme.colors.text.primary,
        fontWeight: '600',
    },
    suggestionUsername: {
        color: theme.colors.text.secondary,
    },
    suggestionContext: { color: theme.colors.text.secondary },
}));

export type SessionDiscussionComposerValue = Readonly<{
    text: string;
    mentions: readonly DiscussionMentionSpan[];
}>;

export function SessionDiscussionComposer(props: Readonly<{
    scope: ServerAccountScope;
    address: SessionAddress;
    discussionId?: string;
    availability: SessionCollaborationAvailability;
    value: SessionDiscussionComposerValue;
    onChange: (value: SessionDiscussionComposerValue) => void;
    disabled: boolean;
    autoFocus?: boolean;
    onSend: (content: ReturnType<typeof buildSessionDiscussionContent>) => void;
}>): React.ReactElement {
    const inputRef = React.useRef<MultiTextInputHandle>(null);
    const editorAnchorRef = React.useRef<View>(null);
    const [selection, setSelection] = React.useState({
        start: props.value.text.length,
        end: props.value.text.length,
    });
    const [candidates, setCandidates] = React.useState<readonly SessionResponsibilityCandidateV1[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [candidateState, setCandidateState] = React.useState<'idle' | 'loading' | 'error'>('idle');
    const [candidateRetryRevision, setCandidateRetryRevision] = React.useState(0);
    const [selectedCandidateIndex, setSelectedCandidateIndex] = React.useState(0);
    const loadMoreAbortRef = React.useRef<AbortController | null>(null);
    const agentInputEnterToSend = useSetting('agentInputEnterToSend');
    const agentInputEnterToSendNative = useSetting('agentInputEnterToSendNative');
    const enterToSendEnabled = Platform.OS === 'web'
        ? agentInputEnterToSend === true
        : agentInputEnterToSendNative === true;
    const query = readActiveDiscussionMentionQuery(props.value.text, selection.start);
    const mentionTriggerKey = query === null
        ? null
        : `${query.start}:${selection.start}:${query.query}:${props.value.text.length}`;
    const [dismissedMentionTriggerKey, setDismissedMentionTriggerKey] = React.useState<string | null>(null);
    React.useEffect(() => {
        if (dismissedMentionTriggerKey !== null && dismissedMentionTriggerKey !== mentionTriggerKey) {
            setDismissedMentionTriggerKey(null);
        }
    }, [dismissedMentionTriggerKey, mentionTriggerKey]);
    const mentionMenuOpen = query !== null
        && mentionTriggerKey !== dismissedMentionTriggerKey
        && props.availability === 'full_collaboration'
        && !props.disabled;

    React.useEffect(() => {
        loadMoreAbortRef.current?.abort();
        loadMoreAbortRef.current = null;
        if (!query || props.availability !== 'full_collaboration') {
            setCandidates([]);
            setNextCursor(null);
            setCandidateState('idle');
            return;
        }
        const controller = new AbortController();
        setCandidateState('loading');
        void listSessionDiscussionMentionCandidates({
            scope: props.scope,
            session: props.address,
            availability: props.availability,
            ...(query.query ? { query: query.query } : {}),
            signal: controller.signal,
        }).then((result) => {
            if (controller.signal.aborted) return;
            setCandidates(result.candidates);
            setNextCursor(result.nextCursor);
            setCandidateState('idle');
            setSelectedCandidateIndex(0);
        }).catch(() => {
            if (controller.signal.aborted) return;
            setCandidates([]);
            setNextCursor(null);
            setCandidateState('error');
        });
        return () => controller.abort();
    }, [candidateRetryRevision, props.address, props.availability, props.scope, query?.query, query?.start]);

    React.useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

    const presenceTarget = React.useMemo(() => props.discussionId
        ? { serverId: props.address.serverId, sessionId: props.address.sessionId, discussionId: props.discussionId }
        : null, [props.address.serverId, props.address.sessionId, props.discussionId]);
    React.useEffect(() => {
        if (props.disabled && presenceTarget) stopSessionDiscussionTyping(presenceTarget);
    }, [presenceTarget, props.disabled]);
    React.useEffect(() => () => {
        if (presenceTarget) stopSessionDiscussionTyping(presenceTarget);
    }, [presenceTarget]);

    const changeText = React.useCallback((text: string) => {
        if (presenceTarget) reportSessionDiscussionTypingEdit(presenceTarget, text.trim().length > 0);
        props.onChange({
            text,
            mentions: reconcileDiscussionMentionSpans({
                previousText: props.value.text,
                nextText: text,
                mentions: props.value.mentions,
            }),
        });
    }, [presenceTarget, props]);

    const selectCandidate = React.useCallback((candidate: SessionResponsibilityCandidateV1) => {
        if (!query) return;
        const visibleToken = `@${formatSessionResponsibilityName(candidate.profile)}`;
        const nextValue = insertDiscussionMention({
            text: props.value.text,
            mentions: props.value.mentions,
            queryStart: query.start,
            selectionEnd: selection.end,
            visibleToken,
            accountId: candidate.accountId,
        });
        props.onChange({ text: nextValue.text, mentions: nextValue.mentions });
        inputRef.current?.setTextAndSelection(nextValue.text, nextValue.selection);
        setSelection(nextValue.selection);
        setCandidates([]);
        setNextCursor(null);
    }, [props, query, selection.end]);

    const loadMore = React.useCallback(() => {
        if (!query || !nextCursor || candidateState === 'loading') return;
        loadMoreAbortRef.current?.abort();
        const controller = new AbortController();
        loadMoreAbortRef.current = controller;
        setCandidateState('loading');
        void listSessionDiscussionMentionCandidates({
            scope: props.scope,
            session: props.address,
            availability: props.availability,
            ...(query.query ? { query: query.query } : {}),
            cursor: nextCursor,
            signal: controller.signal,
        }).then((result) => {
            if (controller.signal.aborted) return;
            setCandidates((current) => [
                ...current,
                ...result.candidates.filter((candidate) => !current.some((item) => item.accountId === candidate.accountId)),
            ]);
            setNextCursor(result.nextCursor);
            setCandidateState('idle');
        }).catch(() => {
            if (!controller.signal.aborted) setCandidateState('error');
        });
    }, [candidateState, nextCursor, props.address, props.availability, props.scope, query]);

    const mentionItems = React.useMemo<readonly CommandMenuItem[]>(() => [
        ...candidates.map((candidate) => {
            const name = formatSessionResponsibilityName(candidate.profile);
            const hint = formatSessionResponsibilityAccessHint(candidate.accessHint);
            const context = [candidate.profile.username ? `@${candidate.profile.username}` : null, hint]
                .filter((part): part is string => part !== null)
                .join(' · ');
            return {
                id: `candidate:${candidate.accountId}`,
                label: name,
                aliases: candidate.profile.username ? [candidate.profile.username] : undefined,
                renderRow: () => (
                    <View style={styles.suggestionRow}>
                        <View testID={`session-discussion-mention-${candidate.accountId}-avatar`}>
                            <Avatar
                                id={candidate.accountId}
                                size={28}
                                imageUrl={candidate.profile.avatarUrl}
                            />
                        </View>
                        <View style={styles.suggestionText}>
                            <Text style={styles.suggestionName} numberOfLines={1}>{name}</Text>
                            {context ? (
                                <Text
                                    testID={`session-discussion-mention-${candidate.accountId}-context`}
                                    style={styles.suggestionContext}
                                    numberOfLines={1}
                                >{context}</Text>
                            ) : null}
                        </View>
                    </View>
                ),
            } satisfies CommandMenuItem;
        }),
        ...(candidateState === 'error' ? [{ id: 'retry', label: t('session.collaboration.discussion.retry') }] : []),
        ...(nextCursor ? [{ id: 'more', label: t('common.moreActions') }] : []),
    ], [candidateState, candidates, nextCursor]);
    const moveCandidate = React.useCallback((delta: number) => {
        setSelectedCandidateIndex((current) => {
            if (mentionItems.length === 0) return -1;
            return (Math.max(0, current) + delta + mentionItems.length) % mentionItems.length;
        });
    }, [mentionItems.length]);
    const selectMentionItem = React.useCallback((item: CommandMenuItem) => {
        if (item.id === 'retry') {
            setCandidateRetryRevision((current) => current + 1);
            return;
        }
        if (item.id === 'more') {
            loadMore();
            return;
        }
        const candidate = candidates.find((entry) => item.id === `candidate:${entry.accountId}`);
        if (candidate) selectCandidate(candidate);
    }, [candidates, loadMore, selectCandidate]);
    const selectHighlightedMention = React.useCallback(() => {
        const item = mentionItems[selectedCandidateIndex] ?? mentionItems[0];
        if (item) selectMentionItem(item);
    }, [mentionItems, selectMentionItem, selectedCandidateIndex]);
    const { handleKey: handleMentionMenuKey } = useCommandMenuKeyboard({
        open: mentionMenuOpen,
        onMoveUp: () => moveCandidate(-1),
        onMoveDown: () => moveCandidate(1),
        onSelect: selectHighlightedMention,
        onClose: () => {
            setDismissedMentionTriggerKey(mentionTriggerKey);
            setCandidates([]);
            setNextCursor(null);
        },
    });
    const caretRect = useTextInputCaretRect({ inputRef, selection, enabled: mentionMenuOpen });
    const mentionMenuAnchor = React.useMemo<CommandMenuAnchor>(() => caretRect
        ? { kind: 'rect', rect: { left: caretRect.left, top: caretRect.top, height: caretRect.height }, coordinateSpace: 'window' }
        : { kind: 'view', ref: editorAnchorRef }, [caretRect]);
    const mentionCombobox = React.useMemo(() => resolveCommandMenuComboboxAccessibility({
        testID: 'session-discussion-mention-command-menu',
        items: mentionItems,
        selectedIndex: selectedCandidateIndex,
    }), [mentionItems, selectedCandidateIndex]);

    const send = React.useCallback(() => {
        const text = inputRef.current?.flushPendingTextChange() ?? props.value.text;
        if (props.disabled || text.trim().length === 0) return;
        if (presenceTarget) stopSessionDiscussionTyping(presenceTarget);
        props.onSend(buildSessionDiscussionContentFromPendingText({
            previousText: props.value.text,
            pendingText: text,
            mentions: props.value.mentions,
        }));
    }, [presenceTarget, props]);

    const submitBehavior = React.useMemo<MultiTextInputSubmitBehavior | undefined>(() => {
        if (Platform.OS === 'web') return undefined;
        return enterToSendEnabled ? 'submit' : 'newline';
    }, [enterToSendEnabled]);

    return (
        <View style={styles.root} testID="session-discussion-composer-root">
            <View style={styles.editorRow}>
                <View ref={editorAnchorRef} style={styles.editorFrame}>
                    <MultiTextInput
                        ref={inputRef}
                        testID="session-discussion-composer"
                        value={props.value.text}
                        onChangeText={changeText}
                        onSelectionChange={setSelection}
                        onKeyPress={handleMentionMenuKey}
                        placeholder={t('session.collaboration.discussion.messagePlaceholder')}
                        accessibilityLabel={t('session.collaboration.discussion.messagePlaceholder')}
                        editable={!props.disabled}
                        autoFocus={props.autoFocus}
                        maxHeight={160}
                        paddingTop={10}
                        paddingBottom={10}
                        paddingLeft={12}
                        paddingRight={12}
                        submitBehavior={submitBehavior}
                        onSubmitEditing={send}
                        onBlur={() => { if (presenceTarget) stopSessionDiscussionTyping(presenceTarget); }}
                        accessibilityRole="combobox"
                        accessibilityState={{ expanded: mentionMenuOpen }}
                        aria-haspopup="listbox"
                        aria-autocomplete="list"
                        aria-controls={mentionCombobox.listboxId}
                        {...(mentionMenuOpen && mentionCombobox.activeDescendantId
                            ? { 'aria-activedescendant': mentionCombobox.activeDescendantId }
                            : {})}
                    />
                </View>
                <IconButton
                    testID="session-discussion-send"
                    iconName="arrow-up"
                    tone="primary"
                    size={36}
                    minimumInteractiveTargetSize={minimumInteractiveTargetSize}
                    interactiveTargetGapPx={10}
                    accessibilityLabel={t('common.send')}
                    disabled={props.disabled || props.value.text.trim().length === 0}
                    onPress={send}
                />
            </View>
            <CommandMenu
                open={mentionMenuOpen}
                anchor={mentionMenuAnchor}
                placement="top"
                query={query?.query ?? ''}
                items={mentionItems}
                selectedIndex={selectedCandidateIndex}
                onMoveUp={() => moveCandidate(-1)}
                onMoveDown={() => moveCandidate(1)}
                onSelect={selectMentionItem}
                onRequestClose={() => {
                    setDismissedMentionTriggerKey(mentionTriggerKey);
                    setCandidates([]);
                    setNextCursor(null);
                }}
                emptyStateLabel={candidateState === 'loading'
                    ? t('common.loading')
                    : t('session.responsibilityNoCandidates')}
                maxHeight={224}
                testID="session-discussion-mention-command-menu"
            />
        </View>
    );
}
