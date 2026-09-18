import * as React from 'react';
import {
  Button,
  EmptyState,
  Heading,
  Row,
  ScrollArea,
  Select,
  Stack,
  Status,
  Text,
  TextField,
  Toggle,
  usePluginTranslation,
} from '@happier-dev/plugin-ui';

import { readTriageActionTitleKeyV1, type TriageActionV1 } from '../../settings/actions.js';
import {
  triageCreateActionInputV1,
  triageDeleteActionInputV1,
  triageMovedActionOrderV1,
  triageReorderActionsInputV1,
  triageUpdateActionInputV1,
  type TriageActionEditorDraftV1,
} from './actionsCommand.js';
import {
  TRIAGE_EDITOR_DELIVERIES_V1,
  TRIAGE_EDITOR_SUBJECTS_V1,
  TRIAGE_EDITOR_TARGET_KINDS_V1,
  TRIAGE_EDITOR_WORKSPACE_MODES_V1,
  isTriageActionDraftRevisionStaleV1,
  newTriageActionDraftV1,
  triageActionDraftBlockerV1,
  triageActionDraftV1,
  triagePromptInvocationEditorOptionsV1,
  withTriageAppliesToV1,
  withTriageActionTargetKindV1,
  withTriageDeliveryV1,
  withTriageProfileIdV1,
  withTriagePromptArgsTextV1,
  withTriagePromptTokenV1,
} from './editorModel.js';
import type { TriageMountedActionsV1 } from './useTriageActions.js';
import { useTriageLaunchProfiles } from './useLaunchProfiles.js';
import { useTriagePromptInvocations } from './usePromptInvocations.js';

/**
 * The configured-action editor: add, remove, rename, reorder, disable and
 * configure, in one place.
 *
 * The declarative Settings surface is not a repeatable record editor, so this
 * purpose-built editor writes the one `triage.actions` Account KV catalog.
 *
 * It decides nothing about what an action MEANS. Which subjects exist, what a
 * workspace mode is worth and which arm an action runs are closed vocabularies
 * owned elsewhere and offered here verbatim, and every write leaves through the
 * one `triage.actions` CAS owner. The editor holds exactly one thing of its
 * own: the draft a person is typing, which is not durable state and is
 * discarded on cancel.
 */

/**
 * The editor's own scrolling region, as automation identity.
 *
 * Exported because the fact a mounted test has to be able to reach is exactly
 * this box: the form and its **Save** control are inside a scroll owner of the
 * editor's own, rather than clipped by the shell's work region with no way to
 * reach the end of what a person is filling in.
 */
export const TRIAGE_ACTIONS_EDITOR_SCROLL_TEST_ID_V1 = 'triage-actions-editor-scroll';

/**
 * How the editor takes its share of the shell's clipped work region.
 *
 * `flexShrink: 1` with `minHeight: 0` is the whole mechanism: without it a
 * column child keeps its natural content height, so a long draft simply grows
 * past the region the shell clips and takes **Save** with it. Shrinking instead
 * gives the editor a bounded box, and the scroll owner below reaches the rest.
 * It claims no fixed height and no share of its own — the list keeps its
 * `flex: 1` — so an editor that fits still renders exactly as it did.
 */
const TRIAGE_ACTIONS_EDITOR_SCROLL_STYLE_V1 = Object.freeze({ flexShrink: 1, minHeight: 0 });

export type TriageActionsEditorPropsV1 = Readonly<{
  actions: TriageMountedActionsV1;
  onClose?: () => void;
}>;

type EditorTarget =
  | Readonly<{ kind: 'create'; baseRevision: string }>
  | Readonly<{ kind: 'update'; actionId: string; baseRevision: string }>;

const SUBJECT_LABELS: Readonly<Record<string, Readonly<{ key: string; text: string }>>> = {
  pullRequest: { key: 'plugins.triage.surface.actions.subject.pullRequest', text: 'Pull requests' },
  issue: { key: 'plugins.triage.surface.actions.subject.issue', text: 'Issues' },
  errorIssue: { key: 'plugins.triage.surface.actions.subject.errorIssue', text: 'Error groups' },
  other: { key: 'plugins.triage.surface.actions.subject.other', text: 'Everything else' },
};

const WORKSPACE_LABELS: Readonly<Record<string, Readonly<{ key: string; text: string }>>> = {
  reference_only: {
    key: 'plugins.triage.surface.actions.workspace.referenceOnly',
    text: 'No working copy',
  },
  repository: {
    key: 'plugins.triage.surface.actions.workspace.repository',
    text: 'The project I pick',
  },
  pull_request: {
    key: 'plugins.triage.surface.actions.workspace.pullRequest',
    text: 'A prepared review worktree',
  },
};

