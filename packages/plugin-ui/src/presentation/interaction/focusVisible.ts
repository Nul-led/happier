import { Platform } from 'react-native';

type FocusVisibleTarget = Readonly<{ matches?: (selector: string) => boolean }>;
type InputModality = 'keyboard' | 'pointer';

/** Published on `<html>` so the browser's own ring (`theme.css`) follows the same decision. */
const INPUT_MODALITY_ATTRIBUTE = 'data-happier-input-modality';
/** A modifier pressed on its own (Cmd/Ctrl-click, Shift-select) is not keyboard navigation. */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'OS', 'Hyper', 'Super', 'CapsLock', 'Fn']);

let latestModality: InputModality | null = null;

function recordModality(modality: InputModality): void {
  // Only a change touches <html>: an attribute write there restyles the whole document.
  if (latestModality === modality) return;
  latestModality = modality;
  document.documentElement?.setAttribute(INPUT_MODALITY_ATTRIBUTE, modality);
}

/**
 * The last input type, recorded at the document before any handler runs. Browsers disagree about
 * focus that script moves right after a click: WebKit (Safari, the macOS desktop webview) does not
 * focus a clicked button, so a popover focusing its first control on open is a script focus with no
 * focused predecessor, and WebKit reports it as `:focus-visible`. Recording the input here makes the
 * decision the same in every engine.
 */
function installInputModalityRecorder(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  const onPointer = () => recordModality('pointer');
  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || MODIFIER_KEYS.has(event.key)) return;
    recordModality('keyboard');
  };
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('touchstart', onPointer, { capture: true, passive: true });
  document.addEventListener('keydown', onKey, true);
}

installInputModalityRecorder();

function matchesFocusVisible(target: FocusVisibleTarget | null | undefined): boolean {
  if (typeof target?.matches !== 'function') return true;
  try {
    return target.matches(':focus-visible');
  } catch {
    // An engine without `:focus-visible` cannot tell keyboard from pointer focus; show the ring.
    return true;
  }
}

/**
 * The one decision of whether a focused control shows its focus ring.
 *
 * On the web: never right after a pointer press, whatever the engine reports; otherwise the
 * browser's `:focus-visible` decides (keyboard focus shows the ring). Native focus only ever comes
 * from a keyboard or an assistive technology, so it always shows. React Native Web reports `focused`
 * for EVERY focus, including the one a mouse click leaves, so a control that paints its ring from
 * that flag alone keeps a ring after every click; route the flag through here instead.
 *
 * `target` is the focused element (a focus event's `target`). Without one, the document's active
 * element is read, which is the focused control while a focus change is being rendered.
 */
export function isHappierFocusVisible(target?: unknown): boolean {
  if (Platform.OS !== 'web') return true;
  if (latestModality === 'pointer') return false;
  if (target !== undefined && target !== null) return matchesFocusVisible(target as FocusVisibleTarget);
  if (typeof document === 'undefined') return true;
  return matchesFocusVisible(document.activeElement as FocusVisibleTarget | null);
}

/**
 * A focus flag reported by a pressable (React Native Web's `focused`) narrowed to whether its ring
 * shows: `focused && isHappierFocusVisible()`. For controls that are not a `HappierPressable`, which
 * already applies this to the `focused` it hands its style and children.
 */
export function resolveHappierFocusRingVisible(focused: boolean | undefined): boolean {
  return focused === true && isHappierFocusVisible();
}
