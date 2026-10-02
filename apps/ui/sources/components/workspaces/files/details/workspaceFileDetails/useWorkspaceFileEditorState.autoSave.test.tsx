import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderHook } from '@/dev/testkit';
import { installWorkspaceFileDetailsCommonModuleMocks } from './workspaceFileDetailsTestHelpers';
import { workspaceFileEditorDraftCache } from './workspaceFileEditorDraftCache';
import { buildWorkspaceCacheKey } from '@/sync/domains/workspaces/workspaceScope';
import { useWorkspaceFileEditorState } from './useWorkspaceFileEditorState';

installWorkspaceFileDetailsCommonModuleMocks();

type WriteRpc = typeof import('@/sync/domains/transfers/runtime/transferRuntime').callDaemonWorkspaceWriteFileRpc;
type WriteResponse = Awaited<ReturnType<WriteRpc>>;
const writeRpcSpy = vi.hoisted(() => vi.fn<WriteRpc>());

// Keep file encoding, guarded-write handling and editor state real beneath the daemon RPC boundary.
vi.mock('@/sync/domains/transfers/runtime/transferRuntime', () => ({
    callDaemonWorkspaceWriteFileRpc: writeRpcSpy,
}));

const scope = { serverId: 'srv1', machineId: 'm1', rootPath: '/repo' };

async function createHarness(options: Readonly<{
    refreshAll?: () => Promise<void>;
    fileText?: string;
    fileHash?: string;
    startEditing?: boolean;
}> = {}) {
    const refreshAll = options.refreshAll ?? vi.fn(async () => undefined);
    const persistDraft = vi.fn();
    const hook = await renderHook(() => useWorkspaceFileEditorState({
        scope,
        filePath: 'src/a.ts',
        displayMode: 'file',
        fileText: options.fileText ?? 'hello',
        fileHash: options.fileHash ?? 'h1',
        fileWriteSupported: true,
        setFileWriteSupported: vi.fn(),
        fileEditorFeatureEnabled: true,
        filesEditorWebMonacoEnabled: true,
        filesEditorNativeCodeMirrorEnabled: true,
        filesEditorAutoSave: true,
        filesEditorChangeDebounceMs: 100,
        filesEditorMaxFileBytes: 1_000_000,
        filesEditorBridgeMaxChunkBytes: 1_000_000,
        mountedRef: { current: true },
        refreshAll,
        persistedDraft: null,
        persistDraft,
    }));
    if (options.startEditing !== false) await act(async () => hook.getCurrent().startEditingFile());
    return { ...hook, persistDraft };
}

function writtenRequests() {
    return writeRpcSpy.mock.calls.map(([params]) => ({
        ...params.request,
        content: Buffer.from(params.request.content, 'base64').toString('utf8'),
    }));
}

