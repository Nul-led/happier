import { useState, type ReactElement } from 'react';
import { Image as ReactNativeImage, View } from 'react-native';

import type {
  HappierUiPlatformFacts,
  HappierUiTheme,
} from '../../environment/types.js';
import { HappierText } from '../text/Text.js';
import { readHappierRenderableImageSource } from './renderableImage.js';

export type HappierImageSize = 'small' | 'medium' | 'large';

const IMAGE_SIZE: Readonly<Record<HappierImageSize, number>> = Object.freeze({
  small: 32,
  medium: 48,
  large: 72,
});

function takeLeadingGraphemes(value: string, maximum: number): string {
  const Segmenter = typeof Intl === 'undefined' ? undefined : Intl.Segmenter;
  if (typeof Segmenter === 'function') {
    const segments: string[] = [];
    for (const { segment } of new Segmenter('und', { granularity: 'grapheme' }).segment(value)) {
      segments.push(segment);
      if (segments.length === maximum) break;
    }
    return segments.join('');
  }
  // Without a Unicode grapheme segmenter there is no small, correct
  // approximation of UAX #29 (Indic conjuncts, Hangul, emoji tags and CRLF all
  // have distinct rules). A bounded neutral marker preserves the compact image
  // fallback contract without corrupting or partially rendering a grapheme.
  return '?';
}

/** One size projection shared by the package Resource adapter and core chrome. */
export function resolveHappierImagePixels(size: HappierImageSize | undefined): number {
  return IMAGE_SIZE[size ?? 'medium'];
}

/** One neutral textual fallback; manifest projection remains the brand owner. */
export function resolveHappierBrandFallback(displayName: string): string {
  const value = displayName.trim();
  return (takeLeadingGraphemes(value, 1) || '?').toLocaleUpperCase();
}

/** Preserve two visible graphemes when the runtime can segment them exactly. */
export function resolveHappierImageFallback(fallback: string): string {
  return takeLeadingGraphemes(fallback, 2);
}

/**
 * A brand mark is an explicit presentation variant of a bounded image. It
 * keeps opaque marks unchanged while giving transparent marks a semantic,
 * opaque backing; generic images intentionally remain bare.
 */
type HappierBrandMarkBacking = Readonly<{
  backgroundColor: string;
  foregroundColor: string;
}>;

function resolveHappierBrandMarkBacking(
  theme: HappierUiTheme,
  colorScheme: HappierUiPlatformFacts['colorScheme'],
): HappierBrandMarkBacking {
  const isDark = colorScheme === 'dark';
  return {
    // `text` and `surface` are a canonical contrast pair. On dark hosts the
    // light foreground becomes the backing for transparent black marks; on
    // light hosts the ordinary surface already supplies that backing.
    backgroundColor: isDark ? theme.colors.text : theme.colors.surface,
    foregroundColor: isDark ? theme.colors.surface : theme.colors.text,
  };
}

/**
 * One bounded PNG/fallback renderer.
 *
 * Byte acquisition AND materialization stay with the adapter that admits the
 * bytes: `renderableImage.ts` records a source when an owner admits one, and
 * this render can only read that record. Bytes no owner admitted — or that a
 * product ceiling refused — take the same neutral fallback an absent mark does,
 * so a render can never be made to pay for a conversion.
 */
export function HappierImage(props: Readonly<{
  bytes?: Uint8Array;
  size?: HappierImageSize;
  accessibilityLabel?: string;
  fallback: string;
  theme: HappierUiTheme;
  testID?: string;
  /** Internal explicit presentation supplied only by the brand-mark composition. */
  backing?: HappierBrandMarkBacking;
  /** Internal: an adjacent canonical label makes this fallback initial decorative. */
  fallbackAccessibilityHidden?: boolean;
  /** Internal author diagnostic emitted by the Resource-owning component. */
  onDecodeError?: () => void;
}>): ReactElement {
  const pixels = resolveHappierImagePixels(props.size);
  const backingStyle = props.backing
    ? {
      backgroundColor: props.backing.backgroundColor,
      borderRadius: props.theme.radii.control,
    }
    : undefined;
  const source = readHappierRenderableImageSource(props.bytes);
  const [failedSource, setFailedSource] = useState<typeof source>();
  const renderableSource = source === failedSource ? undefined : source;
  if (renderableSource) {
    return (
      <ReactNativeImage
        source={renderableSource}
        onError={() => {
          setFailedSource(renderableSource);
          props.onDecodeError?.();
        }}
        accessibilityLabel={props.accessibilityLabel}
        accessible={Boolean(props.accessibilityLabel)}
        testID={props.testID}
        resizeMode="contain"
        style={{ width: pixels, height: pixels, ...backingStyle }}
      />
    );
  }
  const hideFallbackFromAccessibility = props.fallbackAccessibilityHidden === true
    && props.accessibilityLabel === undefined;
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      accessible={hideFallbackFromAccessibility ? false : Boolean(props.accessibilityLabel)}
      accessibilityElementsHidden={hideFallbackFromAccessibility || undefined}
      importantForAccessibility={hideFallbackFromAccessibility ? 'no-hide-descendants' : undefined}
      aria-hidden={hideFallbackFromAccessibility || undefined}
      testID={props.testID}
      style={{
        width: pixels,
        height: pixels,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: props.theme.radii.control,
        ...(backingStyle ?? { backgroundColor: props.theme.colors.control }),
      }}
    >
      <HappierText {...(props.backing
        ? { style: { color: props.backing.foregroundColor } }
        : { tone: 'secondary' })}
      >
        {resolveHappierImageFallback(props.fallback)}
      </HappierText>
    </View>
  );
}

/** Canonical display-name accessibility for an optional packaged brand mark. */
export type HappierBrandMarkProps = Readonly<{
  displayName: string;
  bytes?: Uint8Array;
  size?: HappierImageSize;
  showName?: boolean;
  theme: HappierUiTheme;
  colorScheme: HappierUiPlatformFacts['colorScheme'];
  testID?: string;
  /** An adjacent host-owned label already names the brand; keep the mark decorative. */
  externallyLabelled?: boolean;
  /**
   * Called when the platform decoder rejects an already-admitted PNG. The mark
   * has already changed to its ordinary neutral fallback; no image bytes or
   * host-private decoder details are exposed to the callback.
   */
  onDecodeError?: () => void;
}>;

export function HappierBrandMark(props: HappierBrandMarkProps): ReactElement {
  const showName = props.showName === true;
  const fallback = resolveHappierBrandFallback(props.displayName);
  const backing = resolveHappierBrandMarkBacking(props.theme, props.colorScheme);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID={props.testID}>
      <HappierImage
        bytes={props.bytes}
        size={props.size}
        fallback={fallback}
        theme={props.theme}
        backing={backing}
        accessibilityLabel={showName || props.externallyLabelled ? undefined : props.displayName}
        fallbackAccessibilityHidden={showName || props.externallyLabelled}
        onDecodeError={props.onDecodeError}
      />
      {showName ? <HappierText>{props.displayName}</HappierText> : null}
    </View>
  );
}
