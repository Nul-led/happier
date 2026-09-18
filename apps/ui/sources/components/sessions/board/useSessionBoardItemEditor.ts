import * as React from 'react';

import {
    SessionSurfaceItemV1Schema,
    type SessionBoardActionRecoveryEvidenceV1,
    type SessionBoardItemUpsertInputV1,
    type SessionSurfaceItemV1,
} from '@happier-dev/protocol/sessions/board';

import type {
    SessionBoardActionUnavailableReason,
    SessionBoardActionsPort,
    SessionBoardItemPlacementInput,
    SessionBoardMutationResult,
} from '@/sync/domains/session/board';
import { readSessionBoardUpsertItemRevision } from '@/sync/domains/session/board';
import { useMountedSessionBoardContinuity } from './SessionBoardContinuity';
import {
    classifySessionBoardMutationApprovalFailure,
    isSessionBoardUpsertIntentCommitted,
    type SessionBoardMutationApprovalRequest,
} from './sessionBoardMutationApproval';

/**
 * The one person-authored Board item editor: a title plus one text body — a
 * Note's markdown or an interactive view's HTML — and the save lifecycle both
 * share. The two item kinds differ only in how a draft becomes an item and how
 * the text is read back out of one; those two facts are the parameters.
 *
 * The draft lives here, in the editor the person is looking at, and survives
 * refresh, offline and conflict for as long as that editor is mounted. V1 makes
 * no restart or cross-device promise for it, and nothing durable is written
 * except by an explicit Save.
 *
 * Save goes through the shared Board Actions port — the same
 * `session.board.item.upsert` an Agent uses. There is no Board-local write
 * path, and a lost acknowledgement is reported as unknown rather than
 * resubmitted behind the person's back with fresh ciphertext.
 */

export type SessionBoardItemEditorStatus<TInvalid extends string> =
    | Readonly<{ kind: 'editing' }>
    | Readonly<{ kind: 'saving' }>
    /** The builder refused the draft before any write; the draft stays editable. */
    | Readonly<{ kind: 'invalid'; error: TInvalid }>
    /** The record moved underneath the draft. Both versions are kept; nothing is merged. */
    | Readonly<{ kind: 'conflict'; reviewed: boolean }>
    /** The acknowledgement was lost; the server may or may not have committed. */
    | Readonly<{
        kind: 'outcomeUnknown';
        /** Exact semantic intent; approval terminals do not carry sealed transport evidence. */
        intent: SessionBoardItemUpsertInputV1;
        recovery: SessionBoardActionRecoveryEvidenceV1 | null;
    }>
    | Readonly<{ kind: 'approvalPending'; artifactId: string; actionId: string }>
    | Readonly<{ kind: 'unavailable'; reason: SessionBoardActionUnavailableReason }>
    | Readonly<{ kind: 'failed'; error: string }>;

export type SessionBoardItemBuildResult<TInvalid extends string> =
    | Readonly<{ ok: true; item: SessionSurfaceItemV1 }>
    | Readonly<{ ok: false; error: TInvalid }>;

export type SessionBoardItemRecoveryObservation = Readonly<
    | { state: 'refreshing'; revision: string | null; item: SessionSurfaceItemV1 | null }
    | { state: 'settled'; revision: string | null; item: SessionSurfaceItemV1 | null }
>;

export type SessionBoardItemEditorInput<TInvalid extends string> = Readonly<{
    sessionId: string;
    /** Opaque stable item id. Editing reuses the existing one; creating mints a new one. */
    itemId: string;
    /** `null` creates the item; creation is atomic with its first placement. */
    expectedItemRevision: string | null;
    /** Placement for a newly created item. Ignored for an in-place update. */
    placement?: SessionBoardItemPlacementInput;
    initialTitle: string;
    initialText: string;
    /** Existing item metadata retained while only title/text are edited. */
    baseItem?: SessionSurfaceItemV1;
    /**
     * The revision of the record as currently read by the repository. After a
     * conflict this is the version the person reviews, and reviewing it is what
     * adopts it as the next expected revision.
     */
    latestRevision?: string | null;
    /** The current authoritative text; null means the refresh has not produced a reviewable record. */
    latestText?: string | null;
    /** The Home is reachable right now. Offline keeps the draft and explains Save. */
    reachable: boolean;
    /** Another exact Board mutation is already held by the shared approval owner. */
    approvalPending?: boolean;
    /** Canonical record observation used only to reconcile a lost acknowledgement. */
    recoveryObservation?: SessionBoardItemRecoveryObservation;
    /** Re-run the canonical Board read after an ambiguous mutation. */
    requestRecoveryRefresh?: () => void;
    requestApprovalContinuation?: (request: SessionBoardMutationApprovalRequest) => void;
    actions: SessionBoardActionsPort;
    onSaved?: (result: SessionBoardMutationResult | null, committedItemRevision: string | null) => void;
    /**
     * Flush the embedded surface's debounced edit and return the value it now
     * holds. Save reads the text FROM this canonical editor owner rather than
     * from a draft snapshot, because the snapshot predates the final keystroke.
     * `null` means the surface has no value to report and the retained draft stands.
     */
    flushText?: () => Promise<string | null>;
    /** Where this editor's retained draft lives in Board continuity. */
    draftBufferKey: string;
    /** Turns the draft into the exact item to submit, or a typed refusal. */
    buildItem: (input: Readonly<{
        title: string;
        text: string;
        baseItem?: SessionSurfaceItemV1;
    }>) => SessionBoardItemBuildResult<TInvalid>;
    /** Reads this editor's text back out of a submitted item during recovery. */
    readText: (item: SessionSurfaceItemV1) => string | null;
}>;

