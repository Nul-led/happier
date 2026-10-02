import type { AttachmentDraft } from '@/components/sessions/attachments/attachmentDraftModel';
import {
    clearAttachmentDraftsForKey,
    clearAttachmentDraftsForKeyPrefix,
    readAttachmentDraftsForKey,
    writeAttachmentDraftsForKey,
} from '@/components/sessions/attachments/attachmentDraftMemoryStore';

const NEW_SESSION_ATTACHMENT_DRAFT_KEY_PREFIX = 'new-session:';
const removalListeners = new Set<(flowId: string | null) => void>();

function normalizeFlowId(flowId: string | null | undefined): string | null {
    if (typeof flowId !== 'string') return null;
    const trimmed = flowId.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function newSessionAttachmentDraftKey(flowId: string): string {
    return `${NEW_SESSION_ATTACHMENT_DRAFT_KEY_PREFIX}${flowId}`;
}

export function readNewSessionAttachmentDrafts(flowId: string | null | undefined): readonly AttachmentDraft[] {
    const normalizedFlowId = normalizeFlowId(flowId);
    if (!normalizedFlowId) return [];

    return readAttachmentDraftsForKey(newSessionAttachmentDraftKey(normalizedFlowId));
}

export function writeNewSessionAttachmentDrafts(
    flowId: string | null | undefined,
    drafts: readonly AttachmentDraft[],
): void {
    const normalizedFlowId = normalizeFlowId(flowId);
    if (!normalizedFlowId) return;

    writeAttachmentDraftsForKey(newSessionAttachmentDraftKey(normalizedFlowId), drafts);
}

export function clearNewSessionAttachmentDrafts(flowId: string | null | undefined): void {
    const normalizedFlowId = normalizeFlowId(flowId);
    if (!normalizedFlowId) return;
    clearAttachmentDraftsForKey(newSessionAttachmentDraftKey(normalizedFlowId));
    for (const listener of removalListeners) listener(normalizedFlowId);
}

/** Mounted composers release their own sources when the draft owner removes the flow. */
export function subscribeNewSessionAttachmentDraftRemoval(flowId: string, onRemoved: () => void): () => void {
    const normalizedFlowId = normalizeFlowId(flowId);
    const listener = (removedFlowId: string | null) => {
        if (removedFlowId === null || removedFlowId === normalizedFlowId) onRemoved();
    };
    removalListeners.add(listener);
    return () => { removalListeners.delete(listener); };
}

/** Accepted custody settles the detached Send, not files added to its successor draft. */
export function clearAcceptedNewSessionAttachmentDrafts(
    flowId: string | null | undefined,
    acceptedDrafts: readonly AttachmentDraft[],
    currentDrafts: readonly AttachmentDraft[] = readNewSessionAttachmentDrafts(flowId),
): readonly AttachmentDraft[] {
    const acceptedIds = new Set(acceptedDrafts.map((draft) => draft.id));
    const remaining = currentDrafts.filter((draft) => !acceptedIds.has(draft.id));
    writeNewSessionAttachmentDrafts(flowId, remaining);
    return remaining;
}

export function clearAllNewSessionAttachmentDrafts(): void {
    clearAttachmentDraftsForKeyPrefix(NEW_SESSION_ATTACHMENT_DRAFT_KEY_PREFIX);
    for (const listener of removalListeners) listener(null);
}
