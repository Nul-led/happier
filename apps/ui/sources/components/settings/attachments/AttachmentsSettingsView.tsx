import React from 'react';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Modal } from '@/modal';
import { t, type TranslationKeyNoParams } from '@/text';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Switch } from '@/components/ui/forms/Switch';
import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { SettingAnchor, SettingRow } from '@/components/settings/shell/SettingRow';
import { ATTACHMENTS_SETTINGS } from '@/components/settings/attachments/attachmentsSettings';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';

const UPLOAD_LOCATION_OPTIONS: ReadonlyArray<{
    id: 'workspace' | 'os_temp';
    labelKey: TranslationKeyNoParams;
    subtitleKey: TranslationKeyNoParams;
}> = [
    {
        id: 'workspace',
        labelKey: 'settingsAttachments.uploadLocation.options.workspace.short',
        subtitleKey: 'settingsAttachments.uploadLocation.options.workspace.subtitle',
    },
    {
        id: 'os_temp',
        labelKey: 'settingsAttachments.uploadLocation.options.osTemp.short',
        subtitleKey: 'settingsAttachments.uploadLocation.options.osTemp.subtitle',
    },
];

const VCS_IGNORE_OPTIONS: ReadonlyArray<{
    id: 'git_info_exclude' | 'gitignore' | 'none';
    labelKey: TranslationKeyNoParams;
    subtitleKey: TranslationKeyNoParams;
}> = [
    {
        id: 'git_info_exclude',
        labelKey: 'settingsAttachments.sourceControlIgnore.options.gitInfoExclude.short',
        subtitleKey: 'settingsAttachments.sourceControlIgnore.options.gitInfoExclude.subtitle',
    },
    {
        id: 'gitignore',
        labelKey: 'settingsAttachments.sourceControlIgnore.options.gitignore.short',
        subtitleKey: 'settingsAttachments.sourceControlIgnore.options.gitignore.subtitle',
    },
    {
        id: 'none',
        labelKey: 'settingsAttachments.sourceControlIgnore.options.none.short',
        subtitleKey: 'settingsAttachments.sourceControlIgnore.options.none.subtitle',
    },
];

/** "25 MB" for a byte count on a whole binary unit, otherwise the exact byte count. */
function formatByteSize(bytes: number): string {
    const units = ['KB', 'MB', 'GB'] as const;
    let value = bytes;
    let unit: string = 'B';
    for (const next of units) {
        if (value < 1024 || value % 1024 !== 0) break;
        value /= 1024;
        unit = next;
    }
    return `${value.toLocaleString()} ${unit}`;
}

function normalizeWorkspaceRelativeDir(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return null;
    const parts = trimmed.split(/[\\/]+/g).filter(Boolean);
    if (parts.some((p) => p === '.' || p === '..')) return null;
    return parts.join('/');
}

function parsePositiveInt(input: string, opts: Readonly<{ min: number; max: number }>): number | null {
    const raw = Number(input);
    if (!Number.isFinite(raw)) return null;
    const rounded = Math.floor(raw);
    if (rounded < opts.min || rounded > opts.max) return null;
    return rounded;
}

