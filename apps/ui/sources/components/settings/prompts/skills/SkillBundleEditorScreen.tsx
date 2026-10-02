import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useNavigation, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useFocusEffect } from '@/components/appShell/workspace/destinationRoute';

import { t } from '@/text';
import { sync } from '@/sync/sync';
import { storage, useSetting, useSettingMutable } from '@/sync/domains/state/storage';
import type { CodeEditorHandle } from '@/components/ui/code/editor/codeEditorTypes';
import { MarkdownCodeEditorField } from '@/components/ui/markdown/editor/MarkdownCodeEditorField';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import type { PageHeaderMenuAction } from '@/components/ui/layout/PageHeaderEntityParts';
import { Modal } from '@/modal';
import {
  DEFAULT_SKILL_PROMPT_MARKDOWN,
  createSkillPromptBundle,
  hasSkillPromptMarkdownContent,
  listPromptBundleSupportingEntries,
  removeSkillPromptBundleEntry,
  readSkillMarkdownFromPromptBundleBody,
  updateSkillPromptBundle,
} from '@/sync/ops/promptLibrary/promptBundles';
import { useUnsavedDraftNavigationGuard } from '@/utils/navigation/useUnsavedDraftNavigationGuard';
import { PromptExternalLinksGroup } from '@/components/settings/prompts/shared/PromptExternalLinksGroup';
import { PromptFolderFieldRow, PromptTagsFieldRow } from '@/components/settings/prompts/shared/PromptOrganizationFields';
import { PromptEditorHeader } from '@/components/settings/prompts/collection/PromptEditorHeader';
import { publishPromptCollectionDraftTitle } from '@/components/settings/prompts/collection/PromptCollectionList';
import { promptCollectionItemHref, promptCollectionRoot } from '@/components/settings/prompts/collection/promptCollectionModel';
import { usePromptLibraryEntryActions } from '@/components/settings/prompts/collection/usePromptLibraryEntryActions';
import { usePromptLibraryEntryMeta } from '@/components/settings/prompts/collection/usePromptLibraryEntryMeta';
import { usePromptEditorDraftField } from '@/components/settings/prompts/shared/usePromptEditorDraftField';
import { readSkillBundleArtifactState } from '@/components/settings/prompts/skills/readSkillBundleArtifactState';
import { ensurePromptFolderByName, findPromptFolderById, formatPromptTags, normalizePromptTags } from '@/sync/ops/promptLibrary/promptFolders';

const styles = StyleSheet.create((theme) => ({
  editorContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    minHeight: 360,
  },
}));

/**
 * A skill's editor in the Skills collection: a saved skill (`artifactId`) or the new-skill draft
 * (`null`). Saving a draft opens the saved skill in its place; saving a skill keeps it open.
 */
