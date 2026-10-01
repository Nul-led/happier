import * as React from 'react';

import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Item } from '@/components/ui/lists/Item';
import { t } from '@/text';

type FieldRowProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  testID: string;
  editable: boolean;
  /** Injected by `ItemGroup`. */
  showDivider?: boolean;
}>;

/** The folder row of a prompt or skill editor: typing a new name creates the folder on save. */
export function PromptFolderFieldRow(props: FieldRowProps) {
  return (
    <Item
      title={t('promptLibrary.folderLabel')}
      subtitle={t('promptLibrary.surface.folderDescription')}
      accessoryLayout="adaptive"
      showChevron={false}
      showDivider={props.showDivider}
      rightElement={(
        <FieldTextInput
          testID={props.testID}
          value={props.value}
          onChangeText={props.onChange}
          accessibilityLabel={t('promptLibrary.folderLabel')}
          placeholder={t('promptLibrary.surface.optionalPlaceholder')}
          editable={props.editable}
        />
      )}
    />
  );
}

/** The tags row of a prompt or skill editor, comma-separated. */
export function PromptTagsFieldRow(props: FieldRowProps) {
  return (
    <Item
      title={t('promptLibrary.tagsLabel')}
      subtitle={t('promptLibrary.surface.tagsDescription')}
      accessoryLayout="adaptive"
      showChevron={false}
      showDivider={props.showDivider}
      rightElement={(
        <FieldTextInput
          testID={props.testID}
          value={props.value}
          onChangeText={props.onChange}
          accessibilityLabel={t('promptLibrary.tagsLabel')}
          placeholder={t('promptLibrary.tagsPlaceholder')}
          editable={props.editable}
          autoCapitalize="none"
        />
      )}
    />
  );
}
