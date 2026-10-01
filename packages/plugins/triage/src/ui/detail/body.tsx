import * as React from 'react';

import {
  ScrollArea,
  Stack,
  Tabs,
  TargetedSurface,
  usePluginTranslation,
} from '@happier-dev/plugin-ui';
import type { PluginUiTargetedContributionSurfaceV1 } from '@happier-dev/plugin-sdk/ui';
import type { TriageDetailSurfaceInputV1 } from '@happier-dev/triage-protocol/v1';

import type { TriageDetailTabV1 } from './tabs.js';

/** One source detail mount: the admitted surface, its strict input and its identity. */
export type TriageDetailSourceMountV1 = Readonly<{
  surface: PluginUiTargetedContributionSurfaceV1;
  input: TriageDetailSurfaceInputV1;
  /** The canonical entry+connection key; each panel mount extends it. */
  instanceKey: string;
}>;

const SHARED_TAB_COPY = Object.freeze({
  overview: { key: 'plugins.triage.surface.detail.tab.overview', fallback: 'Overview' },
  activity: { key: 'plugins.triage.surface.detail.tab.activity', fallback: 'Activity' },
  files: { key: 'plugins.triage.surface.detail.tab.files', fallback: 'Files' },
  checks: { key: 'plugins.triage.surface.detail.tab.checks', fallback: 'Checks' },
});

const FILL_STYLE = Object.freeze({ flex: 1, minWidth: 0, minHeight: 0 });

/** The one panel mount: the source body asked for exactly this tab. */
export function TriageDetailPanelMount(props: Readonly<{
  mount: TriageDetailSourceMountV1;
  panel: string;
  fallback: React.ReactNode;
}>): React.ReactElement {
  const input = React.useMemo(
    () => ({ ...props.mount.input, panel: props.panel }),
    [props.mount.input, props.panel],
  );
  return (
    <TargetedSurface
      surface={props.mount.surface}
      input={input}
      // A panel is its own mount: switching tabs must not hand one panel's
      // state to another, and a refresh of the same entry keeps each panel.
      instanceKey={`${props.mount.instanceKey}#panel:${props.panel}`}
      fallback={props.fallback}
    />
  );
}

/**
 * The detail's tabbed body (r0.42): Triage's strip over the shared vocabulary
 * and any source-only tabs, each mounting the owning source's panel.
 *
 * Every panel is `discard`: a panel is a separate source mount, and a hidden
 * retained mount has no way to learn it is hidden, so it could keep live work
 * running. Overview is the story rail — the source's overview panel, then
 * Triage's own agent step.
 */
export function TriageDetailTabbedBody(props: Readonly<{
  tabs: readonly TriageDetailTabV1[];
  entry: TriageDetailSourceMountV1;
  /** The linked fix PR's mount, when an issue or error group has one. */
  fixPullRequest: TriageDetailSourceMountV1 | null;
  /** Above the rail: a waiting agent's permission card. */
  overviewLead?: React.ReactNode;
  /** After the source's steps: Triage's own — the fix PR and ③ the agent. */
  overviewTail: React.ReactNode;
  /** After the Activity panel: the live agent card. */
  activityTail?: React.ReactNode;
  /**
   * Triage's own last tab: the linked Session, live (plan 05 §4.6). Absent without a linked
   * Session, and never a source panel.
   */
  session?: React.ReactNode;
  fallback: React.ReactNode;
}>): React.ReactElement {
  const text = usePluginTranslation();
  const [selected, setSelected] = React.useState<string>('overview');

  const panelFor = (tab: TriageDetailTabV1): React.ReactNode => {
    const mount = tab.from === 'entry'
      ? props.entry
      : tab.from === 'fixPullRequest'
        ? props.fixPullRequest
        : null;
    const sourcePanel = mount === null
      ? null
      : <TriageDetailPanelMount mount={mount} panel={tab.id} fallback={props.fallback} />;
    if (tab.id === 'activity' && props.activityTail !== undefined && props.activityTail !== null) {
      return (
        <Stack gap="medium" style={FILL_STYLE}>
          <Stack style={FILL_STYLE}>{sourcePanel}</Stack>
          {props.activityTail}
        </Stack>
      );
    }
    if (tab.id !== 'overview') return sourcePanel;
    return (
      <ScrollArea style={FILL_STYLE}>
        <Stack gap="large">
          {props.overviewLead}
          {sourcePanel}
          {props.overviewTail}
        </Stack>
      </ScrollArea>
    );
  };

  return (
    <Stack style={FILL_STYLE}>
      <Tabs
        value={selected}
        onValueChange={setSelected}
        ariaLabel={text('plugins.triage.surface.detail.tabs', 'Entry detail')}
        // Panels are bounded regions (the Overview rail scrolls itself; Session hosts the live chat).
        layout="fill"
      >
        {props.tabs.map((tab) => (
          <Tabs.Item
            key={tab.id}
            value={tab.id}
            title={tab.kind === 'shared'
              ? text(SHARED_TAB_COPY[tab.id].key, SHARED_TAB_COPY[tab.id].fallback)
              : tab.title}
            retention="discard"
          >
            {panelFor(tab)}
          </Tabs.Item>
        ))}
        {props.session === undefined || props.session === null ? null : (
          <Tabs.Item
            key="session"
            value="session"
            title={text('plugins.triage.surface.detail.tab.session', 'Session')}
            // Tabs retains the draft; its activity context withdraws hidden command targets.
            retention="retain"
          >
            {props.session}
          </Tabs.Item>
        )}
      </Tabs>
    </Stack>
  );
}
