import { Platform } from 'react-native';

/**
 * The top band a column opens with: the session header over the transcript and the header of a
 * side pane beside it. Both take their height from `useHeaderHeight()` and their text and inset
 * from here, so side by side they read as one band with one baseline.
 */
export const HEADER_BAND_HORIZONTAL_PADDING_PX = Platform.OS === 'ios' ? 8 : 16;

export const HEADER_BAND_TITLE_TEXT = {
    fontSize: Platform.select({ ios: 15, android: 15, default: 16 }),
    fontWeight: '600',
} as const;

export const HEADER_BAND_SUBTITLE_TEXT = {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 14,
    marginTop: 1,
} as const;