export const SkillBundleEditorScreen = React.memo((props: Readonly<{ artifactId: string | null }>) => {
  const router = useRouter();
  const navigation = useNavigation();
  const [promptFoldersV1, setPromptFoldersV1] = useSettingMutable('promptFoldersV1');
  const wrapLinesInDiffs = useSetting('wrapLinesInDiffs');
  const savedArtifactId = props.artifactId;
  const isNew = savedArtifactId === null;
  const entryActions = usePromptLibraryEntryActions('bundle');
  const meta = usePromptLibraryEntryMeta(savedArtifactId);
  const [isLoading, setIsLoading] = React.useState<boolean>(Boolean(props.artifactId));
  const titleField = usePromptEditorDraftField('');
  const skillMarkdownField = usePromptEditorDraftField(DEFAULT_SKILL_PROMPT_MARKDOWN);
  const folderField = usePromptEditorDraftField('');
  const tagsField = usePromptEditorDraftField('');
  const {
    value: title,
    setValue: setTitle,
    setPristineValue: setPristineTitle,
    applyExternalValue: applyExternalTitle,
  } = titleField;
  const {
    value: skillMarkdown,
    setValue: setSkillMarkdown,
    setPristineValue: setPristineSkillMarkdown,
    applyExternalValue: applyExternalSkillMarkdown,
  } = skillMarkdownField;
  const {
    value: folderName,
    setValue: setFolderName,
    setPristineValue: setPristineFolderName,
    applyExternalValue: applyExternalFolderName,
  } = folderField;
  const {
    value: tagsText,
    setValue: setTagsText,
    setPristineValue: setPristineTagsText,
    applyExternalValue: applyExternalTagsText,
  } = tagsField;
  const [saving, setSaving] = React.useState(false);
  // Where to go once the save that asked for it has rendered (so the draft is no longer dirty).
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const [supportingFiles, setSupportingFiles] = React.useState<Array<{ path: string; contentKind: 'utf8' | 'binary' }>>([]);
  // Flushed before reading `skillMarkdown` on save so the latest rich/raw edit
  // (which may still be debounced inside the active editor surface) is captured.
  const editorRef = React.useRef<CodeEditorHandle | null>(null);
  const promptFoldersRef = React.useRef(promptFoldersV1);
  promptFoldersRef.current = promptFoldersV1;
  const loadedArtifactIdRef = React.useRef<string | null>(null);

  const applyArtifactState = React.useCallback((artifactId: string, options?: Readonly<{
    preserveDirtyFields?: boolean;
  }>) => {
    const artifactState = readSkillBundleArtifactState(artifactId);
    if (!artifactState) {
      setSupportingFiles([]);
      return false;
    }

    const preserveDirtyFields = options?.preserveDirtyFields === true;
    const nextSkillMarkdown = readSkillMarkdownFromPromptBundleBody(artifactState.body) ?? '';
    const nextSupportingFiles = listPromptBundleSupportingEntries(artifactState.body).map((entry) => ({
      path: entry.path,
      contentKind: entry.contentKind,
    }));
    const nextFolderName = findPromptFolderById(promptFoldersRef.current, artifactState.folderId)?.name ?? '';
    const nextTagsText = formatPromptTags(artifactState.tags);

    setSupportingFiles(nextSupportingFiles);
    if (preserveDirtyFields) {
      applyExternalTitle(artifactState.title, { preserveDirty: true });
      applyExternalSkillMarkdown(nextSkillMarkdown, { preserveDirty: true });
      applyExternalFolderName(nextFolderName, { preserveDirty: true });
      applyExternalTagsText(nextTagsText, { preserveDirty: true });
    } else {
      setPristineTitle(artifactState.title);
      setPristineSkillMarkdown(nextSkillMarkdown);
      setPristineFolderName(nextFolderName);
      setPristineTagsText(nextTagsText);
    }
    loadedArtifactIdRef.current = artifactId;
    return true;
  }, [applyExternalFolderName, applyExternalSkillMarkdown, applyExternalTagsText, applyExternalTitle, setPristineFolderName, setPristineSkillMarkdown, setPristineTagsText, setPristineTitle]);

  const loadArtifact = React.useCallback(async (artifactId: string, options?: Readonly<{
    preserveDirtyFields?: boolean;
  }>) => {
    setIsLoading(true);
    const local = storage.getState().artifacts[artifactId] ?? null;
    if (local?.body === undefined) {
      const credentials = sync.getCredentials();
      if (!credentials) throw new Error('Not authenticated');
      const full = await sync.fetchArtifactWithBody(artifactId);
      if (full) storage.getState().updateArtifact(full);
    }

    return applyArtifactState(artifactId, options);
  }, [applyArtifactState]);

  React.useEffect(() => {
    if (!savedArtifactId) {
      setIsLoading(false);
      setSupportingFiles([]);
      loadedArtifactIdRef.current = null;
      setPristineTitle('');
      setPristineSkillMarkdown(DEFAULT_SKILL_PROMPT_MARKDOWN);
      setPristineFolderName('');
      setPristineTagsText('');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const loaded = await loadArtifact(savedArtifactId);
        if (!cancelled && loaded) {
          setIsLoading(false);
        }
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadArtifact, savedArtifactId, setPristineFolderName, setPristineSkillMarkdown, setPristineTagsText, setPristineTitle]);

  useFocusEffect(
    React.useCallback(() => {
      if (!savedArtifactId) return undefined;
      let cancelled = false;
      void (async () => {
        try {
          const loaded = await loadArtifact(savedArtifactId, { preserveDirtyFields: loadedArtifactIdRef.current === savedArtifactId });
          if (!cancelled && loaded) {
            setIsLoading(false);
          }
        } catch {
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [loadArtifact, savedArtifactId]),
  );

  React.useEffect(() => {
    if (!savedArtifactId || loadedArtifactIdRef.current !== savedArtifactId) return;
    applyArtifactState(savedArtifactId, { preserveDirtyFields: true });
  }, [applyArtifactState, promptFoldersV1, savedArtifactId]);

  React.useEffect(() => {
    if (!isNew) return undefined;
    publishPromptCollectionDraftTitle('bundle', title);
    return () => publishPromptCollectionDraftTitle('bundle', '');
  }, [isNew, title]);

  const changed = titleField.changed || skillMarkdownField.changed || folderField.changed || tagsField.changed;
  // Saving makes the fields pristine, so a saved draft opens in its place without asking.
  const dirty = changed;
  const contentValid = title.trim().length > 0 && hasSkillPromptMarkdownContent(skillMarkdown);
  const canSave = contentValid && !saving && !isLoading && (isNew || changed);

  const save = React.useCallback(async (): Promise<boolean> => {
    if (!contentValid || saving) return false;

    try {
      setSaving(true);
      // Flush any debounced edit out of the active editor surface, then read the
      // freshest skill markdown from its handle (state may not have caught up yet).
      await editorRef.current?.flushPendingChange();
      const latestSkillMarkdown = editorRef.current?.getValue() ?? skillMarkdown;
      const ensuredFolder = ensurePromptFolderByName(promptFoldersV1, folderName);
      if (ensuredFolder.promptFoldersV1 !== promptFoldersV1) {
        setPromptFoldersV1(ensuredFolder.promptFoldersV1);
      }
      const tags = normalizePromptTags(tagsText);
      if (!props.artifactId) {
        const artifactId = await createSkillPromptBundle({ title: title.trim(), skillMarkdown: latestSkillMarkdown, folderId: ensuredFolder.folderId, tags });
        setPendingHref(promptCollectionItemHref('bundle', artifactId));
      } else {
        await updateSkillPromptBundle({ artifactId: props.artifactId, title: title.trim(), skillMarkdown: latestSkillMarkdown, folderId: ensuredFolder.folderId, tags });
      }
      setPristineTitle(title);
      setPristineSkillMarkdown(latestSkillMarkdown);
      setPristineFolderName(folderName);
      setPristineTagsText(tagsText);
      return true;
    } catch {
      Modal.alert(t('common.error'), t('promptLibrary.saveError'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [contentValid, folderName, promptFoldersV1, props.artifactId, saving, setPristineFolderName, setPristineSkillMarkdown, setPristineTagsText, setPristineTitle, setPromptFoldersV1, skillMarkdown, tagsText, title]);

  const leave = React.useCallback(() => setPendingHref(promptCollectionRoot('bundle')), []);
  React.useEffect(() => {
    if (!pendingHref) return;
    setPendingHref(null);
    router.replace(pendingHref as never);
  }, [pendingHref, router]);
  const discard = React.useCallback(() => {
    if (!savedArtifactId) {
      setPristineTitle('');
      setPristineSkillMarkdown(DEFAULT_SKILL_PROMPT_MARKDOWN);
      setPristineFolderName('');
      setPristineTagsText('');
      return;
    }
    applyArtifactState(savedArtifactId);
  }, [applyArtifactState, savedArtifactId, setPristineFolderName, setPristineSkillMarkdown, setPristineTagsText, setPristineTitle]);
  useUnsavedDraftNavigationGuard({
    navigation,
    isDirty: dirty,
    onDiscard: discard,
    onSave: save,
    onLeave: leave,
    tag: 'SkillBundleEditorScreen.leave',
  });

  const menuActions = React.useMemo((): readonly PageHeaderMenuAction[] => {
    if (!savedArtifactId) {
      return [{ id: 'discard', testID: 'skillBundle.discard', title: t('common.discard'), onSelect: () => { discard(); leave(); } }];
    }
    return [
      { id: 'duplicate', testID: 'skillBundle.duplicate', title: t('common.duplicate'), onSelect: () => entryActions.duplicate(savedArtifactId) },
      { id: 'external', testID: 'skillBundle.externalAssets', title: t('promptLibrary.manageExternalAssets'), onSelect: () => entryActions.manageExternalAssets(savedArtifactId) },
      {
        id: 'delete',
        testID: 'skillBundle.delete',
        title: t('common.delete'),
        onSelect: async () => {
          if (await entryActions.remove(savedArtifactId)) {
            discard();
            leave();
          }
        },
      },
    ];
  }, [discard, entryActions, leave, savedArtifactId]);

  const removeSupportingFile = React.useCallback((path: string) => {
    if (!savedArtifactId) return;

    Modal.alert(
      t('promptLibrary.deleteSupportingFileTitle'),
      t('promptLibrary.deleteSupportingFileConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await removeSkillPromptBundleEntry({
                  artifactId: savedArtifactId,
                  path,
                });
                setSupportingFiles((current) => current.filter((entry) => entry.path !== path));
              } catch {
                Modal.alert(t('common.error'), t('promptLibrary.saveError'));
              }
            })();
          },
        },
      ],
    );
  }, [savedArtifactId]);

  return (
    <ItemList keyboardShouldPersistTaps="handled">
      <PromptEditorHeader
        testID="skillBundle.header"
        mark="sparkle"
        title={title.trim() || (isNew ? t('promptLibrary.newSkill') : t('promptLibrary.untitledSkill'))}
        description={t('promptLibrary.surface.skillEditorDescription')}
        meta={meta}
        saveTestID="skillBundle.save"
        saveDisabled={!canSave}
        saving={saving}
        onSave={() => { void save(); }}
        menuActions={menuActions}
      />

      <ItemGroup title={t('promptLibrary.surface.skillSection')} description={t('promptLibrary.surface.skillSectionDescription')}>
        <Item
          title={t('promptLibrary.surface.nameTitle')}
          accessoryLayout="adaptive"
          showChevron={false}
          rightElement={(
            <FieldTextInput
              testID="skillBundle.title"
              value={title}
              onChangeText={setTitle}
              accessibilityLabel={t('promptLibrary.surface.nameTitle')}
              placeholder={t('promptLibrary.titlePlaceholder')}
              autoCapitalize="sentences"
              autoFocus={isNew}
              editable={!isLoading}
            />
          )}
        />
        <PromptFolderFieldRow value={folderName} onChange={setFolderName} testID="skillBundle.folderName" editable={!isLoading} />
        <PromptTagsFieldRow value={tagsText} onChange={setTagsText} testID="skillBundle.tags" editable={!isLoading} />
      </ItemGroup>

      <ItemGroup title={t('promptLibrary.skillContent')} description={t('promptLibrary.surface.skillContentDescription')}>
        <SectionContentRow>
          <View style={styles.editorContainer}>
            <MarkdownCodeEditorField
              resetKey={props.artifactId ?? 'new'}
              testID="skillBundle.editor"
              value={skillMarkdown}
              filePath="SKILL.md"
              onChange={setSkillMarkdown}
              readOnly={isLoading}
              editorRef={editorRef}
              wrapLines={wrapLinesInDiffs !== false}
            />
          </View>
        </SectionContentRow>
      </ItemGroup>

      <ItemGroup
        title={t('promptLibrary.supportingFiles')}
        description={t('promptLibrary.surface.supportingFilesDescription')}
        action={savedArtifactId ? (
          <SectionActionButton
            testID="skillBundle.addSupportingFile"
            title={t('promptLibrary.surface.addFile')}
            icon="plus"
            onPress={() => router.push(`/settings/prompts/skills/${savedArtifactId}/files/new`)}
          />
        ) : undefined}
      >
        {savedArtifactId ? (
          supportingFiles.length > 0 ? supportingFiles.map((entry, index) => {
            const editPath = `/settings/prompts/skills/${savedArtifactId}/files/edit?path=${encodeURIComponent(entry.path)}`;
            const actions: ItemAction[] = [];
            if (entry.contentKind === 'utf8') {
              actions.push({
                id: 'edit',
                title: t('common.edit'),
                icon: 'pencil',
                onPress: () => router.push(editPath),
              });
            }
            actions.push({
              id: 'delete',
              title: t('common.delete'),
              icon: 'trash',
              destructive: true,
              onPress: () => removeSupportingFile(entry.path),
            });

            return (
              <Item
                key={entry.path}
                testID={`skillBundle.supportingFile.${index}`}
                title={entry.path}
                subtitle={entry.contentKind === 'binary'
                  ? t('promptLibrary.supportingFileBinarySubtitle')
                  : t('promptLibrary.supportingFileTextSubtitle')}
                onPress={entry.contentKind === 'utf8' ? () => router.push(editPath) : undefined}
                rightElement={(
                  <ItemRowActions
                    title={entry.path}
                    compactActionIds={entry.contentKind === 'utf8' ? ['edit', 'delete'] : ['delete']}
                    actions={actions}
                  />
                )}
              />
            );
          }) : (
            <Item
              testID="skillBundle.supportingFilesEmpty"
              title={t('promptLibrary.supportingFilesEmptyTitle')}
              subtitle={t('promptLibrary.supportingFilesEmptySubtitle')}
              mode="info"
              showChevron={false}
            />
          )
        ) : (
          <Item
            testID="skillBundle.supportingFilesSaveFirst"
            title={t('promptLibrary.supportingFilesSaveFirstTitle')}
            subtitle={t('promptLibrary.supportingFilesSaveFirstSubtitle')}
            mode="info"
            showChevron={false}
          />
        )}
      </ItemGroup>

      <PromptExternalLinksGroup
        artifactId={props.artifactId}
        libraryKind="bundle"
        manageItemTestID="skillBundle.manageExternalAssets"
        manageItemSubtitle={t('promptLibrary.surface.manageExternalAssetsDescription')}
        linkTestIDPrefix="skillBundle.link"
      />
    </ItemList>
  );
});

SkillBundleEditorScreen.displayName = 'SkillBundleEditorScreen';
