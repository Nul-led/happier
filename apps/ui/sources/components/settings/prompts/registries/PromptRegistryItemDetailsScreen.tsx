import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type {
  PromptAssetInstallModeV1,
  PromptAssetScopeV1,
  PromptAssetTypeDescriptorV1,
  PromptRegistryConfiguredSourceV1,
  PromptRegistryFetchedItemV1,
} from '@happier-dev/protocol';

import { decodeBase64 } from '@/encryption/base64';
import { defaultPromptAssetTargetInput } from '@/components/settings/prompts/assets/promptAssetExportDefaults';
import { ContextBar } from '@/components/settings/contextBar/ContextBar';
import { useContextBarSelection } from '@/components/settings/contextBar/useContextBarSelection';
import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { Text } from '@/components/ui/text/Text';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { Modal } from '@/modal';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { machinePromptAssetsListTypes } from '@/sync/ops/machinePromptAssets';
import { machinePromptRegistriesDownloadItem } from '@/sync/ops/machinePromptRegistries';
import { installPromptRegistryItem } from '@/sync/ops/promptLibrary/installPromptRegistryItem';
import { createPromptRegistrySkillArtifactFromFetchedItem } from '@/sync/ops/promptLibrary/promptRegistrySkillImports';
import { translatePromptLibraryMessage } from '@/sync/ops/promptLibrary/translatePromptLibraryMessage';
import { MACHINE_ADMINISTRATION_SELECTION_KEYS_V1 } from '@/sync/domains/machines/administration/selectionPreferences';
import { useMachineAdministrationTargetSelection } from '@/sync/domains/machines/administration/useTargetSelection';
import { useMachineAdministrationExecutionTargetBinding } from '@/sync/domains/machines/administration/useExecutionTargetBinding';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import {
  listPromptAssetTypesForScope,
  resolvePromptAssetTypeSelection,
} from '@/components/settings/prompts/shared/promptAssetTypeSelection';
import {
  listPromptAssetInstallModesForType,
  resolvePromptAssetInstallModeSelection,
} from '@/components/settings/prompts/shared/promptAssetInstallModeSelection';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';

