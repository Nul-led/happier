import type { ReactElement } from 'react';
import { View } from 'react-native';

import { useOptionalPluginUiPresentationHost } from '../presentationHost/context.js';
import { HappierText } from '../presentation/text/Text.js';
import { usePluginTheme } from './PluginUiProvider.js';

export type AvatarProps = Readonly<{
  /** The person's display name. It is the mark's accessible name and the seed of its colour. */
  name: string;
  /** `small` (16) beside a verb in a sentence, `medium` (20) at the end of a row. */
  size?: 'small' | 'medium';
  testID?: string;
}>;

const AVATAR_SIZE_PX = Object.freeze({ small: 16, medium: 20 });

function monogram(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '?' : first.toUpperCase();
}

/**
 * One person's mark — a pull request's author, a reviewer, an assignee — drawn by Happier's own avatar
 * owner, so people look the same in a plugin as everywhere else. It takes a name, never an image URL:
 * a plugin cannot make the app fetch a remote picture.
 */
export function Avatar(props: AvatarProps): ReactElement {
  const host = useOptionalPluginUiPresentationHost();
  const theme = usePluginTheme();
  const size = AVATAR_SIZE_PX[props.size ?? 'medium'];
  if (host?.renderAvatar) {
    return <>{host.renderAvatar({ name: props.name, size, ...(props.testID === undefined ? {} : { testID: props.testID }) })}</>;
  }
  return (
    <View
      testID={props.testID}
      accessibilityRole="image"
      accessibilityLabel={props.name}
      aria-label={props.name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.control,
      }}
    >
      <HappierText accessible={false} style={{ fontSize: Math.round(size * 0.5), lineHeight: size, color: theme.colors.secondaryText }}>
        {monogram(props.name)}
      </HappierText>
    </View>
  );
}