describe('useWorkspaceFileEditorState autosave', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        writeRpcSpy.mockReset();
        workspaceFileEditorDraftCache.setDraft({ workspaceCacheKey: buildWorkspaceCacheKey(scope), filePath: 'src/a.ts', draft: null });
    });

    afterEach(() => vi.useRealTimers());

    it('saves newer text after an in-flight write using the saved hash and keeps editing', async () => {
        const firstWrite = createDeferred<WriteResponse>();
        const secondWrite = createDeferred<WriteResponse>();
        writeRpcSpy.mockReturnValueOnce(firstWrite.promise).mockReturnValueOnce(secondWrite.promise);
        const hook = await createHarness();
        await act(async () => hook.getCurrent().onEditorChange('hello changed'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(hook.getCurrent().isSavingEdits).toBe(true);
        await act(async () => hook.getCurrent().onEditorChange('hello changed more'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(writtenRequests()).toEqual([{ path: 'src/a.ts', content: 'hello changed', expectedHash: 'h1' }]);

        await act(async () => firstWrite.resolve({ success: true, hash: 'h2' }));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(writtenRequests()).toEqual([
            { path: 'src/a.ts', content: 'hello changed', expectedHash: 'h1' },
            { path: 'src/a.ts', content: 'hello changed more', expectedHash: 'h2' },
        ]);
        await act(async () => secondWrite.resolve({ success: true, hash: 'h3' }));
        expect(hook.getCurrent().isEditingFile).toBe(true);
        expect(hook.getCurrent().editorDirty).toBe(false);
        expect(hook.getCurrent().getEditorText()).toBe('hello changed more');
        expect(hook.getCurrent().editorOriginalHash).toBe('h3');
    });

    it('keeps editing and debounces the latest text after a successful autosave', async () => {
        writeRpcSpy.mockResolvedValueOnce({ success: true, hash: 'h2' });
        const hook = await createHarness();
        await act(async () => hook.getCurrent().onEditorChange('hello changed'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(hook.getCurrent().isEditingFile).toBe(true);
        expect(hook.getCurrent().editorDirty).toBe(false);
        expect(hook.getCurrent().getEditorText()).toBe('hello changed');

        writeRpcSpy.mockResolvedValueOnce({ success: true, hash: 'h3' });
        await act(async () => hook.getCurrent().onEditorChange('hello again'));
        await act(async () => { vi.advanceTimersByTime(90); });
        await act(async () => hook.getCurrent().onEditorChange('hello again!'));
        await act(async () => { vi.advanceTimersByTime(90); });
        expect(writtenRequests()).toHaveLength(1);
        await act(async () => { vi.advanceTimersByTime(10); });
        expect(writtenRequests()[1]).toEqual({ path: 'src/a.ts', content: 'hello again!', expectedHash: 'h2' });
        expect(hook.getCurrent().isEditingFile).toBe(true);
    });

    it('saves text entered while the successful write is refreshing the file', async () => {
        const refresh = createDeferred<void>();
        writeRpcSpy.mockResolvedValueOnce({ success: true, hash: 'h2' });
        const hook = await createHarness({ refreshAll: () => refresh.promise });
        await act(async () => hook.getCurrent().onEditorChange('hello changed'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(hook.getCurrent().isSavingEdits).toBe(true);
        expect(hook.getCurrent().editorOriginalHash).toBe('h2');
        await act(async () => hook.getCurrent().onEditorChange('hello changed during refresh'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(writtenRequests()).toHaveLength(1);

        writeRpcSpy.mockResolvedValueOnce({ success: true, hash: 'h3' });
        await act(async () => refresh.resolve());
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(writtenRequests()[1]).toEqual({ path: 'src/a.ts', content: 'hello changed during refresh', expectedHash: 'h2' });
        expect(hook.getCurrent().isEditingFile).toBe(true);
        expect(hook.getCurrent().editorDirty).toBe(false);
    });

    it('restores newer unsaved text against the successful write baseline after remounting', async () => {
        const firstWrite = createDeferred<WriteResponse>();
        writeRpcSpy.mockReturnValueOnce(firstWrite.promise);
        const hook = await createHarness();
        await act(async () => hook.getCurrent().onEditorChange('hello changed'));
        await act(async () => { vi.advanceTimersByTime(100); });
        await act(async () => hook.getCurrent().onEditorChange('hello changed more'));
        await act(async () => firstWrite.resolve({ success: true, hash: 'h2' }));
        expect(hook.persistDraft).toHaveBeenLastCalledWith({
            isEditingFile: true,
            editorOriginalText: 'hello changed',
            editorOriginalHash: 'h2',
            editorText: 'hello changed more',
        });
        await hook.unmount();

        writeRpcSpy.mockResolvedValueOnce({ success: true, hash: 'h3' });
        const restored = await createHarness({ fileText: 'hello changed', fileHash: 'h2', startEditing: false });
        expect(restored.getCurrent().isEditingFile).toBe(true);
        expect(restored.getCurrent().getEditorText()).toBe('hello changed more');
        expect(restored.getCurrent().fileChangedExternally).toBe(false);
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(writtenRequests()[1]).toEqual({ path: 'src/a.ts', content: 'hello changed more', expectedHash: 'h2' });
    });

    it('retains failed edits without repeated writes and retries after the next edit', async () => {
        writeRpcSpy.mockResolvedValueOnce({ success: false, error: 'Disk unavailable', errorCode: 'FILE_WRITE_FAILED' });
        const hook = await createHarness();
        await act(async () => hook.getCurrent().onEditorChange('hello changed'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(hook.getCurrent().isEditingFile).toBe(true);
        expect(hook.getCurrent().editorDirty).toBe(true);
        expect(hook.getCurrent().getEditorText()).toBe('hello changed');
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(writtenRequests()).toHaveLength(1);

        writeRpcSpy.mockResolvedValueOnce({ success: true, hash: 'h2' });
        await act(async () => hook.getCurrent().onEditorChange('hello recovered'));
        await act(async () => { vi.advanceTimersByTime(100); });
        expect(writtenRequests()[1]).toEqual({ path: 'src/a.ts', content: 'hello recovered', expectedHash: 'h1' });
        expect(hook.getCurrent().editorDirty).toBe(false);
    });
});
