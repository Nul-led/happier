import * as React from 'react';

import {
  Button,
  Dropdown,
  EmptyState,
  Row,
  SessionChat,
  Stack,
  Tabs,
  Text,
  usePluginHostApi,
  usePluginTranslation,
} from '@happier-dev/plugin-ui';
import type { TriageLinkedSessionProjectionV1 } from '@happier-dev/triage-protocol/v1';

import { openLinkedSession } from '../../sessions/entrySessionOpen.js';

const FILL_STYLE = Object.freeze({ flex: 1, minWidth: 0, minHeight: 0 });
const TOOLBAR_STYLE = Object.freeze({ paddingHorizontal: 16, paddingVertical: 8, minHeight: 44 });

/**
 * The entry's linked investigation, live (plan 05 §4.6): the real Session — transcript, prompts
 * and composer — rendered by Happier through `SessionChat`, with the Session it shows chosen here
 * and one explicit way to open it in full. Selection is surface-local; the detail's instance key
 * resets it with the tab.
 */
export function TriageSessionPanel(props: Readonly<{
  sessions: readonly TriageLinkedSessionProjectionV1[];
}>): React.ReactElement | null {
  const text = usePluginTranslation();
  const host = usePluginHostApi();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // The first linked Session (projection order) until the person picks another; a pick that
  // leaves the projection falls back to the first rather than to nothing.
  const selected = props.sessions.find((session) => session.sessionId === selectedId) ?? props.sessions[0];
  const openSelected = React.useCallback(async () => {
    if (selected === undefined || opening) return;
    setOpening(true);
    await openLinkedSession({
      execute: async (actionId, input, options) => await host.executeAction(actionId, input, options),
      sessionId: selected.sessionId,
    });
    if (mounted.current) setOpening(false);
  }, [host, opening, selected]);
  if (selected === undefined) return null;
  const titleOf = (session: TriageLinkedSessionProjectionV1) => (
    session.displayTitle ?? text('plugins.triage.surface.detail.session', 'Session')
  );
  const pickerLabel = text('plugins.triage.surface.detail.session.picker', 'Linked session');
  return (
    <Stack style={FILL_STYLE}>
      <Row gap="small" align="center" style={TOOLBAR_STYLE}>
        <Stack style={FILL_STYLE}>
          {props.sessions.length > 1 ? (
            <Dropdown
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              trigger={titleOf(selected)}
              triggerAppearance="control"
              triggerAccessibilityLabel={`${pickerLabel}: ${titleOf(selected)}`}
              items={props.sessions.map((session) => ({
                id: session.sessionId,
                label: titleOf(session),
                kind: 'radio' as const,
                radioGroupId: 'linked-session',
              }))}
              radioGroups={[{ id: 'linked-session', accessibilityLabel: pickerLabel, selectedId: selected.sessionId }]}
              onSelect={(sessionId) => {
                setSelectedId(sessionId);
                setPickerOpen(false);
              }}
            />
          ) : (
            <Text variant="label" value={titleOf(selected)} numberOfLines={1} />
          )}
        </Stack>
        <Button
          titleKey="plugins.triage.surface.detail.session.open"
          title="Open session"
          variant="secondary"
          busy={opening}
          onPress={() => { void openSelected(); }}
        />
      </Row>
      <Stack style={FILL_STYLE}>
        <SessionChat
          // One provider per Session: switching the selection replaces the controller.
          key={selected.sessionId}
          sessionId={selected.sessionId}
          testID="triage-detail-session"
          fallback={(
            <EmptyState
              titleKey="plugins.triage.surface.detail.session.unavailableHere"
              title="Open this session in Happier to follow it live."
            />
          )}
        />
      </Stack>
    </Stack>
  );
}

/**
 * A source that declares no tabs keeps its whole detail; with a linked Session the body gains
 * Details | Session above it (plan 05 §4.6), and without one it is exactly the source's detail.
 */
export function TriageDetailWholeBody(props: Readonly<{
  sessions: readonly TriageLinkedSessionProjectionV1[];
  children: React.ReactNode;
}>): React.ReactElement {
  const text = usePluginTranslation();
  const [selected, setSelected] = React.useState<'details' | 'session'>('details');
  if (props.sessions.length === 0) return <>{props.children}</>;
  return (
    <Tabs
      value={selected}
      onValueChange={(value) => setSelected(value === 'session' ? 'session' : 'details')}
      ariaLabel={text('plugins.triage.surface.detail.tabs', 'Entry detail')}
      // The Session tab hosts the live chat, which needs the detail's remaining height.
      layout="fill"
    >
      <Tabs.Item value="details" title={text('plugins.triage.surface.detail.tab.details', 'Details')} retention="retain">
        {props.children}
      </Tabs.Item>
      <Tabs.Item value="session" title={text('plugins.triage.surface.detail.tab.session', 'Session')} retention="retain">
        <TriageSessionPanel sessions={props.sessions} />
      </Tabs.Item>
    </Tabs>
  );
}
