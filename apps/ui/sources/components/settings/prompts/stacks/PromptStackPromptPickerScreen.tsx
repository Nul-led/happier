import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import type { PromptStackEntryV1, PromptStacksV1 } from '@happier-dev/protocol';

import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Item } from '@/components/ui/lists/Item';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import { useArtifacts, useSettingMutable } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { promptCollectionDraftHref, promptCollectionItemHref } from '../collection/promptCollectionModel';

function readStackEntries(args: Readonly<{ stacks: PromptStacksV1; surface: 'coding' | 'voice' | 'profile'; profileId?: string | null }>): PromptStackEntryV1[] {
  if (args.surface === 'coding') return args.stacks.surfaces.coding ?? [];
  if (args.surface === 'voice') return args.stacks.surfaces.voice ?? [];
  const profileId = typeof args.profileId === 'string' ? args.profileId.trim() : '';
  return (args.stacks.surfaces.profilesById ?? {})[profileId] ?? [];
}

function writeStackEntries(args: Readonly<{
  stacks: PromptStacksV1;
  surface: 'coding' | 'voice' | 'profile';
  profileId?: string | null;
  entries: PromptStackEntryV1[];
}>): PromptStacksV1 {
  if (args.surface === 'coding') return { ...args.stacks, surfaces: { ...args.stacks.surfaces, coding: args.entries } };
  if (args.surface === 'voice') return { ...args.stacks, surfaces: { ...args.stacks.surfaces, voice: args.entries } };
  const profileId = typeof args.profileId === 'string' ? args.profileId.trim() : '';
  const profilesById = { ...(args.stacks.surfaces.profilesById ?? {}) };
  profilesById[profileId] = args.entries;
  return { ...args.stacks, surfaces: { ...args.stacks.surfaces, profilesById } };
}

export const PromptStackPromptPickerScreen = React.memo((props: Readonly<{
  surface: 'coding' | 'voice' | 'profile';
  profileId?: string | null;
}>) => {
  const router = useRouter();
  const artifacts = useArtifacts();
  const [promptStacksV1, setPromptStacksV1] = useSettingMutable('promptStacksV1');

  const promptDocs = React.useMemo(
    () => artifacts.filter((a) => a.header?.kind === 'prompt_doc.v2'),
    [artifacts],
  );
  const bundles = React.useMemo(
    () => artifacts.filter((a) => a.header?.kind === 'prompt_bundle.v2'),
    [artifacts],
  );

  const add = React.useCallback((ref: { kind: 'doc' | 'bundle'; artifactId: string }) => {
    const entries = readStackEntries({ stacks: promptStacksV1, surface: props.surface, profileId: props.profileId });
    if (entries.some((e) => e.ref.kind === ref.kind && e.ref.artifactId === ref.artifactId)) {
      Modal.alert(t('common.error'), t('promptLibrary.stackAlreadyContainsPrompt'));
      return;
    }

    const next: PromptStackEntryV1 = {
      id: randomUUID(),
      ref,
      enabled: true,
      placement: ref.kind === 'bundle' ? 'skill_instructions' : 'system_append',
      editPolicy: 'user_only',
    };

    const nextStacks = writeStackEntries({
      stacks: promptStacksV1,
      surface: props.surface,
      profileId: props.profileId,
      entries: [...entries, next],
    });

    setPromptStacksV1(nextStacks);
    router.back();
  }, [promptStacksV1, props.profileId, props.surface, router, setPromptStacksV1]);

  const openArtifactEditor = React.useCallback((ref: { kind: 'doc' | 'bundle'; artifactId: string }) => {
    router.push(promptCollectionItemHref(ref.kind, ref.artifactId) as never);
  }, [router]);

  return (
    <ItemList presentation="page">
      <SettingsPageHeader description={t('promptLibrary.surface.stackPickerDescription')} />
      <ItemGroup
        title={t('promptLibrary.prompts')}
        action={(
          <SectionActionButton
            testID="promptStackPicker.addPrompt"
            title={t('promptLibrary.surface.addPrompt')}
            icon="plus"
            onPress={() => router.push(promptCollectionDraftHref('doc') as never)}
          />
        )}
      >
        {promptDocs.map((doc) => {
          const title = doc.header?.title ?? doc.title ?? t('promptLibrary.untitledPrompt');
          return (
            <Item
              key={doc.id}
              testID={`promptStackPicker.doc.${doc.id}`}
              title={title}
              onPress={() => add({ kind: 'doc', artifactId: doc.id })}
              rightElement={(
                <ItemRowActions
                  title={title}
                  compactActionIds={['edit']}
                  actions={[{ id: 'edit', title: t('common.edit'), icon: 'pencil', onPress: () => openArtifactEditor({ kind: 'doc', artifactId: doc.id }) }]}
                />
              )}
            />
          );
        })}
        {promptDocs.length === 0 ? (
          <Item testID="promptStackPicker.emptyPrompts" title={t('promptLibrary.stackPickerNoPrompts')} mode="info" showChevron={false} />
        ) : null}
      </ItemGroup>

      <ItemGroup
        title={t('promptLibrary.skills')}
        action={(
          <SectionActionButton
            testID="promptStackPicker.addSkill"
            title={t('promptLibrary.surface.addSkill')}
            icon="plus"
            onPress={() => router.push(promptCollectionDraftHref('bundle') as never)}
          />
        )}
      >
        {bundles.map((bundle) => {
          const title = bundle.header?.title ?? bundle.title ?? t('promptLibrary.untitledSkill');
          return (
            <Item
              key={bundle.id}
              testID={`promptStackPicker.bundle.${bundle.id}`}
              title={title}
              onPress={() => add({ kind: 'bundle', artifactId: bundle.id })}
              rightElement={(
                <ItemRowActions
                  title={title}
                  compactActionIds={['edit']}
                  actions={[{ id: 'edit', title: t('common.edit'), icon: 'pencil', onPress: () => openArtifactEditor({ kind: 'bundle', artifactId: bundle.id }) }]}
                />
              )}
            />
          );
        })}
        {bundles.length === 0 ? (
          <Item testID="promptStackPicker.emptySkills" title={t('promptLibrary.stackPickerNoSkills')} mode="info" showChevron={false} />
        ) : null}
      </ItemGroup>
    </ItemList>
  );
});

PromptStackPromptPickerScreen.displayName = 'PromptStackPromptPickerScreen';
