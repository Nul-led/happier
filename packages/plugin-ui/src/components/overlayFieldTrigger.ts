import { createContext } from 'react';

/**
 * Package-private: draws the enclosing Dropdown's built-in trigger as a page-row
 * field box (the chosen option, or a placeholder, and a chevron) instead of one
 * of the public `triggerAppearance` looks. Only the field `Select` provides it,
 * so the public trigger vocabulary stays `text | control | primary`.
 */
export type OverlayFieldTrigger = Readonly<{
  /** The chosen option's label; `null` asks for a choice with `placeholder`. */
  value: string | null;
  placeholder: string;
}>;

export const OverlayFieldTriggerContext = createContext<OverlayFieldTrigger | null>(null);
