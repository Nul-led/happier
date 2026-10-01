import * as React from 'react';

import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Modal } from '@/modal';
import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { NOTIFICATIONS_SETTINGS } from '@/components/settings/notifications/notificationsSettings';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import {
    hasConfiguredSecretStringValue,
    type NotificationChannelV1,
    type WebhookNotificationChannelV1,
} from '@happier-dev/protocol';

import {
    addWebhookNotificationChannel,
    removeNotificationChannelById,
    updateNotificationChannelById,
} from './notificationChannels';

type NotificationWebhooksSectionProps = Readonly<{
    webhookChannels: ReadonlyArray<WebhookNotificationChannelV1>;
    setWebhookChannels: (nextChannels: ReadonlyArray<NotificationChannelV1>) => void;
}>;

export function NotificationWebhooksSection({
    webhookChannels,
    setWebhookChannels,
}: NotificationWebhooksSectionProps): React.ReactElement {
    const { theme } = useUnistyles();
    // A webhook's settings open in place; a newly added one opens so it can be configured.
    const [expandedChannelId, setExpandedChannelId] = React.useState<string | null>(null);

    const promptWebhookUrl = React.useCallback(async (defaultValue?: string) => {
        const raw = await Modal.prompt(
            t('settingsNotifications.webhooks.urlPromptTitle'),
            t('settingsNotifications.webhooks.urlPromptSubtitle'),
            {
                defaultValue,
                placeholder: t('settingsNotifications.webhooks.urlPromptPlaceholder'),
                confirmText: defaultValue ? t('common.save') : t('common.add'),
                cancelText: t('common.cancel'),
            },
        );
        const nextUrl = raw?.trim();
        if (!nextUrl) {
            return null;
        }

        try {
            const parsed = new URL(nextUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error('unsupported protocol');
            }
            return nextUrl;
        } catch {
            await Modal.alert(
                t('settingsNotifications.webhooks.invalidUrlTitle'),
                t('settingsNotifications.webhooks.invalidUrlSubtitle'),
            );
            return null;
        }
    }, []);

    const promptWebhookSigningSecret = React.useCallback(async (channel: WebhookNotificationChannelV1) => {
        const raw = await Modal.prompt(
            t('settingsNotifications.webhooks.signingSecretPromptTitle'),
            hasConfiguredSecretStringValue(channel.signingSecret)
                ? t('settingsNotifications.webhooks.signingSecretPromptSubtitleReplace')
                : t('settingsNotifications.webhooks.signingSecretPromptSubtitleAdd'),
            {
                placeholder: t('settingsNotifications.webhooks.signingSecretPromptPlaceholder'),
                confirmText: t('common.save'),
                cancelText: t('common.cancel'),
                inputType: 'secure-text',
            },
        );
        const nextSecret = raw?.trim();
        return nextSecret ? { _isSecretValue: true as const, value: nextSecret } : null;
    }, []);

    const handleAddWebhook = React.useCallback(async () => {
        const url = await promptWebhookUrl();
        if (!url) {
            return;
        }

        const nextChannels = addWebhookNotificationChannel({
            channels: webhookChannels,
            url,
        });
        setWebhookChannels(nextChannels);
        const added = nextChannels.find((channel) => !webhookChannels.some((existing) => existing.id === channel.id));
        if (added) setExpandedChannelId(added.id);
    }, [promptWebhookUrl, setWebhookChannels, webhookChannels]);

    const handleEditWebhook = React.useCallback(async (channel: WebhookNotificationChannelV1) => {
        const url = await promptWebhookUrl(channel.url);
        if (!url) {
            return;
        }

        setWebhookChannels(updateNotificationChannelById({
            channels: webhookChannels,
            channelId: channel.id,
            patch: { url },
        }));
    }, [promptWebhookUrl, setWebhookChannels, webhookChannels]);

    const handleDeleteWebhook = React.useCallback(async (channel: WebhookNotificationChannelV1) => {
        const confirmed = await Modal.confirm(
            t('settingsNotifications.webhooks.deleteTitle'),
            t('settingsNotifications.webhooks.deleteConfirm', { url: channel.url }),
            {
                cancelText: t('common.cancel'),
                confirmText: t('common.delete'),
                destructive: true,
            },
        );
        if (!confirmed) {
            return;
        }

        setWebhookChannels(removeNotificationChannelById({
            channels: webhookChannels,
            channelId: channel.id,
        }));
    }, [setWebhookChannels, webhookChannels]);

    const handleSetWebhookSigningSecret = React.useCallback(async (channel: WebhookNotificationChannelV1) => {
        const signingSecret = await promptWebhookSigningSecret(channel);
        if (!signingSecret) {
            return;
        }

        setWebhookChannels(updateNotificationChannelById({
            channels: webhookChannels,
            channelId: channel.id,
            patch: { signingSecret },
        }));
    }, [promptWebhookSigningSecret, setWebhookChannels, webhookChannels]);

    const handleClearWebhookSigningSecret = React.useCallback(async (channel: WebhookNotificationChannelV1) => {
        const confirmed = await Modal.confirm(
            t('settingsNotifications.webhooks.signingSecretClearAction'),
            t('settingsNotifications.webhooks.signingSecretEmptySubtitle'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('settingsNotifications.webhooks.signingSecretClearAction'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        setWebhookChannels(updateNotificationChannelById({
            channels: webhookChannels,
            channelId: channel.id,
            patch: { signingSecret: null },
        }));
    }, [setWebhookChannels, webhookChannels]);

    const renderTopicSwitch = (
        channel: WebhookNotificationChannelV1,
        titleKey: 'readyTitle' | 'readyPreviewTitle' | 'requestPreviewTitle' | 'permissionRequestsTitle' | 'userActionsTitle',
        subtitleKey: 'readySubtitle' | 'readyPreviewSubtitle' | 'requestPreviewSubtitle' | 'permissionRequestsSubtitle' | 'userActionsSubtitle',
        value: boolean,
        disabled: boolean,
        patch: (enabled: boolean) => Partial<WebhookNotificationChannelV1>,
    ) => (
        <Item
            key={titleKey}
            testID={`settings-notifications-webhook-${channel.id}-${titleKey}`}
            title={t(`settingsNotifications.webhooks.${titleKey}`)}
            subtitle={t(`settingsNotifications.webhooks.${subtitleKey}`)}
            rightElement={(
                <Switch
                    value={value}
                    disabled={disabled}
                    onValueChange={(next) => setWebhookChannels(updateNotificationChannelById({
                        channels: webhookChannels,
                        channelId: channel.id,
                        patch: patch(Boolean(next)),
                    }))}
                />
            )}
            showChevron={false}
        />
    );

    return (
        <ItemGroup
            title={t('settingsNotifications.webhooks.title')}
            description={t('settingsNotifications.webhooks.footer')}
            action={(
                <SettingAnchor setting={NOTIFICATIONS_SETTINGS.settings.addWebhook}>
                    <RoundButton
                        testID="settings-notifications-add-webhook"
                        size="small"
                        display="inverted"
                        title={t(NOTIFICATIONS_SETTINGS.settings.addWebhook.titleKey)}
                        leading={<Icon name="plus" size={14} color={theme.colors.text.secondary} />}
                        onPress={() => { void handleAddWebhook(); }}
                    />
                </SettingAnchor>
            )}
        >
            {webhookChannels.length === 0 ? (
                <Item
                    title={t('settingsNotifications.webhooks.emptyTitle')}
                    subtitle={t('settingsNotifications.webhooks.emptySubtitle')}
                    subtitleLines={0}
                    mode="info"
                    showChevron={false}
                />
            ) : (
                webhookChannels.map((channel) => {
                    const channelEnabled = channel.enabled !== false;
                    const secretConfigured = hasConfiguredSecretStringValue(channel.signingSecret);
                    return (
                        <ExpandableItem
                            key={channel.id}
                            testID={`settings-notifications-webhook-${channel.id}-row`}
                            expanded={expandedChannelId === channel.id}
                            onExpandedChange={(next) => setExpandedChannelId(next ? channel.id : null)}
                            header={({ headerProps }) => (
                                <Item
                                    {...headerProps}
                                    testID={`settings-notifications-webhook-${channel.id}`}
                                    title={channel.url}
                                    subtitle={channelEnabled
                                        ? t('settingsNotifications.webhooks.enabledSubtitle')
                                        : t('settingsNotifications.webhooks.disabledSubtitle')}
                                />
                            )}
                        >
                            <Item
                                testID={`settings-notifications-webhook-${channel.id}-enabled`}
                                title={t('settingsNotifications.webhooks.enabledTitle')}
                                subtitle={t('settingsNotifications.webhooks.channelEnabledSubtitle')}
                                rightElement={(
                                    <Switch
                                        value={channelEnabled}
                                        onValueChange={(value) => setWebhookChannels(updateNotificationChannelById({
                                            channels: webhookChannels,
                                            channelId: channel.id,
                                            patch: { enabled: Boolean(value) },
                                        }))}
                                    />
                                )}
                                showChevron={false}
                            />
                            <Item
                                title={t('settingsNotifications.webhooks.urlPromptTitle')}
                                subtitle={channel.url}
                                showChevron={false}
                                rightElement={(
                                    <RoundButton
                                        testID={`settings-notifications-webhook-${channel.id}-edit`}
                                        size="small"
                                        display="inverted"
                                        title={t('common.edit')}
                                        onPress={() => { void handleEditWebhook(channel); }}
                                    />
                                )}
                            />
                            <Item
                                testID={`settings-notifications-webhook-${channel.id}-signing-secret`}
                                title={t('settingsNotifications.webhooks.signingSecretTitle')}
                                subtitle={secretConfigured
                                    ? t('settingsNotifications.webhooks.signingSecretConfiguredSubtitle')
                                    : t('settingsNotifications.webhooks.signingSecretEmptySubtitle')}
                                showChevron={false}
                                rightElement={(
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                        {secretConfigured ? (
                                            <RoundButton
                                                testID={`settings-notifications-webhook-${channel.id}-clear-secret`}
                                                size="small"
                                                display="inverted"
                                                title={t('settingsNotifications.webhooks.signingSecretClearAction')}
                                                onPress={() => { void handleClearWebhookSigningSecret(channel); }}
                                            />
                                        ) : null}
                                        <RoundButton
                                            testID={`settings-notifications-webhook-${channel.id}-set-secret`}
                                            size="small"
                                            display="secondary"
                                            title={secretConfigured
                                                ? t('settingsNotifications.webhooks.signingSecretReplaceAction')
                                                : t('settingsNotifications.webhooks.signingSecretAddAction')}
                                            onPress={() => { void handleSetWebhookSigningSecret(channel); }}
                                        />
                                    </View>
                                )}
                            />
                            {renderTopicSwitch(channel, 'readyTitle', 'readySubtitle',
                                channel.topics.ready !== false,
                                !channelEnabled,
                                (enabled) => ({ topics: { ...channel.topics, ready: enabled } }))}
                            {renderTopicSwitch(channel, 'readyPreviewTitle', 'readyPreviewSubtitle',
                                channel.readyIncludeMessageText !== false,
                                !channelEnabled || channel.topics.ready === false,
                                (enabled) => ({ readyIncludeMessageText: enabled }))}
                            {renderTopicSwitch(channel, 'requestPreviewTitle', 'requestPreviewSubtitle',
                                channel.requestIncludeMessageText === true,
                                !channelEnabled || (channel.topics.permissionRequest === false && channel.topics.userActionRequest === false),
                                (enabled) => ({ requestIncludeMessageText: enabled }))}
                            {renderTopicSwitch(channel, 'permissionRequestsTitle', 'permissionRequestsSubtitle',
                                channel.topics.permissionRequest !== false,
                                !channelEnabled,
                                (enabled) => ({ topics: { ...channel.topics, permissionRequest: enabled } }))}
                            {renderTopicSwitch(channel, 'userActionsTitle', 'userActionsSubtitle',
                                channel.topics.userActionRequest !== false,
                                !channelEnabled,
                                (enabled) => ({ topics: { ...channel.topics, userActionRequest: enabled } }))}
                            <SectionContentRow showDivider={false}>
                                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                                    <RoundButton
                                        testID={`settings-notifications-webhook-${channel.id}-delete`}
                                        size="small"
                                        display="destructive"
                                        title={t('settingsNotifications.webhooks.deleteTitle')}
                                        onPress={() => { void handleDeleteWebhook(channel); }}
                                    />
                                </View>
                            </SectionContentRow>
                        </ExpandableItem>
                    );
                })
            )}
        </ItemGroup>
    );
}