const styles = StyleSheet.create((theme) => ({
  previewText: {
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  previewEmpty: {
    color: theme.colors.text.secondary,
    fontSize: 14,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
}));


function decodeUtf8BundleEntry(item: PromptRegistryFetchedItemV1 | null, path: string): string | null {
  const entry = item?.bundleBody.entries.find((candidate) => candidate.path === path && candidate.contentKind === 'utf8') ?? null;
  if (!entry) return null;
  try {
    const bytes = decodeBase64(entry.contentBase64, 'base64');
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

export const PromptRegistryItemDetailsScreen = React.memo(function PromptRegistryItemDetailsScreen(props: Readonly<{
  sourceId: string;
  itemId: string;
  configuredSources: PromptRegistryConfiguredSourceV1[];
  title?: string | null;
  displayPath?: string | null;
  workspacePath?: string | null;
}>) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const administrationTargetSelection = useMachineAdministrationTargetSelection(
    MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.promptRegistries,
  );
  const selectedTarget = administrationTargetSelection.selectedTarget;
  const {
    selectionKey,
    resolveExactExecutionTarget,
    isExecutionTargetCurrent,
  } = useMachineAdministrationExecutionTargetBinding(administrationTargetSelection);
  const [promptExternalLinksV1, setPromptExternalLinksV1] = useSettingMutable('promptExternalLinksV1');
  const [item, setItem] = React.useState<PromptRegistryFetchedItemV1 | null>(null);
  const [installTypes, setInstallTypes] = React.useState<PromptAssetTypeDescriptorV1[]>([]);
  const [installScope, setInstallScope] = React.useState<PromptAssetScopeV1>('project');
  const [typeMenuOpen, setTypeMenuOpen] = React.useState(false);
  const [selectedInstallTypeId, setSelectedInstallTypeId] = React.useState<string | null>(null);
  const [installMode, setInstallMode] = React.useState<PromptAssetInstallModeV1 | null>(null);
  const [targetInput, setTargetInput] = React.useState('');
  const {
    workspacePath,
    setWorkspacePath,
  } = useContextBarSelection({
    selectionKey: `promptRegistries.details.install.${props.itemId}`,
    // This compatibility entry stores only workspace text. Administration owns
    // the exact machine/server target for every registry operation below.
    defaultMachineId: null,
    defaultWorkspacePath: props.workspacePath ?? '',
  });
  const previousSelectionKeyRef = React.useRef(selectionKey);

  React.useLayoutEffect(() => {
    const previousSelectionKey = previousSelectionKeyRef.current;
    previousSelectionKeyRef.current = selectionKey;
    if (!previousSelectionKey || previousSelectionKey === selectionKey) return;
    setWorkspacePath('');
  }, [selectionKey, setWorkspacePath]);

  React.useEffect(() => {
    setItem(null);
    setInstallTypes([]);
    setSelectedInstallTypeId(null);
  }, [selectionKey]);

  const loadItem = React.useCallback(async () => {
    const requestedSelection = selectionKey;
    const executionTarget = resolveExactExecutionTarget(selectedTarget);
    if (!executionTarget) return;
    const response = await machinePromptRegistriesDownloadItem(executionTarget.machine.id, {
      sourceId: props.sourceId,
      itemId: props.itemId,
      configuredSources: props.configuredSources,
    }, { serverId: executionTarget.serverId });
    if (!isExecutionTargetCurrent(requestedSelection, executionTarget)) return;
    if (!response.ok) {
      Modal.alert(t('common.error'), response.error);
      return;
    }
    setItem(response.item);
  }, [isExecutionTargetCurrent, props.configuredSources, props.itemId, props.sourceId, resolveExactExecutionTarget, selectedTarget, selectionKey]);

  const [loading, runLoad] = useHappyAction(loadItem);

  React.useEffect(() => {
    runLoad();
  }, [runLoad]);

  React.useEffect(() => {
    const requestedSelection = selectionKey;
    const executionTarget = resolveExactExecutionTarget(selectedTarget);
    if (!executionTarget) {
      setInstallTypes([]);
      setSelectedInstallTypeId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const listed = await machinePromptAssetsListTypes(executionTarget.machine.id, {
        serverId: executionTarget.serverId,
      });
      if (cancelled || !isExecutionTargetCurrent(requestedSelection, executionTarget) || !listed.ok) return;
      const nextTypes = listed.types.filter((entry) => entry.libraryKind === 'bundle' && entry.capabilities.supportsCatalogInstall === true);
      setInstallTypes(nextTypes);
    })().catch(() => {
      if (!cancelled) setInstallTypes([]);
    });

    return () => {
      cancelled = true;
    };
  }, [isExecutionTargetCurrent, resolveExactExecutionTarget, selectedTarget, selectionKey]);

  const scopeCompatibleInstallTypes = React.useMemo(
    () => listPromptAssetTypesForScope(installTypes, installScope),
    [installScope, installTypes],
  );

  React.useEffect(() => {
    setSelectedInstallTypeId((current) => resolvePromptAssetTypeSelection({
      types: installTypes,
      scope: installScope,
      selectedTypeId: current,
    }));
  }, [installScope, installTypes]);

  React.useEffect(() => {
    if (!item) return;
    setTargetInput((current) => current || defaultPromptAssetTargetInput({
      libraryKind: 'bundle',
      title: item.title,
    }));
  }, [item]);

  const installType = React.useMemo(
    () => scopeCompatibleInstallTypes.find((entry) => entry.id === selectedInstallTypeId) ?? null,
    [scopeCompatibleInstallTypes, selectedInstallTypeId],
  );

  const availableInstallModes = React.useMemo(
    () => listPromptAssetInstallModesForType(installType),
    [installType],
  );

  const installTypeItems = React.useMemo((): DropdownMenuItem[] => {
    return scopeCompatibleInstallTypes
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: entry.description,
        icon: <Icon name="stack-simple" size={20} color={theme.colors.text.secondary} />,
      }));
  }, [scopeCompatibleInstallTypes, theme.colors.text.secondary]);

  const installModeOptions = React.useMemo(() => availableInstallModes.map((entry) => ({
    id: entry,
    label: entry === 'symlink' ? t('promptLibrary.surface.installMethodLink') : t('promptLibrary.surface.installMethodCopy'),
    description: entry === 'symlink'
      ? t('promptLibrary.surface.installMethodLinkDescription')
      : t('promptLibrary.externalAssetsInstallMethodCopySubtitle'),
  })), [availableInstallModes]);

  const selectedInstallMode = React.useMemo(
    () => resolvePromptAssetInstallModeSelection({
      assetType: installType,
      selectedInstallMode: installMode,
    }),
    [installMode, installType],
  );

  const importItem = React.useCallback(async () => {
    if (!item || !resolveExactExecutionTarget(selectedTarget)) return;
    const imported = await createPromptRegistrySkillArtifactFromFetchedItem(item);
    if (!imported.ok) {
      Modal.alert(t('common.error'), translatePromptLibraryMessage(imported.error));
      return;
    }
    router.push(`/settings/prompts/skills/${imported.artifactId}`);
  }, [item, resolveExactExecutionTarget, router, selectedTarget]);

  const [importing, runImport] = useHappyAction(importItem);

  const installItem = React.useCallback(async () => {
    const requestedSelection = selectionKey;
    const executionTarget = resolveExactExecutionTarget(selectedTarget);
    if (!installType || !executionTarget) return;
    const resolvedInstallMode = selectedInstallMode;
    const preview = await installPromptRegistryItem({
      machineId: executionTarget.machine.id,
      serverId: executionTarget.serverId,
      configuredSources: props.configuredSources,
      sourceId: props.sourceId,
      itemId: props.itemId,
      installTarget: {
        assetTypeId: installType.id,
        scope: installScope,
        ...(installScope === 'project' && workspacePath.trim().length > 0 ? { directory: workspacePath.trim() } : {}),
        targetName: targetInput.trim(),
        installMode: resolvedInstallMode,
      },
      promptExternalLinks: promptExternalLinksV1,
      previewOnly: true,
    });
    if (!isExecutionTargetCurrent(requestedSelection, executionTarget)) return;
    if (!preview.ok) {
      Modal.alert(t('common.error'), translatePromptLibraryMessage(preview.error));
      if (preview.artifactId) {
        router.push(`/settings/prompts/skills/${preview.artifactId}`);
      }
      return;
    }

    const confirmed = await Modal.confirm(
      t('promptLibrary.registriesItemInstallConfirmTitle'),
      preview.response?.preview?.targetPath ?? t('promptLibrary.registriesItemInstallConfirmBody'),
      { confirmText: t('promptLibrary.registriesItemInstallAction') },
    );
    if (!confirmed) return;

    const committedExecutionTarget = resolveExactExecutionTarget(executionTarget.target);
    if (
      !committedExecutionTarget
      || !isExecutionTargetCurrent(requestedSelection, committedExecutionTarget)
    ) {
      return;
    }

    const installed = await installPromptRegistryItem({
      machineId: committedExecutionTarget.machine.id,
      serverId: committedExecutionTarget.serverId,
      configuredSources: props.configuredSources,
      sourceId: props.sourceId,
      itemId: props.itemId,
      installTarget: {
        assetTypeId: installType.id,
        scope: installScope,
        ...(installScope === 'project' && workspacePath.trim().length > 0 ? { directory: workspacePath.trim() } : {}),
        targetName: targetInput.trim(),
        installMode: resolvedInstallMode,
      },
      promptExternalLinks: promptExternalLinksV1,
      previewOnly: false,
    });
    if (!isExecutionTargetCurrent(requestedSelection, committedExecutionTarget)) return;
    if (!installed.ok) {
      Modal.alert(t('common.error'), translatePromptLibraryMessage(installed.error));
      if (installed.artifactId) {
        router.push(`/settings/prompts/skills/${installed.artifactId}`);
      }
      return;
    }
    setPromptExternalLinksV1(installed.nextPromptExternalLinks ?? { v: 1, links: [] });
    router.push(`/settings/prompts/skills/${installed.artifactId}`);
  }, [installScope, installType, isExecutionTargetCurrent, promptExternalLinksV1, props.configuredSources, props.itemId, props.sourceId, resolveExactExecutionTarget, router, selectedInstallMode, selectedTarget, selectionKey, setPromptExternalLinksV1, targetInput, workspacePath]);

  const [installing, runInstall] = useHappyAction(installItem);

  const skillMarkdown = React.useMemo(() => decodeUtf8BundleEntry(item, 'SKILL.md'), [item]);
  const additionalFilesCount = Math.max(0, (item?.bundleBody.entries.length ?? 0) - (skillMarkdown ? 1 : 0));
  const screenTitle = item?.title ?? props.title ?? t('common.details');
  const sourceLabel = props.displayPath?.split('/').slice(0, -1).join('/') || item?.description || props.sourceId;
  const executionTarget = resolveExactExecutionTarget(selectedTarget);

  const installDisabled = executionTarget === null || installing || !installType || targetInput.trim().length === 0 || (installScope === 'project' && workspacePath.trim().length === 0);

  return (
    <ItemList keyboardShouldPersistTaps="handled">
      <PageHeader
        testID="promptRegistries.details.header"
        alwaysShowTitle
        title={screenTitle}
        description={t('promptLibrary.surface.registryItemDescription')}
        actions={(
          <View style={styles.headerActions}>
            <MachineAdministrationTargetSelector
              selection={administrationTargetSelection}
              presentation="chip"
              testIDPrefix="settings.promptRegistries.administration.target"
            />
            {installType ? (
              <RoundButton
                testID="promptRegistries.details.install"
                size="small"
                title={t('promptLibrary.surface.installAction')}
                disabled={installDisabled}
                loading={installing}
                onPress={runInstall}
              />
            ) : null}
          </View>
        )}
      />

      <ItemGroup title={t('promptLibrary.surface.registryItemSection')}>
        <Item
          testID="promptRegistries.details.source"
          title={t('promptLibrary.registriesItemSource')}
          subtitle={sourceLabel}
          mode="info"
          showChevron={false}
        />
        <Item
          testID="promptRegistries.details.path"
          title={t('promptLibrary.registriesItemPath')}
          subtitle={props.displayPath ?? item?.description ?? props.itemId}
          mode="info"
          showChevron={false}
        />
        <Item
          testID="promptRegistries.details.files"
          title={t('promptLibrary.registriesItemFiles')}
          detail={String(additionalFilesCount)}
          mode="info"
          showChevron={false}
        />
        <Item
          testID="promptRegistries.details.import"
          title={t('promptLibrary.surface.importToLibrary')}
          subtitle={importing ? t('common.loading') : t('promptLibrary.registriesItemImportSubtitle')}
          disabled={!item || importing}
          onPress={runImport}
        />
      </ItemGroup>

      <ItemGroup title={t('promptLibrary.registriesItemInstallAction')} description={t('promptLibrary.surface.registryInstallDescription')}>
        <SegmentedChoiceItem
          title={t('promptLibrary.externalAssetsScope')}
          options={[
            { id: 'project', label: t('promptLibrary.externalAssetsProjectScope'), description: t('promptLibrary.surface.installProjectScopeDescription') },
            { id: 'user', label: t('promptLibrary.externalAssetsUserScope'), description: t('promptLibrary.surface.installUserScopeDescription') },
          ]}
          value={installScope}
          onChange={(nextScope) => setInstallScope(nextScope as PromptAssetScopeV1)}
        />
        {installScope === 'project' ? (
          <ContextBar
            mode="workspace_only"
            workspace={{
              value: workspacePath,
              onChange: setWorkspacePath,
              placeholder: t('promptLibrary.surface.projectDirectoryPlaceholder'),
              testID: 'promptRegistries.details.directoryInput',
              browse: {
                machineId: executionTarget?.machine.id ?? null,
                serverId: executionTarget?.serverId ?? null,
                enabled: executionTarget !== null,
              },
            }}
          />
        ) : null}
        <DropdownMenu
          open={typeMenuOpen}
          onOpenChange={setTypeMenuOpen}
          items={installTypeItems}
          selectedId={selectedInstallTypeId}
          onSelect={(nextTypeId) => setSelectedInstallTypeId(nextTypeId)}
          itemTrigger={{
            title: t('promptLibrary.externalAssetsExportType'),
            subtitle: installType?.title ?? t('promptLibrary.externalAssetsNoTypes'),
          }}
          rowKind="item"
          connectToTrigger
          variant="default"
        />
        {installModeOptions.length > 0 && selectedInstallMode ? (
          <SegmentedChoiceItem<PromptAssetInstallModeV1>
            title={t('promptLibrary.externalAssetsInstallMethod')}
            options={installModeOptions}
            value={selectedInstallMode}
            onChange={setInstallMode}
            testIDPrefix="promptRegistries.details.installMode"
          />
        ) : null}
        <Item
          title={t('promptLibrary.externalAssetsExportTarget')}
          subtitle={t('promptLibrary.surface.installTargetDescription')}
          accessoryLayout="adaptive"
          showChevron={false}
          rightElement={(
            <FieldTextInput
              testID="promptRegistries.details.targetInput"
              accessibilityLabel={t('promptLibrary.externalAssetsExportTarget')}
              placeholder={t('promptLibrary.externalAssetsExportTargetNamePlaceholder')}
              value={targetInput}
              onChangeText={setTargetInput}
              autoCapitalize="none"
              monospace
            />
          )}
        />
      </ItemGroup>

      <ItemGroup title={t('promptLibrary.registriesItemPreview')}>
        <SectionContentRow>
          {loading && !item ? (
            <Text style={styles.previewEmpty}>{t('common.loading')}</Text>
          ) : skillMarkdown ? (
            <Text style={styles.previewText}>{skillMarkdown}</Text>
          ) : (
            <Text style={styles.previewEmpty}>{t('promptLibrary.registriesItemPreviewUnavailable')}</Text>
          )}
        </SectionContentRow>
      </ItemGroup>
    </ItemList>
  );
});
