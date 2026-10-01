import * as React from 'react';

import { Tabs } from '@happier-dev/plugin-ui';

/**
 * A source detail body rendering the one panel the Triage detail asked for
 * (r0.42).
 *
 * The Triage frame owns the tab strip and the shared vocabulary; the source
 * renders its content for `input.panel` only, inside its own panel interval, so
 * its panel readers keep their active/abort lifetime exactly as they had it in
 * the source's own tabs. The target asks only for panels this kind declares,
 * so a panel id with no content renders nothing rather than inventing copy.
 */
export function TriageDetailPanel(props: Readonly<{
  panel: string;
  /** The source's own name for its detail, announced for the panel region. */
  ariaLabel: string;
  /** Content per panel id; absent or `null` ids are not offered by this kind. */
  panels: Readonly<Record<string, React.ReactNode>>;
}>): React.ReactElement {
  const content = props.panels[props.panel];
  return (
    <Tabs value={props.panel} onValueChange={noop} ariaLabel={props.ariaLabel} tabList="host">
      <Tabs.Item value={props.panel} title={props.panel}>
        {content ?? null}
      </Tabs.Item>
    </Tabs>
  );
}

function noop(): void {}
