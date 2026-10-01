import { useOptionalHappierUiTypography } from '../../environment/context.js';
import type {
  HappierTypeRole,
  HappierUiTheme,
  HappierUiTypography,
} from '../../environment/types.js';
import type { HappierFontWeight, HappierPortableStyle } from '../portableTypes.js';

/**
 * The one resolver from a type role to a text style for every shared text
 * owner (Text variants, Heading, Label, list rows, status lines, form fields).
 *
 * A same-realm host's real role styles win when installed; otherwise the
 * public theme snapshot's metrics apply, with `heading` stepping down to
 * `title` because the snapshot has no heading step. Components never read
 * `theme.typography.*` for these roles themselves, so family, tracking and the
 * heading step reach every surface through this one seam.
 */
export function resolveHappierTypeRoleStyle(
  role: HappierTypeRole,
  theme: HappierUiTheme,
  typography: HappierUiTypography | null,
): HappierPortableStyle {
  const host = typography?.[role];
  if (host) {
    return {
      fontSize: host.fontSize,
      lineHeight: host.lineHeight,
      ...(host.fontWeight === undefined ? {} : { fontWeight: host.fontWeight as HappierFontWeight }),
      ...(host.fontFamily === undefined ? {} : { fontFamily: host.fontFamily }),
      ...(host.letterSpacing === undefined ? {} : { letterSpacing: host.letterSpacing }),
    };
  }
  const metric = theme.typography[role === 'heading' ? 'title' : role];
  return {
    fontSize: metric.fontSize,
    lineHeight: metric.lineHeight,
    fontWeight: metric.fontWeight as HappierFontWeight,
  };
}

/** {@link resolveHappierTypeRoleStyle} with the environment's host facts. */
export function useHappierTypeRoleStyle(role: HappierTypeRole, theme: HappierUiTheme): HappierPortableStyle {
  return resolveHappierTypeRoleStyle(role, theme, useOptionalHappierUiTypography());
}

/**
 * Whether the host draws this role with tabular figures. `fontVariant` is an
 * app-private React Native text style, outside the portable author vocabulary,
 * so it travels as this fact to the one text owner rather than as a style.
 */
export function readHappierTypeRoleTabular(
  role: HappierTypeRole,
  typography: HappierUiTypography | null,
): boolean {
  return typography?.[role]?.fontVariant?.includes('tabular-nums') === true;
}
