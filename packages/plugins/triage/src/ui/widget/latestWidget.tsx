import * as React from 'react';
import type { RenderContext, RenderSurface } from '@happier-dev/plugin-sdk/ui';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Item,
  ItemGroup,
  LoadingState,
  defineUiSurface,
  usePluginHostApi,
  usePluginTranslation,
  usePluginUiEphemeralSharedScope,
  useSurfaceContext,
} from '@happier-dev/plugin-ui';

import { TRIAGE_ENTRY_DETAIL_DESTINATION_V1 } from '../../composer/openEntryDetails.js';
import { TRIAGE_LIST_DEFAULT_LENS_V1 } from '../../projection/listWindow.js';
import { readTriageSourceDescriptorV1 } from '../detail/sourceSurface.js';
import { readTriageRowDetailToneV1, readTriageRowMarkV1 } from '../list/rows.js';
import { openTriageLinkedEntry } from '../navigation/openLinkedEntry.js';
import { projectTriageEntryDisplay } from '../window/entryDisplay.js';
import { projectTriageListWindow } from '../window/mountedWindow.js';
import { useTriageListWindow } from '../window/useTriageListWindow.js';
import { useTriageListWindowViewDemand } from '../window/useTriageListWindowViewDemand.js';

/**
 * How many of the newest entries the Home widget shows. Home is a glance, not the list: the page
 * holds everything else, one press away through each row and the section's Open.
 */
export const TRIAGE_LATEST_WIDGET_ROWS_V1 = 5;

const LATEST_LENS = Object.freeze({ ...TRIAGE_LIST_DEFAULT_LENS_V1, limit: TRIAGE_LATEST_WIDGET_ROWS_V1 });

/**
 * **New in PRs & Issues**, the Home widget (`shell-extensibility` §2.1, §3.5).
 *
 * It reads the same mounted window the page and the Composer picker share: one store, one
 * single-flight, one pacing interval. The window is retained by the host while nothing shows it,
 * so coming back to Home draws the last rows at once and revalidates them — stale first, then
 * fresh — with no timer anywhere. Mounting is the only demand it makes; Home builds it only while
 * it is focused and on screen.
 */
function TriageLatestWidget(_context: RenderContext): React.ReactElement {
  const text = usePluginTranslation();
  const hostApi = usePluginHostApi();
  const surfaceContext = useSurfaceContext();
  const sharedScope = usePluginUiEphemeralSharedScope();
  const window = useTriageListWindow();
  useTriageListWindowViewDemand(true, window.refresh);
  const snapshot = window.snapshot;

  const rows = React.useMemo(
    () => (snapshot.window === undefined ? undefined : projectTriageListWindow(LATEST_LENS, hostApi, sharedScope)?.rows),
    [hostApi, sharedScope, snapshot.window],
  );
  const openPage = React.useCallback(() => {
    void hostApi.openSurface(TRIAGE_ENTRY_DETAIL_DESTINATION_V1, undefined, { subPath: '' }).catch(() => undefined);
  }, [hostApi]);

  if (rows === undefined) {
    if (snapshot.error !== undefined) {
      return (
        <ErrorState
          testID="triage-latest-widget.error"
          titleKey="plugins.triage.widget.error"
          title="The latest entries could not be read"
          {...(snapshot.error.detail === undefined ? {} : { details: snapshot.error.detail })}
          {...(snapshot.error.retryable === false ? {} : {
            action: (
              <Button
                variant="secondary"
                titleKey="plugins.triage.widget.retry"
                title="Try again"
                onPress={() => { void window.refresh('manual'); }}
              />
            ),
          })}
        />
      );
    }
    return (
      <LoadingState
        testID="triage-latest-widget.loading"
        titleKey="plugins.triage.widget.loading"
        title="Loading the latest entries"
        rows={3}
      />
    );
  }

  if (rows.length === 0) {
    return snapshot.configuredSources.length === 0 ? (
      <EmptyState
        testID="triage-latest-widget.noSources"
        layout="line"
        titleKey="plugins.triage.widget.noSources"
        title="Connect a source to see new pull requests and issues here."
        action={<Button variant="secondary" titleKey="plugins.triage.widget.setUp" title="Set up" onPress={openPage} />}
      />
    ) : (
      <EmptyState
        testID="triage-latest-widget.empty"
        layout="line"
        titleKey="plugins.triage.widget.empty"
        title="Nothing new right now"
      />
    );
  }

  return (
    <ItemGroup testID="triage-latest-widget.rows">
      {rows.map((row) => {
        const display = projectTriageEntryDisplay(row, text);
        // The page's row mark and detail tone (one owner): the entry's kind glyph, loud only when it
        // needs the reader.
        const workflowSubject = readTriageSourceDescriptorV1(surfaceContext, row.entryRef.source)
          ?.kinds.find((kind) => kind.id === row.entryRef.kindId)?.workflowSubject ?? null;
        const mark = readTriageRowMarkV1(display, workflowSubject);
        const detailTone = readTriageRowDetailToneV1(display);
        return (
          <Item
            key={display.key}
            testID={`triage-latest-widget.row.${display.key}`}
            title={display.title}
            titleNumberOfLines={1}
            subtitle={display.scopeLabel}
            subtitleNumberOfLines={1}
            icon={<Icon name={mark.name} size="small" tone={mark.tone} />}
            {...(display.detail === null ? {} : { detail: display.detail, detailNumberOfLines: 1 })}
            {...(detailTone === undefined ? {} : { detailTone })}
            density="compact"
            onPress={() => { void openTriageLinkedEntry(hostApi, row.entryRef); }}
          />
        );
      })}
    </ItemGroup>
  );
}

export const renderSurface: RenderSurface = defineUiSurface(TriageLatestWidget);