export const AttachmentsSettingsView = React.memo(function AttachmentsSettingsView() {
    const attachmentsEnabled = useFeatureEnabled('attachments.uploads');

    const [uploadLocation, setUploadLocation] = useSettingMutable('attachmentsUploadsUploadLocation');
    const [workspaceRelativeDir, setWorkspaceRelativeDir] = useSettingMutable('attachmentsUploadsWorkspaceRelativeDir');
    const [vcsIgnoreStrategy, setVcsIgnoreStrategy] = useSettingMutable('attachmentsUploadsVcsIgnoreStrategy');
    const [vcsIgnoreWritesEnabled, setVcsIgnoreWritesEnabled] = useSettingMutable('attachmentsUploadsVcsIgnoreWritesEnabled');
    const [maxFileBytes, setMaxFileBytes] = useSettingMutable('attachmentsUploadsMaxFileBytes');

    const effectiveUploadLocation = uploadLocation === 'os_temp' ? 'os_temp' : 'workspace';
    const effectiveIgnoreStrategy =
        vcsIgnoreStrategy === 'gitignore' || vcsIgnoreStrategy === 'none' ? vcsIgnoreStrategy : 'git_info_exclude';
    const effectiveWorkspaceRelativeDir = typeof workspaceRelativeDir === 'string' && workspaceRelativeDir.trim().length > 0
        ? workspaceRelativeDir.trim()
        : '.happier/uploads';

    if (!attachmentsEnabled) {
        return (
            <ItemList style={{ paddingTop: 0 }} presentation="page">
                <SettingsPageHeader description={t('settingsAttachments.pageDescription')} />
                <AttentionBanner
                    testID="settings-attachments-disabled"
                    tone="neutral"
                    title={t('settingsAttachments.disabled.bannerTitle')}
                    description={t('settingsAttachments.disabled.footer')}
                />
            </ItemList>
        );
    }

    const promptUploadsDirectory = async () => {
        const raw = await Modal.prompt(
            t('settingsAttachments.workspaceDirectory.uploadsDirectory.promptTitle'),
            t('settingsAttachments.workspaceDirectory.uploadsDirectory.promptMessage'),
            { placeholder: effectiveWorkspaceRelativeDir },
        );
        if (raw === null) return;
        const normalized = normalizeWorkspaceRelativeDir(raw);
        if (!normalized) {
            Modal.alert(t('settingsAttachments.workspaceDirectory.uploadsDirectory.invalidDirectoryTitle'), t('settingsAttachments.workspaceDirectory.uploadsDirectory.invalidDirectoryMessage'));
            return;
        }
        setWorkspaceRelativeDir(normalized);
    };

    return (
        <ItemList style={{ paddingTop: 0 }} presentation="page">
            <SettingsPageHeader description={t('settingsAttachments.pageDescription')} />
            <ItemGroup
                title={t('settingsAttachments.uploadLocation.title')}
                description={t('settingsAttachments.uploadLocation.footer')}
            >
                <SettingAnchor setting={ATTACHMENTS_SETTINGS.settings.uploadLocation}>
                    <SegmentedChoiceItem<'workspace' | 'os_temp'>
                        testID="settings-attachments-upload-location"
                        testIDPrefix="settings-attachments-upload-location"
                        title={t(ATTACHMENTS_SETTINGS.settings.uploadLocation.titleKey)}
                        subtitleLines={0}
                        value={effectiveUploadLocation}
                        onChange={setUploadLocation}
                        options={UPLOAD_LOCATION_OPTIONS.map((option) => ({
                            id: option.id,
                            label: t(option.labelKey),
                            description: t(option.subtitleKey),
                        }))}
                    />
                </SettingAnchor>
                <SettingRow
                    testID="settings-attachments-uploads-directory"
                    setting={ATTACHMENTS_SETTINGS.settings.uploadsDirectory}
                    // The directory applies only to workspace uploads; it stays editable so it is ready.
                    subtitle={effectiveUploadLocation === 'workspace'
                        ? effectiveWorkspaceRelativeDir
                        : `${effectiveWorkspaceRelativeDir} · ${t('settingsAttachments.workspaceDirectory.usedForWorkspace')}`}
                    subtitleLines={0}
                    onPress={() => { void promptUploadsDirectory(); }}
                />
            </ItemGroup>

            <ItemGroup
                title={t('settingsAttachments.sourceControlIgnore.title')}
                description={t('settingsAttachments.sourceControlIgnore.footer')}
            >
                <SettingAnchor setting={ATTACHMENTS_SETTINGS.settings.ignoreStrategy}>
                    <SegmentedChoiceItem<'git_info_exclude' | 'gitignore' | 'none'>
                        testID="settings-attachments-ignore-strategy"
                        testIDPrefix="settings-attachments-ignore-strategy"
                        title={t(ATTACHMENTS_SETTINGS.settings.ignoreStrategy.titleKey)}
                        subtitleLines={0}
                        value={effectiveIgnoreStrategy}
                        onChange={setVcsIgnoreStrategy}
                        options={VCS_IGNORE_OPTIONS.map((option) => ({
                            id: option.id,
                            label: t(option.labelKey),
                            description: t(option.subtitleKey),
                        }))}
                    />
                </SettingAnchor>
                <SettingRow
                    testID="settings-attachments-write-ignore-rules"
                    setting={ATTACHMENTS_SETTINGS.settings.writeIgnoreRules}
                    showChevron={false}
                    rightElement={(
                        <Switch
                            value={vcsIgnoreWritesEnabled !== false}
                            onValueChange={(value) => setVcsIgnoreWritesEnabled(Boolean(value))}
                        />
                    )}
                />
            </ItemGroup>

            <ItemGroup title={t('settingsAttachments.limits.title')} description={t('settingsAttachments.limits.footer')}>
                <SettingRow
                    testID="settings-attachments-max-size"
                    setting={ATTACHMENTS_SETTINGS.settings.maxAttachmentSize}
                    subtitle={typeof maxFileBytes === 'number' ? formatByteSize(maxFileBytes) : t('common.default')}
                    onPress={async () => {
                        const raw = await Modal.prompt(
                            t('settingsAttachments.limits.maxAttachmentSize.promptTitle'),
                            t('settingsAttachments.limits.maxAttachmentSize.promptMessage'),
                            { placeholder: typeof maxFileBytes === 'number' ? String(maxFileBytes) : '26214400' },
                        );
                        if (raw === null) return;
                        const parsed = parsePositiveInt(raw, { min: 1024, max: 1024 * 1024 * 1024 });
                        if (parsed == null) {
                            Modal.alert(t('settingsAttachments.limits.invalidValueTitle'), t('settingsAttachments.limits.maxAttachmentSize.invalidValueMessage'));
                            return;
                        }
                        setMaxFileBytes(parsed);
                    }}
                />
            </ItemGroup>
        </ItemList>
    );
});
