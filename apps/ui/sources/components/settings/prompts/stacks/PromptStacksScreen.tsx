import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

/**
 * `/settings/prompts/stacks`: where prompts and skills are added to an agent's instructions — every
 * coding session, every voice conversation, or sessions started with a given profile.
 */
export const PromptStacksScreen = React.memo(() => {
  const router = useRouter();
  const promptStacks = useSetting('promptStacksV1');

  const profileCount = Object.keys(promptStacks?.surfaces?.profilesById ?? {}).length;
  const codingCount = promptStacks?.surfaces?.coding?.length ?? 0;
  const voiceCount = promptStacks?.surfaces?.voice?.length ?? 0;

  return (
    <ItemList presentation="page">
      <SettingsPageHeader description={t('promptLibrary.surface.stacksPageDescription')} />
      <ItemGroup title={t('promptLibrary.surface.stacksSection')} description={t('promptLibrary.surface.stacksSectionDescription')}>
        <Item
          testID="promptStacks.coding"
          icon={<Icon name="terminal" />}
          title={t('promptLibrary.codingStack')}
          subtitle={t('promptLibrary.codingStackSubtitle')}
          detail={t('promptLibrary.profileStackCount', { count: codingCount })}
          onPress={() => router.push('/settings/prompts/stacks/coding')}
        />
        <Item
          testID="promptStacks.voice"
          icon={<Icon name="microphone" />}
          title={t('promptLibrary.voiceStack')}
          subtitle={t('promptLibrary.voiceStackSubtitle')}
          detail={t('promptLibrary.profileStackCount', { count: voiceCount })}
          onPress={() => router.push('/settings/prompts/stacks/voice')}
        />
        <Item
          testID="promptStacks.profiles"
          icon={<Icon name="user-circle" />}
          title={t('promptLibrary.profileStacks')}
          subtitle={t('promptLibrary.surface.profileStacksDescription')}
          detail={t('promptLibrary.profileStacksSubtitle', { count: profileCount })}
          onPress={() => router.push('/settings/prompts/stacks/profiles')}
        />
      </ItemGroup>
    </ItemList>
  );
});

PromptStacksScreen.displayName = 'PromptStacksScreen';
