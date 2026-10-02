import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { installWorkspaceFileDetailsCommonModuleMocks } from './workspaceFileDetailsTestHelpers';
import { useWorkspaceFileDetailsLoading } from './useWorkspaceFileDetailsLoading';
installWorkspaceFileDetailsCommonModuleMocks();
const transport = vi.hoisted(() => ({ diff: vi.fn(), stat: vi.fn(), read: vi.fn() }));
// Remote filesystem/SCM and platform digest boundaries; the loader stays real.
vi.mock('@/sync/ops/scm/machineScm', () => ({ machineScmDiffFile: transport.diff }));
vi.mock('@/sync/domains/transfers/runtime/transferRuntime', () => ({ callDaemonWorkspaceStatFileRpc: transport.stat, downloadDaemonWorkspaceFileToBase64: transport.read }));
vi.mock('@/config', () => ({ config: { filesPreviewMaxBytes: 1000000 } }));
vi.mock('@/platform/digest', () => ({ digest: async () => new Uint8Array(32) }));
const patch = (text: string) => `diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+${text}\n`;
const input = { scope: { serverId: 'server', machineId: 'machine', rootPath: '/repo' }, filePath: 'file.txt', diffMode: 'pending' as const, fileEntryKind: 'modified' as const, isActive: true, refreshFingerprint: '1' };
let current: ReturnType<typeof useWorkspaceFileDetailsLoading>;
function Harness(props: Parameters<typeof useWorkspaceFileDetailsLoading>[0]) { current = useWorkspaceFileDetailsLoading(props); return null; }
beforeEach(() => {
    transport.diff.mockReset().mockResolvedValue({ success: true, diff: patch('new') });
    transport.stat.mockReset().mockResolvedValue({ success: true, exists: true, sizeBytes: 4 });
    transport.read.mockReset().mockResolvedValue({ ok: true, contentBase64: 'bmV3Cg==' });
});
it('shows progressive diff and ignores an obsolete mode result', async () => {
    let finishOld!: (value: { success: true; diff: string }) => void;
    transport.diff.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    let finishRead!: (value: { ok: true; contentBase64: string }) => void;
    transport.read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    await act(async () => { tree.update(<Harness {...input} diffMode="included" />); });
    expect(current.diffContent).toBe(patch('new'));
    expect(current.isLoading).toBe(false);
    await act(async () => { finishOld({ success: true, diff: patch('obsolete') }); finishRead({ ok: true, contentBase64: 'b2xkCg==' }); });
    expect(current.diffContent).toBe(patch('new'));
    expect(current.fileContent?.content).toBe('new\n');
    await act(async () => { tree.unmount(); });
});
it('defers hidden refresh and preserves equal content references', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    const content = current.fileContent;
    await act(async () => { tree.update(<Harness {...input} isActive={false} refreshFingerprint="2" />); });
    expect(transport.read).toHaveBeenCalledTimes(1);
    await act(async () => { tree.update(<Harness {...input} refreshFingerprint="2" />); });
    expect(transport.read).toHaveBeenCalledTimes(2);
    expect(current.fileContent).toBe(content);
    expect(current.isLoading).toBe(false);
    await act(async () => { tree.unmount(); });
});
it('shows a useful patch while full content is pending', async () => {
    let finishRead!: (value: { ok: true; contentBase64: string }) => void;
    transport.read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    expect(current.diffContent).toBe(patch('new'));
    expect(current.isLoading).toBe(false);
    expect(current.fileContent).toBe(null);
    await act(async () => { finishRead({ ok: true, contentBase64: 'bmV3Cg==' }); tree.unmount(); });
});
it('aborts a preview transfer on hide, superseding refresh, and unmount without publishing stale content', async () => {
    const signals: AbortSignal[] = [];
    const finishReads: Array<(value: { ok: true; contentBase64: string }) => void> = [];
    transport.read.mockImplementation((options: { signal?: AbortSignal }) => {
        if (options.signal) signals.push(options.signal);
        return new Promise(resolve => { finishReads.push(resolve); });
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    await act(async () => { tree.update(<Harness {...input} isActive={false} />); });
    expect(signals[0].aborted).toBe(true);
    await act(async () => { finishReads[0]({ ok: true, contentBase64: 'b2xkCg==' }); });
    expect(current.fileContent).toBe(null);
    await act(async () => { tree.update(<Harness {...input} />); });
    expect(signals).toHaveLength(2);
    let refresh!: Promise<void>;
    await act(async () => { refresh = current.refreshAll(); });
    expect(signals[1].aborted).toBe(true);
    expect(signals[2].aborted).toBe(false);
    await act(async () => { tree.unmount(); });
    expect(signals[2].aborted).toBe(true);
    await act(async () => {
        for (const finish of finishReads.slice(1)) finish({ ok: true, contentBase64: 'bmV3Cg==' });
        await refresh;
    });
});
it('does not start a transfer when the preview hides during stat', async () => {
    let finishStat!: (value: { success: true; exists: true; sizeBytes: number }) => void;
    transport.stat.mockImplementationOnce(() => new Promise(resolve => { finishStat = resolve; }));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    await act(async () => { tree.update(<Harness {...input} isActive={false} />); });
    await act(async () => { finishStat({ success: true, exists: true, sizeBytes: 4 }); });
    expect(transport.read).not.toHaveBeenCalled();
    expect(current.fileContent).toBe(null);
    await act(async () => { tree.unmount(); });
});
it('reuses full content for a mode-only switch but rereads on explicit refresh', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    const content = current.fileContent;
    await act(async () => { tree.update(<Harness {...input} diffMode="included" />); });
    expect(transport.read).toHaveBeenCalledTimes(1);
    expect(current.fileContent).toBe(content);
    await act(async () => { await current.refreshAll(); });
    expect(transport.read).toHaveBeenCalledTimes(2);
    await act(async () => { tree.unmount(); });
});
it('retains useful content on refresh failure but never carries it into another file', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    const content = current.fileContent;
    transport.diff.mockRejectedValue(new Error('offline'));
    transport.read.mockResolvedValue({ ok: false, error: 'offline' });
    await act(async () => { await current.refreshAll(); });
    expect(current.fileContent).toBe(content);
    expect(current.diffContent).toBe(patch('new'));
    expect(current.error).toBe('offline');
    await act(async () => { tree.update(<Harness {...input} filePath="other.txt" />); });
    expect(current.fileContent).toBe(null);
    expect(current.diffContent).toBe(null);
    await act(async () => { tree.unmount(); });
});

it('never presents another diff area while the new area loads or fails', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness {...input} />); });
    expect(current.diffContent).toBe(patch('new'));
    let failDiff!: (reason: Error) => void;
    transport.diff.mockImplementationOnce(() => new Promise((_resolve, reject) => { failDiff = reject; }));
    await act(async () => { tree.update(<Harness {...input} diffMode="included" />); });
    expect(current.diffContent).toBe(null);
    await act(async () => { failDiff(new Error('included unavailable')); });
    expect(current.diffContent).toBe(null);
    expect(current.error).toBe('included unavailable');
    await act(async () => { tree.unmount(); });
});
