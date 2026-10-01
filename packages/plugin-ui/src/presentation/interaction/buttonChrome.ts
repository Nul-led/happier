import type { HappierUiTheme } from '../../environment/types.js';
import { HAPPIER_DEFAULT_MINIMUM_INTERACTIVE_TARGET_SIZE } from '../../environment/interactiveTarget.js';
import type { HappierPortableStyle } from '../portableTypes.js';

export type HappierButtonChromeVariant = 'primary' | 'secondary' | 'plain' | 'destructive';

const BUTTON_PADDING_VERTICAL = 8;
const BUTTON_FOCUS_RING_WIDTH = 2;
export const HAPPIER_BUTTON_DISABLED_OPACITY = 0.35;

/**
 * The one chrome of a button-shaped control: geometry, fill, focus ring and
 * label colour for each variant. `Button` renders it, and so does a menu whose
 * trigger is the page's primary action ("Add a source ▾"), so the two can never
 * drift into two looks for the same action weight. Press feedback stays with
 * each caller's pressable, which already owns it.
 */
export function resolveHappierButtonChrome(input: Readonly<{
  theme: HappierUiTheme;
  variant: HappierButtonChromeVariant;
  disabled: boolean;
  focused: boolean;
}>): Readonly<{ style: HappierPortableStyle; foreground: string }> {
  const { theme, variant } = input;
  const foreground = variant === 'primary' ? theme.colors.onAccent
    : variant === 'destructive' ? theme.colors.danger : theme.colors.text;
  const background = variant === 'plain'
    ? 'transparent'
    : input.disabled
      ? theme.colors.controlDisabled
      : (variant === 'primary' ? theme.colors.accent : theme.colors.control);
  return {
    foreground,
    style: {
      minHeight: HAPPIER_DEFAULT_MINIMUM_INTERACTIVE_TARGET_SIZE,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.small,
      paddingHorizontal: theme.spacing.large,
      paddingVertical: BUTTON_PADDING_VERTICAL,
      borderRadius: theme.radii.control,
      backgroundColor: background,
      // A focus ring is drawn as a border rather than an outline so the control
      // keeps its box on every platform React Native renders to.
      borderWidth: BUTTON_FOCUS_RING_WIDTH,
      borderColor: input.focused ? theme.colors.focus : 'transparent',
    },
  };
}