export type SessionBoardItemEditor<TInvalid extends string> = Readonly<{
    title: string;
    text: string;
    setTitle: (next: string) => void;
    setText: (next: string) => void;
    dirty: boolean;
    dirtyRef: React.MutableRefObject<boolean>;
    status: SessionBoardItemEditorStatus<TInvalid>;
    /** Adopt the reviewed record as the base of the next deliberate Save. */
    reviewLatest: () => void;
    canReviewLatest: boolean;
    canSave: boolean;
    /** Expected revision the next Save submits. */
    expectedRevision: string | null;
    save: () => Promise<boolean>;
    /** Flushes the embedded surface and publishes its exact draft before a host handoff. */
    flushToContinuity: () => Promise<void>;
}>;

export function useSessionBoardItemEditor<TInvalid extends string>(
    input: SessionBoardItemEditorInput<TInvalid>,
): SessionBoardItemEditor<TInvalid> {
    type DraftBuffer = Readonly<{ title: string; text: string }>;
    type Status = SessionBoardItemEditorStatus<TInvalid>;
    const continuity = useMountedSessionBoardContinuity();
    const draftBufferKey = input.draftBufferKey;
    const restoredDraft = continuity?.editorDrafts.read<DraftBuffer>(draftBufferKey);
    const [title, setTitleState] = React.useState(restoredDraft?.title ?? input.initialTitle);
    const [text, setTextState] = React.useState(restoredDraft?.text ?? input.initialText);
    // Save reads the draft through these refs so a value published between the
    // press and the awaited flush cannot be lost to a stale render closure.
    const titleRef = React.useRef(title);
    const textRef = React.useRef(text);
    titleRef.current = title;
    textRef.current = text;
    const setTitle = React.useCallback((next: string) => {
        titleRef.current = next;
        setTitleState(next);
    }, []);
    const setText = React.useCallback((next: string) => {
        textRef.current = next;
        setTextState(next);
    }, []);
    React.useEffect(() => {
        continuity?.editorDrafts.write<DraftBuffer>(draftBufferKey, { title, text });
    }, [continuity, draftBufferKey, text, title]);
    const [baseline, setBaseline] = React.useState(() => Object.freeze({
        title: input.initialTitle,
        text: input.initialText,
    }));
    const [status, setStatus] = React.useState<Status>({ kind: 'editing' });
    const statusRef = React.useRef(status);
    statusRef.current = status;
    const updateStatus = React.useCallback((next: Status) => {
        statusRef.current = next;
        setStatus(next);
    }, []);
    // Keep the original CAS operand until the person explicitly reviews the
    // current record. Refreshing must never silently turn Save into overwrite.
    const [expectedRevision, setExpectedRevision] = React.useState<string | null>(input.expectedItemRevision);
    const recoveryRefreshObservedRef = React.useRef(false);
    const recoveryRefreshRequestedRef = React.useRef(false);
    const conflictRefreshObservedRef = React.useRef(false);
    const conflictProjectionAtRequestRef = React.useRef<Readonly<{
        revision: string | null | undefined;
        text: string | null | undefined;
    }> | null>(null);
    const [conflictRefreshReady, setConflictRefreshReady] = React.useState(false);

    const dirty = title !== baseline.title || text !== baseline.text;
    const dirtyRef = React.useRef(dirty);
    dirtyRef.current = dirty;

    const inputRef = React.useRef(input);
    inputRef.current = input;

    const flushToContinuity = React.useCallback(async (): Promise<void> => {
        const flushed = await inputRef.current.flushText?.();
        const nextText = typeof flushed === 'string' ? flushed : textRef.current;
        if (nextText !== textRef.current) setText(nextText);
        // The outgoing editor is still mounted here. Publish directly instead
        // of relying on the state effect that will disappear with that host:
        // the exact editor value must be available to the next placement's
        // state initializer in this same handoff.
        continuity?.editorDrafts.write<DraftBuffer>(draftBufferKey, {
            title: titleRef.current,
            text: nextText,
        });
    }, [continuity, draftBufferKey, setText]);

    const canReviewLatest = typeof input.latestRevision === 'string'
        && conflictRefreshReady
        && input.latestRevision !== expectedRevision
        && input.latestText !== null
        && input.latestText !== undefined;
    const reviewLatest = React.useCallback(() => {
        const current = inputRef.current;
        const latest = current.latestRevision;
        // A conflict starts a repository refresh, but the retained snapshot can
        // still be the exact revision the editor originally opened. Reviewing
        // that stale row must not turn it into a deliberate overwrite operand.
        if (typeof latest !== 'string'
            || !conflictRefreshReady
            || latest === expectedRevision
            || current.latestText === null
            || current.latestText === undefined) return;
        updateStatus(statusRef.current.kind === 'conflict'
            ? { kind: 'conflict', reviewed: true }
            : statusRef.current);
        setExpectedRevision(latest);
    }, [conflictRefreshReady, expectedRevision, updateStatus]);

    const rememberConflict = React.useCallback(() => {
        conflictRefreshObservedRef.current = false;
        conflictProjectionAtRequestRef.current = {
            revision: inputRef.current.latestRevision,
            text: inputRef.current.latestText,
        };
        setConflictRefreshReady(false);
        updateStatus({ kind: 'conflict', reviewed: false });
        inputRef.current.requestRecoveryRefresh?.();
    }, [updateStatus]);

    const rememberUnknownOutcome = React.useCallback((
        intent: SessionBoardItemUpsertInputV1,
        recovery: SessionBoardActionRecoveryEvidenceV1 | null,
    ) => {
        recoveryRefreshObservedRef.current = false;
        recoveryRefreshRequestedRef.current = true;
        updateStatus({ kind: 'outcomeUnknown', intent, recovery });
        inputRef.current.requestRecoveryRefresh?.();
    }, [updateStatus]);

    const settleSaved = React.useCallback((
        result: SessionBoardMutationResult,
        committedTitle: string,
        committedText: string,
    ) => {
        setBaseline(Object.freeze({ title: committedTitle, text: committedText }));
        const committed = readSessionBoardUpsertItemRevision(result);
        if (committed !== null) setExpectedRevision(committed);
        updateStatus({ kind: 'editing' });
        inputRef.current.onSaved?.(result, committed);
    }, [updateStatus]);

    const save = React.useCallback(async (): Promise<boolean> => {
        const current = inputRef.current;
        if (!current.reachable
            || current.approvalPending === true
            || statusRef.current.kind === 'saving'
            || statusRef.current.kind === 'outcomeUnknown'
            || statusRef.current.kind === 'approvalPending'
            || (statusRef.current.kind === 'conflict' && !statusRef.current.reviewed)) return false;
        updateStatus({ kind: 'saving' });
        // Flush first, then read: the debounced surface publishes the final
        // keystroke during the flush, and only the value it holds afterwards is
        // the text this person meant to save.
        const flushed = await current.flushText?.();
        if (typeof flushed === 'string' && flushed !== textRef.current) setText(flushed);
        const nextText = typeof flushed === 'string' ? flushed : textRef.current;
        const nextTitle = titleRef.current;
        const built = current.buildItem({
            title: nextTitle,
            text: nextText,
            ...(current.baseItem ? { baseItem: current.baseItem } : {}),
        });
        if (!built.ok) {
            updateStatus({ kind: 'invalid', error: built.error });
            return false;
        }
        const actionInput = {
            sessionId: current.sessionId,
            itemId: current.itemId,
            expectedItemRevision: expectedRevision,
            item: built.item,
            ...(expectedRevision === null && current.placement ? { placement: current.placement } : {}),
        };
        const outcome = await current.actions.upsertItem(actionInput);
        switch (outcome.status) {
            case 'ok':
                settleSaved(outcome.value, nextTitle, nextText);
                return true;
            case 'refused':
                if (outcome.error.error === 'session_board_revision_conflict') rememberConflict();
                else updateStatus({ kind: 'failed', error: outcome.error.error });
                return false;
            case 'unavailable':
                updateStatus({ kind: 'unavailable', reason: outcome.reason });
                return false;
            case 'outcome_unknown':
                rememberUnknownOutcome(actionInput, outcome.recovery);
                return false;
            case 'pending_approval':
                updateStatus({
                    kind: 'approvalPending',
                    artifactId: outcome.approval.artifactId,
                    actionId: outcome.approval.actionId,
                });
                if (!current.requestApprovalContinuation) {
                    updateStatus({ kind: 'failed', error: 'approval_continuation_unavailable' });
                    return false;
                }
                current.requestApprovalContinuation({
                    approval: outcome.approval,
                    actionId: 'session.board.item.upsert',
                    expectedInput: actionInput,
                    onSucceeded: async (value) => settleSaved(value, nextTitle, nextText),
                    onFailed: (code, actionFailure) => {
                        const failure = classifySessionBoardMutationApprovalFailure(code);
                        if (failure === 'outcomeUnknown') {
                            const recovery = actionFailure?.errorCode === 'outcome_unknown'
                                && 'details' in actionFailure
                                ? actionFailure.details.recovery
                                : null;
                            rememberUnknownOutcome(actionInput, recovery);
                            return;
                        }
                        if (failure === 'conflict') {
                            rememberConflict();
                            return;
                        }
                        updateStatus(failure === 'cancelled'
                            ? { kind: 'editing' }
                            : failure === 'denied'
                                ? { kind: 'failed', error: 'session_board_forbidden' }
                                : { kind: 'failed', error: code });
                    },
                });
                return false;
            case 'cancelled':
                updateStatus({ kind: 'editing' });
                return false;
            case 'failed':
                updateStatus({ kind: 'failed', error: outcome.code });
                return false;
        }
    }, [expectedRevision, rememberConflict, rememberUnknownOutcome, setText, settleSaved, updateStatus]);

    React.useEffect(() => {
        if (status.kind !== 'conflict' || conflictRefreshReady) return;
        const observation = input.recoveryObservation;
        if (observation?.state === 'refreshing') {
            conflictRefreshObservedRef.current = true;
            return;
        }
        const before = conflictProjectionAtRequestRef.current;
        const projectionChanged = before !== null
            && (input.latestRevision !== before.revision || input.latestText !== before.text);
        if (projectionChanged || (conflictRefreshObservedRef.current && observation?.state === 'settled')) {
            setConflictRefreshReady(true);
        }
    }, [conflictRefreshReady, input.latestRevision, input.latestText, input.recoveryObservation, status.kind]);

    React.useEffect(() => {
        if (status.kind !== 'outcomeUnknown') return;
        const intent = status.intent;
        const observation = input.recoveryObservation;
        if (intent.itemId !== input.itemId || !observation) return;
        if (observation.state === 'refreshing') {
            recoveryRefreshObservedRef.current = true;
            return;
        }

        const submittedItem = SessionSurfaceItemV1Schema.parse(intent.item);
        const committed = isSessionBoardUpsertIntentCommitted({
            intent,
            revision: observation.revision,
            item: observation.item,
        });
        if (committed) {
            setBaseline(Object.freeze({
                title: submittedItem.title,
                text: input.readText(submittedItem) ?? textRef.current,
            }));
            if (observation.revision !== null) setExpectedRevision(observation.revision);
            updateStatus({ kind: 'editing' });
            input.onSaved?.(null, observation.revision);
            return;
        }
        if (!recoveryRefreshRequestedRef.current) return;
        // Absence or a different value becomes evidence only after invalidation's
        // canonical refresh, never from the snapshot that predated the request.
        if (!recoveryRefreshObservedRef.current) return;
        if (observation.revision !== intent.expectedItemRevision) {
            setConflictRefreshReady(true);
        }
        updateStatus(observation.revision === intent.expectedItemRevision
            ? { kind: 'editing' }
            : { kind: 'conflict', reviewed: false });
    }, [input.itemId, input.onSaved, input.readText, input.recoveryObservation, status, updateStatus]);

    const canSave = input.reachable
        && input.approvalPending !== true
        && status.kind !== 'saving'
        // A conflict is resolvable only after the current record has been reviewed.
        && (status.kind !== 'conflict' || status.reviewed)
        // An unknown outcome is reconciled by refreshing the record, not by resubmitting.
        && status.kind !== 'outcomeUnknown'
        // The shared Action approval host owns continuation; this editor never resubmits it.
        && status.kind !== 'approvalPending';

    return {
        title,
        text,
        setTitle,
        setText,
        dirty,
        dirtyRef,
        status,
        reviewLatest,
        canReviewLatest,
        canSave,
        expectedRevision,
        save,
        flushToContinuity,
    };
}
