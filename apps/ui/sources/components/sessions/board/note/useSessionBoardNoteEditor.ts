import * as React from 'react';

import {
    buildSessionSurfaceNoteDocumentV1,
    readSessionSurfaceNoteTextV1,
    SessionSurfaceItemV1Schema,
    type SessionSurfaceItemV1,
} from '@happier-dev/protocol/sessions/board';

import type {
    SessionBoardActionsPort,
    SessionBoardItemPlacementInput,
    SessionBoardMutationResult,
} from '@/sync/domains/session/board';
import { sessionBoardNoteDraftBufferKey } from '../SessionBoardContinuity';
import type { SessionBoardMutationApprovalRequest } from '../sessionBoardMutationApproval';
import {
    useSessionBoardItemEditor,
    type SessionBoardItemBuildResult,
    type SessionBoardItemEditorStatus,
    type SessionBoardItemRecoveryObservation,
} from '../useSessionBoardItemEditor';

/**
 * The person-authored Note draft, projected onto the one Board item editor.
 *
 * Everything about the save lifecycle — draft retention, flush ordering, CAS
 * conflict review, approval continuation and acknowledgement-loss recovery —
 * belongs to {@link useSessionBoardItemEditor}. A Note contributes only the two
 * facts that make it a Note: how a draft becomes a declarative document, and
 * how that document's text is read back out of a submitted item.
 */

/** A draft is the one Note input that can exceed the canonical document bound. */
export type SessionBoardNoteEditorInvalidReason =
    | 'session_board_note_too_large'
    | 'session_board_invalid';

export type SessionBoardNoteEditorStatus =
    SessionBoardItemEditorStatus<SessionBoardNoteEditorInvalidReason>;

export type SessionBoardNoteEditorInput = Readonly<{
    sessionId: string;
    /** Opaque stable item id. Editing reuses the existing one; creating mints a new one. */
    itemId: string;
    /** `null` creates the item; creation is atomic with its first placement. */
    expectedItemRevision: string | null;
    /** Placement for a newly created note. Ignored for an in-place update. */
    placement?: SessionBoardItemPlacementInput;
    initialTitle?: string;
    initialBody?: string;
    /** Existing item metadata retained while only title/body are edited. */
    baseItem?: SessionSurfaceItemV1;
    /**
     * The revision of the record as currently read by the repository. After a
     * conflict this is the version the person reviews, and reviewing it is what
     * adopts it as the next expected revision.
     */
    latestRevision?: string | null;
    /** The current authoritative body; null means the refresh has not produced a reviewable Note. */
    latestBody?: string | null;
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
     * Flush the markdown surface's debounced edit and return the value it now
     * holds. Save reads the body FROM this canonical editor owner rather than from
     * a draft snapshot, because the snapshot predates the final keystroke. `null`
     * means the surface has no value to report and the retained draft stands.
     */
    flushBody?: () => Promise<string | null>;
}>;

export type SessionBoardNoteEditor = Readonly<{
    title: string;
    body: string;
    setTitle: (next: string) => void;
    setBody: (next: string) => void;
    dirty: boolean;
    dirtyRef: React.MutableRefObject<boolean>;
    status: SessionBoardNoteEditorStatus;
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

export function buildSessionBoardNoteItem(input: Readonly<{
    title: string;
    body: string;
    baseItem?: SessionSurfaceItemV1;
}>): SessionSurfaceItemV1 | null {
    const result = buildSessionBoardNoteItemResult(input);
    return result.ok ? result.item : null;
}

function buildSessionBoardNoteItemResult(input: Readonly<{
    title: string;
    body: string;
    baseItem?: SessionSurfaceItemV1;
}>): SessionBoardItemBuildResult<SessionBoardNoteEditorInvalidReason> {
    const document = buildSessionSurfaceNoteDocumentV1(input.body);
    if (!document.ok) return { ok: false, error: 'session_board_note_too_large' };
    const item = SessionSurfaceItemV1Schema.safeParse({
        ...(input.baseItem ?? {
            v: 1,
            frame: 'card',
            height: { mode: 'auto', fallback: 'regular' },
        }),
        title: input.title.trim(),
        source: { kind: 'declarative', document: document.document },
    });
    return item.success
        ? { ok: true, item: item.data }
        : { ok: false, error: 'session_board_invalid' };
}

/** The editable text of a submitted Note item, used only to reconcile recovery. */
function readSessionBoardNoteItemText(item: SessionSurfaceItemV1): string | null {
    return item.source.kind === 'declarative'
        ? readSessionSurfaceNoteTextV1(item.source.document)
        : null;
}

export function useSessionBoardNoteEditor(input: SessionBoardNoteEditorInput): SessionBoardNoteEditor {
    const buildItem = React.useCallback((draft: Readonly<{
        title: string;
        text: string;
        baseItem?: SessionSurfaceItemV1;
    }>) => buildSessionBoardNoteItemResult({
        title: draft.title,
        body: draft.text,
        ...(draft.baseItem ? { baseItem: draft.baseItem } : {}),
    }), []);
    const editor = useSessionBoardItemEditor<SessionBoardNoteEditorInvalidReason>({
        sessionId: input.sessionId,
        itemId: input.itemId,
        expectedItemRevision: input.expectedItemRevision,
        ...(input.placement ? { placement: input.placement } : {}),
        initialTitle: input.initialTitle ?? '',
        initialText: input.initialBody ?? '',
        ...(input.baseItem ? { baseItem: input.baseItem } : {}),
        ...(input.latestRevision === undefined ? {} : { latestRevision: input.latestRevision }),
        ...(input.latestBody === undefined ? {} : { latestText: input.latestBody }),
        reachable: input.reachable,
        ...(input.approvalPending === undefined ? {} : { approvalPending: input.approvalPending }),
        ...(input.recoveryObservation ? { recoveryObservation: input.recoveryObservation } : {}),
        ...(input.requestRecoveryRefresh ? { requestRecoveryRefresh: input.requestRecoveryRefresh } : {}),
        ...(input.requestApprovalContinuation
            ? { requestApprovalContinuation: input.requestApprovalContinuation }
            : {}),
        actions: input.actions,
        ...(input.onSaved ? { onSaved: input.onSaved } : {}),
        ...(input.flushBody ? { flushText: input.flushBody } : {}),
        draftBufferKey: sessionBoardNoteDraftBufferKey(input.itemId, input.expectedItemRevision),
        buildItem,
        readText: readSessionBoardNoteItemText,
    });
    return {
        title: editor.title,
        body: editor.text,
        setTitle: editor.setTitle,
        setBody: editor.setText,
        dirty: editor.dirty,
        dirtyRef: editor.dirtyRef,
        status: editor.status,
        reviewLatest: editor.reviewLatest,
        canReviewLatest: editor.canReviewLatest,
        canSave: editor.canSave,
        expectedRevision: editor.expectedRevision,
        save: editor.save,
        flushToContinuity: editor.flushToContinuity,
    };
}