const DELIVERY_LABELS: Readonly<Record<string, Readonly<{ key: string; text: string }>>> = {
  compose: { key: 'plugins.triage.surface.actions.delivery.compose', text: 'Wait in the composer' },
  send: { key: 'plugins.triage.surface.actions.delivery.send', text: 'Send it straight away' },
};

const TARGET_LABELS: Readonly<Record<string, Readonly<{ key: string; text: string }>>> = {
  agent: { key: 'plugins.triage.surface.actions.arm.agent', text: 'Start a session with an agent' },
  reviewStart: { key: 'plugins.triage.surface.actions.arm.reviewStart', text: 'Run a code review' },
};

function options(
  values: readonly string[],
  labels: Readonly<Record<string, Readonly<{ key: string; text: string }>>>,
  translate: (key: string, fallback?: string) => string,
): readonly Readonly<{ value: string; label: string }>[] {
  return values.map((value) => {
    const label = labels[value];
    return {
      value,
      label: label === undefined ? value : translate(label.key, label.text),
    };
  });
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : null;
  }
  return null;
}

function stringList(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((member): member is string => typeof member === 'string') : [];
}

export function TriageActionsEditor(props: TriageActionsEditorPropsV1): React.ReactElement {
  const { actions } = props;
  const translate = usePluginTranslation();
  const invocations = useTriagePromptInvocations();
  const profiles = useTriageLaunchProfiles();
  const [target, setTarget] = React.useState<EditorTarget | null>(null);
  const [draft, setDraft] = React.useState<TriageActionEditorDraftV1 | null>(null);

  /**
   * The Library's invocations, plus the two entries a list of them cannot
   * supply: "no prompt", which is a real configuration, and the id this action
   * already holds when the Library no longer offers it. Dropping the second
   * would silently repoint a person's action at nothing the moment they opened
   * the editor.
   */
  const held = draft?.target.promptInvocationId ?? null;
  const promptOptions = React.useMemo(() => triagePromptInvocationEditorOptionsV1({
    heldInvocationId: held,
    invocations: invocations.invocations,
    coverage: invocations.coverage,
    noPromptLabel: translate('plugins.triage.surface.actions.field.promptNone', 'No prompt'),
    missingPromptLabel: translate(
      'plugins.triage.surface.actions.field.promptMissing',
      'Prompt no longer in your library',
    ),
  }), [held, invocations, translate]);
  const promptAllowsArgs = held !== null && (
    invocations.invocations.find((invocation) => invocation.id === held)?.allowArgs === true
    || draft?.target.promptArgsText !== undefined
  );

  /**
   * The Account's profiles, plus the two entries a list of them cannot supply:
   * "no profile", which is a real configuration meaning the generic new-Session
   * flow chooses, and the id this action already holds when the catalog no
   * longer offers it.
   *
   * The second is the one that matters. A configured profile that has been
   * deleted, or that a briefly unreachable catalog did not return, stays
   * VISIBLE and named as missing — so opening the editor to rename an action
   * cannot silently repoint it at nothing, and repairing or clearing it is an
   * explicit choice the person makes.
   */
  const heldProfileId = draft?.profileId ?? null;
  const profileOptions = React.useMemo(() => {
    const rows = profiles.profiles.map((profile) => ({ value: profile.id, label: profile.name }));
    const missing = heldProfileId !== null && !rows.some((row) => row.value === heldProfileId)
      ? [{
        value: heldProfileId,
        // Only an authoritative list may say a profile is GONE. A list that
        // did not answer, or answered in part, says what it actually knows —
        // that it is still holding this id and could not check it.
        label: profiles.coverage === 'complete'
          ? translate(
            'plugins.triage.surface.actions.field.profileMissing',
            'Profile no longer in your account',
          )
          : translate(
            'plugins.triage.surface.actions.field.profileUnchecked',
            'Keeping the profile you configured',
          ),
      }]
      : [];
    return [
      {
        value: '',
        label: translate(
          'plugins.triage.surface.actions.field.profileNone',
          'Choose at start',
        ),
      },
      ...rows,
      ...missing,
    ];
  }, [heldProfileId, profiles, translate]);

  const close = React.useCallback(() => {
    setTarget(null);
    setDraft(null);
  }, []);

  const submit = React.useCallback(async () => {
    if (target === null || draft === null) return;
    const applied = await actions.administer(
      target.kind === 'create'
        ? triageCreateActionInputV1(draft, target.baseRevision)
        : triageUpdateActionInputV1(target.actionId, draft, target.baseRevision),
    );
    // The draft survives a refusal: throwing away what somebody typed because
    // another device won the revision race is the one thing this editor must
    // never do.
    if (applied !== null) close();
  }, [actions, close, draft, target]);

  const move = React.useCallback(async (actionId: string, direction: 'up' | 'down') => {
    const order = triageMovedActionOrderV1(actions.actions, actionId, direction);
    if (order === null || actions.revision === null) return;
    await actions.administer(triageReorderActionsInputV1(order, actions.revision));
  }, [actions]);

  /**
   * Nothing is writable until the Account's own catalog has been read.
   *
   * Before the first read this editor is showing the shipped seed, which is
   * what ABSENCE means rather than what the Account holds. A write formed
   * against it would name a revision this mount never saw, so the controls stay
   * disabled for the moment it takes to answer instead of offering a save that
   * could only be refused.
   */
  const busy = actions.busy || actions.unavailableReason !== null || actions.revision === null;
  const blocker = draft === null ? null : triageActionDraftBlockerV1(draft);
  const draftRevisionStale = target === null
    ? false
    : isTriageActionDraftRevisionStaleV1(target.baseRevision, actions.revision);

  return (
    /*
     * One scroll owner, and it is the editor's own.
     *
     * The shell's work region is clipped (`ui/shell/root.tsx`), so everything
     * below the fold of a long draft — including the control that commits it —
     * was unreachable at short viewports, at large type sizes, and with a
     * larger action catalog above the form. Wrapping the region the editor
     * SHARES with the list would have been the other way to reach it, and it is
     * the wrong one: the list is virtualized and owns the only scroller its
     * reveal, measurement and keyboard paging can work through.
     */
    <ScrollArea
      testID={TRIAGE_ACTIONS_EDITOR_SCROLL_TEST_ID_V1}
      style={TRIAGE_ACTIONS_EDITOR_SCROLL_STYLE_V1}
    >
    <Stack gap="small">
      <Row gap="small" align="center">
        <Heading
          level={2}
          valueKey="plugins.triage.surface.actions.title"
          value="Actions"
        />
        <Button
          titleKey="plugins.triage.surface.actions.add"
          title="Add an action"
          variant="primary"
          disabled={busy}
          onPress={() => {
            if (actions.revision === null) return;
            setTarget({ kind: 'create', baseRevision: actions.revision });
            setDraft(newTriageActionDraftV1());
          }}
        />
        {props.onClose === undefined ? null : (
          <Button
            titleKey="plugins.triage.surface.actions.close"
            title="Done"
            variant="secondary"
            onPress={props.onClose}
          />
        )}
      </Row>

      {actions.unavailableReason === null ? null : (
        <Row gap="small" align="center">
          <Status tone="warning" label={actions.unavailableReason} />
          <Button
            titleKey="plugins.triage.surface.actions.retry"
            title="Retry"
            variant="secondary"
            onPress={actions.retry}
          />
        </Row>
      )}
      {actions.notice === null ? null : (
        <Status
          tone={actions.notice.tone}
          label={actions.notice.message}
        />
      )}
      {actions.loaded && actions.read.kind === 'unreadable' ? (
        <Status
          tone="warning"
          labelKey="plugins.triage.surface.actions.unreadable"
          label="These actions were written by a newer version of Happier, so they were left untouched."
        />
      ) : null}

      {actions.actions.length === 0 ? (
        <EmptyState
          titleKey="plugins.triage.surface.actions.empty.title"
          title="No actions"
          descriptionKey="plugins.triage.surface.actions.empty.description"
          description="Nothing can be started from an entry until you add an action here."
        />
      ) : (
        <Stack gap="small">
          {actions.actions.map((action, index) => (
            <TriageActionRow
              key={action.actionId}
              action={action}
              busy={busy}
              first={index === 0}
              last={index === actions.actions.length - 1}
              onEdit={() => {
                if (actions.revision === null) return;
                setTarget({
                  kind: 'update',
                  actionId: action.actionId,
                  baseRevision: actions.revision,
                });
                setDraft(triageActionDraftV1(action));
              }}
              onDelete={() => {
                if (actions.revision === null) return;
                void actions.administer(
                  triageDeleteActionInputV1(action.actionId, actions.revision),
                );
              }}
              onMove={(direction) => { void move(action.actionId, direction); }}
            />
          ))}
        </Stack>
      )}

      {draft === null || target === null ? null : (
        <Stack gap="small">
          <Heading
            level={3}
            valueKey={target.kind === 'create'
              ? 'plugins.triage.surface.actions.form.create'
              : 'plugins.triage.surface.actions.form.update'}
            value={target.kind === 'create' ? 'New action' : 'Edit action'}
          />
          <TextField
            labelKey="plugins.triage.surface.actions.field.label"
            label="Name"
            value={draft.label}
            onChange={(label) => { setDraft({ ...draft, label }); }}
          />
          <Toggle
            label={translate('plugins.triage.surface.actions.field.enabled', 'Offer this action')}
            value={draft.enabled}
            onChange={(enabled) => { setDraft({ ...draft, enabled }); }}
          />
          <Select
            label={translate('plugins.triage.surface.actions.field.appliesTo', 'Offer it on')}
            multiple
            options={options(TRIAGE_EDITOR_SUBJECTS_V1, SUBJECT_LABELS, translate)}
            value={[...draft.appliesTo]}
            onChange={(value) => { setDraft(withTriageAppliesToV1(draft, stringList(value))); }}
          />
          <Select
            label={translate('plugins.triage.surface.actions.field.workspaceMode', 'It needs')}
            options={options(TRIAGE_EDITOR_WORKSPACE_MODES_V1, WORKSPACE_LABELS, translate)}
            value={draft.workspaceMode}
            onChange={(value) => {
              const mode = firstString(value);
              if (mode === null) return;
              const admitted = TRIAGE_EDITOR_WORKSPACE_MODES_V1
                .find((candidate) => candidate === mode);
              if (admitted === undefined) return;
              setDraft({ ...draft, workspaceMode: admitted });
            }}
          />
          <Select
            label={translate('plugins.triage.surface.actions.field.arm', 'Pressing it')}
            options={options(TRIAGE_EDITOR_TARGET_KINDS_V1, TARGET_LABELS, translate)}
            value={draft.target.kind}
            onChange={(value) => {
              const kind = firstString(value);
              const admitted = TRIAGE_EDITOR_TARGET_KINDS_V1
                .find((candidate) => candidate === kind);
              if (admitted === undefined) return;
              setDraft(withTriageActionTargetKindV1(draft, admitted));
            }}
          />
          {/*
            * A PICKER first, because the record stores `LaunchProfileV2.id` —
            * an opaque stable identity nobody can type — so asking a person to
            * type one makes the member unwritable in practice.
            *
            * And a field BESIDE it whenever the picker cannot be authoritative.
            * The picker is only an authoring path while the catalog answers;
            * when it does not, a picker alone is no path at all, and this
            * member was left unwritable through every surface. The field is the
            * fallback, never the primary way in.
            */}
          <Select
            label={translate(
              'plugins.triage.surface.actions.field.profileId',
              'Launch profile',
            )}
            options={profileOptions}
            value={draft.profileId ?? ''}
            onChange={(value) => {
              setDraft(withTriageProfileIdV1(draft, firstString(value) ?? ''));
            }}
          />
          {profiles.coverage === 'complete' || profiles.pending ? null : (
            <TextField
              labelKey="plugins.triage.surface.actions.field.profileIdRaw"
              label="Launch profile id (your profiles could not be listed)"
              value={draft.profileId ?? ''}
              onChange={(profileId) => {
                setDraft(withTriageProfileIdV1(draft, profileId));
              }}
            />
          )}
          {/*
            * The prompt is offered on BOTH arms, because both answer the same
            * question: an agent action sends it, and `review.start` takes it as
            * its required `instructions`. It is a PICKER rather than a text
            * field because the record stores the Library's stable id, which
            * nobody can type — a field here would make a correct reference
            * unwritable and leave the member configured-looking and inert.
            */}
          <Select
            label={translate('plugins.triage.surface.actions.field.prompt', 'Prompt')}
            options={promptOptions}
            value={draft.target.promptInvocationId ?? ''}
            onChange={(value) => {
              setDraft(withTriagePromptTokenV1(draft, firstString(value) ?? ''));
            }}
          />
          {!promptAllowsArgs || draft.target.promptInvocationId === null ? null : (
            <TextField
              labelKey="plugins.triage.surface.actions.field.promptArgs"
              label="Prompt arguments"
              value={draft.target.promptArgsText ?? ''}
              onChange={(promptArgsText) => {
                setDraft(withTriagePromptArgsTextV1(draft, promptArgsText));
              }}
            />
          )}
          {draft.target.kind !== 'agent' ? null : (
            <Stack gap="small">
              <Select
                label={translate('plugins.triage.surface.actions.field.delivery', 'Then')}
                options={options(TRIAGE_EDITOR_DELIVERIES_V1, DELIVERY_LABELS, translate)}
                value={draft.target.delivery}
                onChange={(value) => {
                  const delivery = firstString(value);
                  const admitted = TRIAGE_EDITOR_DELIVERIES_V1
                    .find((candidate) => candidate === delivery);
                  if (admitted === undefined) return;
                  setDraft(withTriageDeliveryV1(draft, admitted));
                }}
              />
            </Stack>
          )}
          {blocker === null ? null : (
            <Status
              tone="muted"
              labelKey={blocker === 'label'
                ? 'plugins.triage.surface.actions.blocker.label'
                : blocker === 'appliesTo'
                  ? 'plugins.triage.surface.actions.blocker.appliesTo'
                  : 'plugins.triage.surface.actions.blocker.instruction'}
              label={blocker === 'label'
                ? 'Give this action a name.'
                : blocker === 'appliesTo'
                  ? 'Choose at least one kind of entry to offer it on.'
                  : 'Choose a Prompt Library entry before this action can start work.'}
            />
          )}
          {!draftRevisionStale ? null : (
            <Row gap="small" align="center">
              <Status
                tone="warning"
                labelKey="plugins.triage.surface.actions.draftStale"
                label="Actions changed while this draft was open. Reload or reapply it before saving."
              />
              <Button
                titleKey={target.kind === 'update'
                  ? 'plugins.triage.surface.actions.reload'
                  : 'plugins.triage.surface.actions.reapply'}
                title={target.kind === 'update'
                  ? translate('plugins.triage.surface.actions.reload', 'Reload action')
                  : translate('plugins.triage.surface.actions.reapply', 'Reapply draft')}
                variant="secondary"
                disabled={actions.revision === null}
                onPress={() => {
                  const currentRevision = actions.revision;
                  if (currentRevision === null) return;
                  if (target.kind === 'create') {
                    setTarget({ kind: 'create', baseRevision: currentRevision });
                    return;
                  }
                  const current = actions.actions.find(
                    (action) => action.actionId === target.actionId,
                  );
                  if (current === undefined) {
                    close();
                    return;
                  }
                  setDraft(triageActionDraftV1(current));
                  setTarget({
                    kind: 'update',
                    actionId: target.actionId,
                    baseRevision: currentRevision,
                  });
                }}
              />
            </Row>
          )}
          <Row gap="small" align="center">
            <Button
              titleKey="plugins.triage.surface.actions.save"
              title="Save"
              variant="primary"
              disabled={busy || blocker !== null || draftRevisionStale}
              onPress={() => { void submit(); }}
            />
            <Button
              titleKey="plugins.triage.surface.actions.cancel"
              title="Cancel"
              variant="secondary"
              onPress={close}
            />
          </Row>
        </Stack>
      )}
    </Stack>
    </ScrollArea>
  );
}

