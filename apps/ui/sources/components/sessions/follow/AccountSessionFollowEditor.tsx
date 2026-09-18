import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import {
    projectAccountSessionFollowEditorStateV1,
    type SessionFollowNotificationLevel,
    type SetSessionFollowRequest,
} from '@happier-dev/protocol';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

import type { AccountSessionFollowEditorSnapshot } from './accountSessionFollowController';
import type { AccountVoiceFollowReadiness } from './accountVoiceFollowReadiness';

export type AccountSessionFollowEditorProps = Readonly<{
    state: AccountSessionFollowEditorSnapshot;
    voiceReadiness: AccountVoiceFollowReadiness;
    archived: boolean;
    onSet(preferences: SetSessionFollowRequest): void;
    onRemove(): void;
    onRetry(): void;
    onOpenNotificationSettings(): void;
}>;

const LEVELS = ['none', 'important', 'all_messages'] as const;

export function AccountSessionFollowEditor(props: AccountSessionFollowEditorProps) {
    const { theme } = useUnistyles();
    const { state } = props;
    const isSessionOwner = state.projection?.isSessionOwner === true;
    // Effective state, not the raw row: a Session owner with no stored choice is
    // permanently tracked and Important-eligible at the Home.
    const effective = state.projection
        ? projectAccountSessionFollowEditorStateV1({ follow: state.projection.follow, isSessionOwner })
        : null;
    const following = effective?.tracked === true;
    const preferences = state.draft ?? (effective && effective.tracked
        ? { notificationLevel: effective.notificationLevel, includeInVoice: effective.includeInVoice }
        : { notificationLevel: 'important' as const, includeInVoice: false });
    const canManage = state.projection?.capabilities.manageFollow === true;
    const canEdit = canManage && !props.archived;
    const disabled = !state.online || state.saving || !canEdit;
    const voiceReadiness = props.voiceReadiness;
    // `eligible` is the nominal case the row subtitle already describes, so it has
    // no status line: repeating that sentence directly beneath itself would spend a
    // row saying nothing new.
    const voiceDeliveryTitle = voiceReadiness === 'waiting_for_runtime'
        ? t('session.follow.voice.waitingRuntime')
        : voiceReadiness === 'waiting_encrypted'
            ? t('session.follow.voice.waitingEncrypted')
            : voiceReadiness === 'runtime_unsupported'
                ? t('session.follow.voice.unsupported')
                : voiceReadiness === 'provider_withheld'
                    ? t('session.follow.voice.providerWithheld')
                    : voiceReadiness === 'pending'
                        ? t('session.follow.voice.initialSnapshotPending')
                        : null;
    const error = state.error === 'session_not_found'
        ? t('session.follow.accessLost')
        : state.error === 'session_archived'
            ? t('session.follow.archived')
            : state.error === 'feature_unavailable' || state.error === 'account_inactive'
                ? t('common.unavailable')
                : t('errors.unknownError');

    return <>
        <ItemGroup footer={t('session.follow.footer')}>
            {isSessionOwner ? <Item
                testID="session-follow-owner-row"
                title={t('session.follow.following')}
                subtitle={props.archived ? t('session.follow.archived') : t('session.follow.editor.ownerSubtitle')}
                titleLines={0}
                showChevron={false}
                mode="info"
            /> : <Item
                testID="session-follow-enabled-row"
                title={t('session.follow.editor.title')}
                subtitle={props.archived ? t('session.follow.archived') : t('session.follow.editor.subtitle')}
                titleLines={0}
                showChevron={false}
                rightElement={<Switch
                    testID="session-follow-enabled"
                    value={following}
                    disabled={!state.online || state.saving || !state.projection || !canManage || (props.archived && !following)}
                    onValueChange={(enabled) => {
                        if (props.archived && enabled) return;
                        if (enabled) props.onSet({ notificationLevel: 'important', includeInVoice: false });
                        else props.onRemove();
                    }}
                />}
            />}
        </ItemGroup>
        {state.loading && !state.projection ? <ItemGroup>
            <Item title={t('common.loading')} loading showChevron={false} mode="info" />
        </ItemGroup> : null}
        {!state.online || state.error ? <ItemGroup>
            <Item
                testID="session-follow-error"
                title={!state.online ? t('session.follow.offline') : error}
                mode="info"
                titleLines={0}
                accessibilityLiveRegion="polite"
                showChevron={false}
            />
            {state.online ? <Item testID="session-follow-retry" title={t('common.retry')} onPress={props.onRetry} showChevron={false} /> : null}
        </ItemGroup> : null}
        {following ? <>
            <ItemGroup title={t('session.follow.notifications')} accessibilityRole="radiogroup" accessibilityLabel={t('session.follow.notifications')}>
                {LEVELS.map((level: SessionFollowNotificationLevel) => <Item
                    key={level}
                    testID={`session-follow-level-${level}`}
                    title={t(`session.follow.level.${level}`)}
                    titleLines={0}
                    accessibilityRole="radio"
                    selected={preferences.notificationLevel === level}
                    disabled={disabled}
                    showChevron={false}
                    onPress={() => props.onSet({ ...preferences, notificationLevel: level })}
                    rightElement={preferences.notificationLevel === level
                        ? <Icon name="check" size={20} color={theme.colors.text.primary} />
                        : undefined}
                />)}
            </ItemGroup>
            <ItemGroup>
                <Item
                    title={t('session.follow.voice.title')}
                    subtitle={t('session.follow.voice.subtitle')}
                    titleLines={0}
                    showChevron={false}
                    rightElement={<Switch
                        testID="session-follow-voice"
                        value={preferences.includeInVoice}
                        disabled={disabled}
                        onValueChange={(includeInVoice) => props.onSet({ ...preferences, includeInVoice })}
                    />}
                />
                {preferences.includeInVoice && voiceDeliveryTitle ? <Item
                    testID="session-follow-voice-delivery"
                    title={voiceDeliveryTitle}
                    mode="info"
                    titleLines={0}
                    accessibilityLiveRegion="polite"
                /> : null}
            </ItemGroup>
        </> : null}
        <ItemGroup>
            <Item title={t('session.follow.settingsLink')} onPress={props.onOpenNotificationSettings} />
        </ItemGroup>
    </>;
}
