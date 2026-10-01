import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useOptionalPluginUiPresentationHost, type PluginUiPaneHeaderLineSegment } from '../presentationHost/context.js';
import { usePluginUiSurfaceBridge } from './surfaceBridge.js';

export type PaneHeaderContentProps = Readonly<{
  /**
   * The pane's one live line under its title, as facts the host joins with " · " ("1 needs you",
   * "2 live"). An attention fact is `{ text, attention: true }`; the host owns its emphasis.
   * Omit it, or pass an empty list, when there is nothing to say; healthy stays quiet.
   */
  line?: readonly PaneHeaderContentLineSegment[];
  /**
   * The header's trailing actions, before the host's own controls: the tab's "+" (with its menu or
   * picker) and at most one more. Icon buttons, not text.
   */
  actions?: ReactNode;
}>;

export type PaneHeaderContentLineSegment = PluginUiPaneHeaderLineSegment;

/**
 * What this tab puts in the pane header the host already draws for it — the session sidebar's band on
 * desktop, the large title on a phone — exactly where Happier's own tabs put their "+" and their live
 * line. The tab never draws a header of its own; the host keeps the title (the tab's name), the
 * layout and what fits at the pane's width.
 *
 * The actions render in the header, outside this surface's own React tree, yet keep this plugin's
 * context (theme, translation, the surface context, the Host API and every public component). React
 * context your own components provide above `PaneHeaderContent` does not reach them.
 *
 * Where the host placed the surface under no pane header (a page, a widget) it renders nothing, so a
 * surface that is also mounted elsewhere keeps its add path in its body (an empty state's action).
 *
 * ```tsx
 * <PaneHeaderContent line={needsYou > 0 ? [{ text: `${needsYou} needs you`, attention: true }] : []} actions={<LinkMenu />} />
 * ```
 */
export function PaneHeaderContent(props: PaneHeaderContentProps): ReactElement | null {
  const binding = useOptionalPluginUiPresentationHost()?.paneHeader ?? null;
  const bridge = usePluginUiSurfaceBridge();
  const lineKey = JSON.stringify(props.line?.map((part) => typeof part === 'string' ? part : [part.text, part.attention]) ?? []);
  // The line is compared by value, so a tab that re-renders with the same facts does not republish.
  const line = useMemo(
    () => (props.line === undefined || props.line.length === 0 ? null : Object.freeze([...props.line])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineKey],
  );
  const actions = useMemo(
    () => (props.actions === undefined || props.actions === null ? null : bridge(props.actions)),
    [bridge, props.actions],
  );
  if (binding === null) return null;
  return <>{binding.renderPaneHeader({ line, actions })}</>;
}