type TriageActionRowProps = Readonly<{
  action: TriageActionV1;
  busy: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down') => void;
}>;

function TriageActionRow(props: TriageActionRowProps): React.ReactElement {
  const { action, busy } = props;
  // The same resolution the pressed control uses: a still-shipped label
  // translates and a renamed one shows the person's own words, so the editor
  // and the control can never disagree about what an action is called.
  const titleKey = readTriageActionTitleKeyV1(action);
  return (
    <Row gap="small" align="center">
      <Text {...(titleKey === null ? {} : { valueKey: titleKey })} value={action.label} />
      {action.enabled ? null : (
        <Status
          tone="muted"
          labelKey="plugins.triage.surface.actions.disabled"
          label="Not offered"
        />
      )}
      <Button
        titleKey="plugins.triage.surface.actions.moveUp"
        title="Move up"
        variant="secondary"
        disabled={busy || props.first}
        onPress={() => { props.onMove('up'); }}
      />
      <Button
        titleKey="plugins.triage.surface.actions.moveDown"
        title="Move down"
        variant="secondary"
        disabled={busy || props.last}
        onPress={() => { props.onMove('down'); }}
      />
      <Button
        titleKey="plugins.triage.surface.actions.edit"
        title="Configure"
        variant="secondary"
        disabled={busy}
        onPress={props.onEdit}
      />
      <Button
        titleKey="plugins.triage.surface.actions.remove"
        title="Remove"
        variant="secondary"
        disabled={busy}
        onPress={props.onDelete}
      />
    </Row>
  );
}
