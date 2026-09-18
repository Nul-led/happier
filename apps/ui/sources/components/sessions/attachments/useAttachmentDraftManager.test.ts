import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';

vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { useAttachmentDraftManager } from './useAttachmentDraftManager';

describe('useAttachmentDraftManager', () => {
    it('keeps the manager object and its callbacks referentially stable across parent re-renders', async () => {
        // The manager is consumed by memoized composer/transcript surfaces; a fresh object per
        // render cascades into per-commit re-renders of every visible transcript row.
        const hook = await renderHook(() => useAttachmentDraftManager({
            enabled: true,
            maxFileBytes: 1024,
        }));

        const first = hook.getCurrent();
        await hook.rerender();
        const second = hook.getCurrent();

        expect(second).toBe(first);
        expect(second.replaceDrafts).toBe(first.replaceDrafts);
        expect(second.removeDraft).toBe(first.removeDraft);
        expect(second.clearDrafts).toBe(first.clearDrafts);
        expect(second.addWebFiles).toBe(first.addWebFiles);
        expect(second.addPickedAttachments).toBe(first.addPickedAttachments);
        expect(second.applyDraftPatch).toBe(first.applyDraftPatch);
        expect(second.getDraftsSnapshot).toBe(first.getDraftsSnapshot);
        expect(second.getDraftRevisionSnapshot).toBe(first.getDraftRevisionSnapshot);
    });

    it('returns a new manager identity when drafts change', async () => {
        const hook = await renderHook(() => useAttachmentDraftManager({
            enabled: true,
            maxFileBytes: 1024,
        }));

        const before = hook.getCurrent();
        await act(async () => {
            before.replaceDrafts([{
                id: 'draft-1',
                source: { kind: 'memory', name: 'a.txt', bytes: new Uint8Array([1]) },
                status: 'pending',
            } as never]);
        });

        const after = hook.getCurrent();
        expect(after).not.toBe(before);
        expect(after.drafts).toHaveLength(1);
        expect(after.hasSendableAttachments).toBe(true);
    });

    it('advances the draft revision for an explicit clear even when drafts are already empty', async () => {
        const hook = await renderHook(() => useAttachmentDraftManager({
            enabled: true,
            maxFileBytes: 1024,
        }));

        const before = hook.getCurrent().getDraftRevisionSnapshot();
        await act(async () => {
            hook.getCurrent().clearDrafts();
        });

        expect(hook.getCurrent().drafts).toEqual([]);
        expect(hook.getCurrent().getDraftRevisionSnapshot()).toBe(before + 1);
    });

    it('publishes the current process-local snapshot synchronously with each mutation', async () => {
        const hook = await renderHook(() => useAttachmentDraftManager({
            enabled: true,
            maxFileBytes: 1024,
        }));

        const manager = hook.getCurrent();
        const nextDraft = {
            id: 'draft-immediate',
            source: { kind: 'memory', name: 'instant.txt', bytes: new Uint8Array([1]) },
            status: 'pending',
        } as const;

        await act(async () => {
            manager.replaceDrafts([nextDraft]);
            expect(manager.getDraftsSnapshot()).toEqual([nextDraft]);

            manager.clearDrafts();
            expect(manager.getDraftsSnapshot()).toEqual([]);
        });
    });
});
