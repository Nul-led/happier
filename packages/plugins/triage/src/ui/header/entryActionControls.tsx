import * as React from 'react';
import {
  Button,
  Row,
  Stack,
  Status,
} from '@happier-dev/plugin-ui';
import type {
  TriageEntryRefV1,
  TriageSourceInstanceIdV1,
  TriageSourceWorkflowSubjectV1,
} from '@happier-dev/triage-protocol/v1';

import {
  planTriageOfferedActionsV1,
  readTriageActionTitleKeyV1,
  type TriageActionV1,
} from '../../settings/actions.js';
import type { TriageActionTargetV1 } from '../state/actionTarget.js';

/**
 * The Triage common header's action controls (`core/SESSIONS.md` §1,
 * `PLAN.md` §0a A1/A3).
 *
 * This is the SOLE source-neutral Session-start control owner. A source's own
 * detail body contributes provider facts, provider Actions and links to already
 * canonical review runs; it never renders Ask, Fix, Fix / review, a Session
 * picker or an orchestration callback, because a second start owner is how two
 * Sessions get started for one entry from one screen.
 *
 * It is deliberately thin, and it decides nothing about the actions themselves.
 * Which actions exist, what they are called and what each one needs on disk are
 * the configured record's (`settings/actions.ts`); which of them this entry
 * is offered is that module's one planner. What is left here is what a reader
 * may press and what a press reports — not a destination, a creation key, a
 * workspace, a link, an open or a retry, all of which stay in
 * `sessions/entrySessionOrchestrator.ts`.
 */

/** The exact selected entry a press was made for, and the action it pressed. */
export type TriageEntryActionRequestV1 = Readonly<{
  action: TriageActionV1;
  entryRef: TriageEntryRefV1;
  sourceInstanceId: TriageSourceInstanceIdV1;
}>;

/**
 * Why a press started nothing. The catalog is re-read at the press, so an
 * action removed elsewhere, or an Account that cannot be reached, is found only
 * then — and a press that silently does nothing is the failure `core/CORPUS.md`
 * §4.2 names for Refresh.
 */
export type TriageEntryActionRefusalV1 = Readonly<{ kind: 'missing' | 'unavailable' }>;

export type TriageEntryActionControlsPropsV1 = Readonly<{
  /** The one aggregate action target; it reads `selection`, never `focus`. */
  target: TriageActionTargetV1;
  /** The configured catalog. Filtering it for this entry happens in one place. */
  actions: readonly TriageActionV1[];
  workflowSubject: TriageSourceWorkflowSubjectV1;
  /**
   * Whether the currently selected source contribution declares the admitted
   * review-workspace preparation operation. An action that declares
   * `pull_request` without one resolves the workspace refusal every time, so the
   * control is disabled with a stated reason rather than left to fail after the
   * press.
   */
  preparesReviewWorkspace: boolean;
  /** Starts the action; resolves to a refusal when the press could start nothing. */
  onAction: (request: TriageEntryActionRequestV1) => void | Promise<TriageEntryActionRefusalV1 | null | void>;
}>;

/**
 * The one primary control: the first action in catalog order a reader can
 * press. Every other action is secondary, so two filled buttons never sit side
 * by side (`DESIGN.md` "Hierarchy"). An action this entry cannot run is never
 * the primary one.
 */
export function readTriagePrimaryActionIdV1(
  offered: readonly TriageActionV1[],
  preparesReviewWorkspace: boolean,
): string | null {
  const primary = offered.find((action) => !isTriageActionBlockedV1(action, preparesReviewWorkspace));
  return primary?.actionId ?? null;
}

function isTriageActionBlockedV1(action: TriageActionV1, preparesReviewWorkspace: boolean): boolean {
  return action.workspaceMode === 'pull_request' && !preparesReviewWorkspace;
}

const NO_SELECTION_COPY = 'Select an entry to start a session from it.';
const NO_PREPARATION_COPY =
  'This source cannot prepare a review workspace, so a pull request cannot be fixed here.';

function TriageEntryActionButton(props: Readonly<{
  action: TriageActionV1;
  entryRef: TriageEntryRefV1;
  sourceInstanceId: TriageSourceInstanceIdV1;
  blocked: boolean;
  primary: boolean;
  onPress: (request: TriageEntryActionRequestV1) => void;
}>): React.ReactElement {
  const titleKey = readTriageActionTitleKeyV1(props.action);
  return (
    <Button
      {...(titleKey === null ? {} : { titleKey })}
      title={props.action.label}
      variant={props.primary ? 'primary' : 'secondary'}
      disabled={props.blocked}
      onPress={() => {
        props.onPress({
          action: props.action,
          entryRef: props.entryRef,
          sourceInstanceId: props.sourceInstanceId,
        });
      }}
    />
  );
}

export function TriageEntryActionControls(
  props: TriageEntryActionControlsPropsV1,
): React.ReactElement {
  const { target, actions, workflowSubject, preparesReviewWorkspace, onAction } = props;
  const offered = React.useMemo(
    () => planTriageOfferedActionsV1(actions, workflowSubject),
    [actions, workflowSubject],
  );
  const [refusal, setRefusal] = React.useState<TriageEntryActionRefusalV1 | null>(null);
  const press = React.useCallback((request: TriageEntryActionRequestV1) => {
    setRefusal(null);
    void (async () => {
      const outcome = await onAction(request);
      if (outcome !== undefined && outcome !== null) setRefusal(outcome);
    })();
  }, [onAction]);

  // No selection is a stated refusal, never a fallback to the focused or first
  // row: a control here would start a Session from whichever row a keyboard
  // cursor happened to be parked on.
  if (target.kind === 'refused') {
    return (
      <Status
        tone="muted"
        labelKey="plugins.triage.surface.session.noSelection"
        label={NO_SELECTION_COPY}
      />
    );
  }

  const entryRef = target.entryRef;
  const sourceInstanceId = target.sourceInstanceId;
  // Read from the action's own declared mode rather than from the subject: an
  // action needs a prepared workspace because it SAID so, and a subject that
  // happens to be a pull request is not by itself a claim about preparation.
  const preparationMissing = !preparesReviewWorkspace
    && offered.some((action) => action.workspaceMode === 'pull_request');
  const primaryActionId = readTriagePrimaryActionIdV1(offered, preparesReviewWorkspace);

  return (
    <Stack gap="small">
      <Row gap="small" align="center" wrap>
        {offered.map((action) => {
          const blocked = isTriageActionBlockedV1(action, preparesReviewWorkspace);
          // A renamed control shows the person's own words in every locale; a
          // still-shipped one keeps its translation. `titleKey` is therefore
          // resolved from the record, never stored in it.
          return (
            <TriageEntryActionButton
              key={action.actionId}
              action={action}
              entryRef={entryRef}
              sourceInstanceId={sourceInstanceId}
              blocked={blocked}
              primary={action.actionId === primaryActionId}
              onPress={press}
            />
          );
        })}
      </Row>
      {refusal === null ? null : refusal.kind === 'missing' ? (
        <Status
          tone="warning"
          labelKey="plugins.triage.surface.actions.noLongerAvailable"
          label="That action is no longer available for this entry."
        />
      ) : (
        <Status
          tone="warning"
          labelKey="plugins.triage.surface.actions.startUnavailable"
          label="Happier cannot reach your account right now, so this action cannot start. Try again in a moment."
        />
      )}
      {preparationMissing ? (
        <Status
          tone="muted"
          labelKey="plugins.triage.surface.session.preparationUnsupported"
          label={NO_PREPARATION_COPY}
        />
      ) : null}
    </Stack>
  );
}
