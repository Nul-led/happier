import * as React from 'react';

import {
    PluginHostedHtmlSourceV1Schema,
} from '@happier-dev/protocol/plugins/ui';
import {
    SessionSurfaceItemV1Schema,
    type SessionSurfaceItemV1,
} from '@happier-dev/protocol/sessions/board';

import type {
    SessionBoardActionsPort,
    SessionBoardItemPlacementInput,
    SessionBoardMutationResult,
} from '@/sync/domains/session/board';
import { sessionBoardHostedHtmlDraftBufferKey } from '../SessionBoardContinuity';
import type { SessionBoardMutationApprovalRequest } from '../sessionBoardMutationApproval';
import {
    useSessionBoardItemEditor,
    type SessionBoardItemBuildResult,
    type SessionBoardItemEditorStatus,
    type SessionBoardItemRecoveryObservation,
} from '../useSessionBoardItemEditor';

/**
 * The person-authored interactive view, projected onto the one Board item
 * editor. Everything about the save lifecycle belongs to
 * {@link useSessionBoardItemEditor}; hosted HTML contributes only how a draft
 * becomes a `hostedHtml` item and how that item's source is read back out.
 */

export type SessionBoardHostedHtmlEditorInvalidReason =
    | 'hosted_html_source_too_large'
    | 'session_board_invalid';

export type SessionBoardHostedHtmlEditorStatus =
    SessionBoardItemEditorStatus<SessionBoardHostedHtmlEditorInvalidReason>;

export type SessionBoardHostedHtmlEditorInput = Readonly<{
    sessionId: string;
    itemId: string;
    expectedItemRevision: string | null;
    initialTitle: string;
    initialHtml: string;
    baseItem?: SessionSurfaceItemV1;
    /** Current record revision shown to the person before a deliberate conflict retry. */
    latestRevision?: string | null;
    /** Current authoritative HTML kept separate from the person's retained draft. */
    latestHtml?: string | null;
    placement?: SessionBoardItemPlacementInput;
    reachable: boolean;
    /** Another exact Board mutation is already held by the shared approval owner. */
    approvalPending?: boolean;
    recoveryObservation?: SessionBoardItemRecoveryObservation;
    requestRecoveryRefresh?: () => void;
    requestApprovalContinuation?: (request: SessionBoardMutationApprovalRequest) => void;
    actions: SessionBoardActionsPort;
    onSaved: (
        result: SessionBoardMutationResult | null,
        committedItemRevision: string | null,
        draftSettled: boolean,
    ) => void;
    flushHtml?: () => Promise<string | null>;
}>;

export function buildSessionBoardHostedHtmlItem(input: Readonly<{
    title: string;
    html: string;
    baseItem?: SessionSurfaceItemV1;
}>): SessionSurfaceItemV1 | null {
    const result = buildSessionBoardHostedHtmlItemResult(input);
    return result.ok ? result.item : null;
}

function buildSessionBoardHostedHtmlItemResult(input: Readonly<{
    title: string;
    html: string;
    baseItem?: SessionSurfaceItemV1;
}>): SessionBoardItemBuildResult<SessionBoardHostedHtmlEditorInvalidReason> {
    if (input.baseItem && input.baseItem.source.kind !== 'hostedHtml') {
        return { ok: false, error: 'session_board_invalid' };
    }
    const source = PluginHostedHtmlSourceV1Schema.safeParse({ kind: 'html', html: input.html });
    // The constructed source has the schema's fixed kind and string type, so
    // its only reachable refusal is the canonical UTF-8 source bound.
    if (!source.success) return { ok: false, error: 'hosted_html_source_too_large' };
    const item = SessionSurfaceItemV1Schema.safeParse(input.baseItem ? {
        ...input.baseItem,
        title: input.title.trim(),
        source: { ...input.baseItem.source, source: source.data },
    } : {
        v: 1,
        title: input.title.trim(),
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source: { kind: 'hostedHtml', source: source.data },
    });
    return item.success
        ? { ok: true, item: item.data }
        : { ok: false, error: 'session_board_invalid' };
}

/** The editable source of a submitted interactive view, used only to reconcile recovery. */
function readSessionBoardHostedHtmlItemText(item: SessionSurfaceItemV1): string | null {
    const source = item.source;
    return source.kind === 'hostedHtml' && source.source.kind === 'html'
        ? source.source.html
        : null;
}

export function useSessionBoardHostedHtmlEditor(input: SessionBoardHostedHtmlEditorInput) {
    const buildItem = React.useCallback((draft: Readonly<{
        title: string;
        text: string;
        baseItem?: SessionSurfaceItemV1;
    }>) => buildSessionBoardHostedHtmlItemResult({
        title: draft.title,
        html: draft.text,
        ...(draft.baseItem ? { baseItem: draft.baseItem } : {}),
    }), []);
    const editor = useSessionBoardItemEditor<SessionBoardHostedHtmlEditorInvalidReason>({
        sessionId: input.sessionId,
        itemId: input.itemId,
        expectedItemRevision: input.expectedItemRevision,
        ...(input.placement ? { placement: input.placement } : {}),
        initialTitle: input.initialTitle,
        initialText: input.initialHtml,
        ...(input.baseItem ? { baseItem: input.baseItem } : {}),
        ...(input.latestRevision === undefined ? {} : { latestRevision: input.latestRevision }),
        ...(input.latestHtml === undefined ? {} : { latestText: input.latestHtml }),
        reachable: input.reachable,
        ...(input.approvalPending === undefined ? {} : { approvalPending: input.approvalPending }),
        ...(input.recoveryObservation ? { recoveryObservation: input.recoveryObservation } : {}),
        ...(input.requestRecoveryRefresh ? { requestRecoveryRefresh: input.requestRecoveryRefresh } : {}),
        ...(input.requestApprovalContinuation
            ? { requestApprovalContinuation: input.requestApprovalContinuation }
            : {}),
        actions: input.actions,
        onSaved: input.onSaved,
        ...(input.flushHtml ? { flushText: input.flushHtml } : {}),
        draftBufferKey: sessionBoardHostedHtmlDraftBufferKey(input.itemId),
        buildItem,
        readText: readSessionBoardHostedHtmlItemText,
    });
    return {
        title: editor.title,
        html: editor.text,
        setTitle: editor.setTitle,
        setHtml: editor.setText,
        dirty: editor.dirty,
        dirtyRef: editor.dirtyRef,
        status: editor.status,
        reviewLatest: editor.reviewLatest,
        canReviewLatest: editor.canReviewLatest,
        expectedRevision: editor.expectedRevision,
        latestHtml: input.latestHtml ?? null,
        canSave: editor.canSave,
        save: editor.save,
        flushToContinuity: editor.flushToContinuity,
    } as const;
}
