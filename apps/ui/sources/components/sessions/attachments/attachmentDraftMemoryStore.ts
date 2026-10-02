import type { AttachmentDraft } from './attachmentDraftModel';

const attachmentDraftMemoryStore = new Map<string, readonly AttachmentDraft[]>();

function copyAttachmentDrafts(drafts: readonly AttachmentDraft[]): AttachmentDraft[] {
    return drafts.map((draft) => ({
        ...draft,
        source: { ...draft.source },
        uploadProgress: draft.uploadProgress ? { ...draft.uploadProgress } : undefined,
    }));
}

export function readAttachmentDraftsForKey(key: string): AttachmentDraft[] {
    const drafts = attachmentDraftMemoryStore.get(key);
    return drafts ? copyAttachmentDrafts(drafts) : [];
}

export function writeAttachmentDraftsForKey(key: string, drafts: readonly AttachmentDraft[]): void {
    if (drafts.length === 0) {
        attachmentDraftMemoryStore.delete(key);
        return;
    }

    attachmentDraftMemoryStore.set(key, copyAttachmentDrafts(drafts));
}

export function clearAttachmentDraftsForKey(key: string): void {
    attachmentDraftMemoryStore.delete(key);
}

export function clearAttachmentDraftsForKeyPrefix(prefix: string): void {
    for (const key of attachmentDraftMemoryStore.keys()) {
        if (key.startsWith(prefix)) {
            attachmentDraftMemoryStore.delete(key);
        }
    }
}
