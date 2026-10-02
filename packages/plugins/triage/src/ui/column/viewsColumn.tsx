import * as React from 'react';
import type { RenderContext, RenderSurface } from '@happier-dev/plugin-sdk/ui';
import {
  NavigationList,
  defineUiSurface,
  usePluginHostApi,
} from '@happier-dev/plugin-ui';

import { TRIAGE_ENTRY_DETAIL_DESTINATION_V1 } from '../../composer/openEntryDetails.js';
import type { CorpusSavedViewV1 } from '../../settings/savedViews.js';
import {
  TRIAGE_ROUTE_DEFAULT_LENS_V1,
  parseTriageRouteSubPathV1,
  preflightTriageRouteLensV1,
  type TriageRouteLensV1,
} from '../navigation/location.js';
import { useTriageSavedViews } from '../views/useTriageSavedViews.js';

/**
 * The PRs & Issues shell column: the reader's saved views, beside the page
 * (`shell-extensibility` §2.1, §3.2).
 *
 * It is a navigation surface over the page's own location and nothing else.
 * The selected row is read from the page `subPath` the host hands it, and a
 * press opens the page at that view's complete lens through the ONE route owner
 * (`navigation/location.ts`) — the same lens a copied link carries. It keeps
 * no selection, lens or view set of its own: the saved views come from their
 * one Account owner, and the page's Views control remains where they change.
 */

const ALL_ENTRIES_ID = 'all';

function lensForView(view: CorpusSavedViewV1 | null): TriageRouteLensV1 {
  if (view === null) return TRIAGE_ROUTE_DEFAULT_LENS_V1;
  return {
    order: view.order,
    smartPolicy: view.smartPolicy,
    filters: view.filters,
    query: view.query,
    selectedViewId: view.viewId,
    selection: null,
  };
}

function destinationForView(view: CorpusSavedViewV1 | null) {
  const location = preflightTriageRouteLensV1(lensForView(view));
  return location.kind === 'refused' ? undefined : { destination: TRIAGE_ENTRY_DETAIL_DESTINATION_V1, subPath: location.subPath };
}

function TriageViewsColumn(context: RenderContext): React.ReactElement {
  const hostApi = usePluginHostApi();
  const savedViews = useTriageSavedViews();
  const views = savedViews.saved?.value.views ?? [];
  const selectedViewId = React.useMemo(
    () => (context.subPath === undefined ? null : parseTriageRouteSubPathV1(context.subPath).selectedViewId),
    [context.subPath],
  );
  // A view id the reader no longer has is not a selection this column can show.
  const selected = views.some((view) => view.viewId === selectedViewId) ? selectedViewId : ALL_ENTRIES_ID;

  const open = React.useCallback((view: CorpusSavedViewV1 | null) => {
    const location = preflightTriageRouteLensV1(lensForView(view));
    if (location.kind === 'refused') return;
    void hostApi.openSurface(TRIAGE_ENTRY_DETAIL_DESTINATION_V1, undefined, { subPath: location.subPath })
      .catch(() => undefined);
  }, [hostApi]);

  return (
    <NavigationList
      testID="triage-views-column"
      titleKey="plugins.triage.surface.views"
      title="Views"
      count={savedViews.saved === null ? null : views.length}
    >
      <NavigationList.Group first>
        <NavigationList.Row
          testID="triage-views-column.all"
          titleKey="plugins.triage.column.all"
          title="All entries"
          selected={selected === ALL_ENTRIES_ID}
          destination={destinationForView(null)}
          onPress={() => open(null)}
        />
        {views.map((view) => (
          <NavigationList.Row
            key={view.viewId}
            testID={`triage-views-column.view.${view.viewId}`}
            title={view.label}
            selected={selected === view.viewId}
            destination={destinationForView(view)}
            onPress={() => open(view)}
          />
        ))}
      </NavigationList.Group>
    </NavigationList>
  );
}

export const renderSurface: RenderSurface = defineUiSurface(TriageViewsColumn);
