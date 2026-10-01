import * as React from 'react';

import {
  Item,
  ItemGroup,
  Button,
  Label,
  Stack,
  Status,
  usePluginHostApi,
  usePluginTranslation,
} from '@happier-dev/plugin-ui';
import type { TriageLinkedSessionProjectionV1 } from '@happier-dev/triage-protocol/v1';

import { openLinkedSession } from '../../sessions/entrySessionOpen.js';

/** Common-header rendering for the bounded read-only linked Session projection. */
export function TriageLinkedSessions(props: Readonly<{
  sessions: readonly TriageLinkedSessionProjectionV1[];
  hasMore: boolean;
  pageState?: 'idle' | 'loading' | 'failed';
  onLoadMore?: () => void;
  /** Omit the visible label when an enclosing story step already names the group. */
  labelled?: boolean;
}>): React.ReactElement | null {
  const text = usePluginTranslation();
  const host = usePluginHostApi();
  const [busySessionId, setBusySessionId] = React.useState<string | null>(null);
  const [failedSessionId, setFailedSessionId] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const openSession = React.useCallback(async (sessionId: string) => {
    if (busySessionId !== null) return;
    setBusySessionId(sessionId);
    setFailedSessionId(null);
    const result = await openLinkedSession({
      execute: async (actionId, input, options) => await host.executeAction(actionId, input, options),
      sessionId,
    });
    if (!mounted.current) return;
    setBusySessionId(null);
    setFailedSessionId(result.status === 'failed' ? sessionId : null);
  }, [busySessionId, host]);
  if (props.sessions.length === 0) return null;
  return (
    <Stack gap="small">
      {props.labelled === false ? null : (
        <Label value={text('plugins.triage.surface.detail.sessions', 'Sessions')} />
      )}
      <ItemGroup accessibilityLabel={text('plugins.triage.surface.detail.sessions', 'Sessions')}>
        {props.sessions.map((session) => {
          const title = session.displayTitle ?? text('plugins.triage.surface.detail.session', 'Session');
          const unavailable = busySessionId !== null && busySessionId !== session.sessionId;
          const failed = failedSessionId === session.sessionId;
          const description = failed
            ? text('plugins.triage.surface.detail.sessionOpenFailed', 'This Session could not be opened.')
            : unavailable
              ? text('plugins.triage.surface.detail.sessionUnavailable', 'Another Session is opening.')
              : undefined;
          return (
            <Item
              key={session.sessionId}
              title={title}
              detail={description}
              accessibilityLabel={title}
              accessibilityHint={description}
              tone={failed ? 'danger' : undefined}
              busy={busySessionId === session.sessionId}
              disabled={unavailable}
              onPress={() => { void openSession(session.sessionId); }}
            />
          );
        })}
      </ItemGroup>
      {props.hasMore ? (
        <Button
          titleKey={props.pageState === 'failed'
            ? 'plugins.triage.surface.loadMore.retry'
            : 'plugins.triage.surface.loadMore'}
          title={props.pageState === 'failed' ? 'Retry' : 'Load more'}
          variant="secondary"
          busy={props.pageState === 'loading'}
          disabled={props.onLoadMore === undefined}
          onPress={() => { props.onLoadMore?.(); }}
        />
      ) : null}
      {props.pageState === 'failed' ? (
        <Status
          tone="danger"
          labelKey="plugins.triage.surface.detail.sessionsLoadFailed"
          label="More linked Sessions could not be loaded."
        />
      ) : null}
    </Stack>
  );
}
