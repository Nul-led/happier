import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useChangedFilesReviewDiffLoading } from './useChangedFilesReviewDiffLoading';
import { renderScreen } from '@/dev/testkit';
import { installFilesContentCommonModuleMocks } from './filesContentTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installFilesContentCommonModuleMocks();

const machineScmDiffFileSpy = vi.fn(async () => ({
    success: true,
    diff: 'Binary files a/src/image.png and b/src/image.png differ',
    error: null,
}));

vi.mock('@/sync/ops/scm/machineScm', () => ({
    machineScmDiffFile: () => machineScmDiffFileSpy(),
}));

vi.mock('@/sync/domains/session/resolveWorkspaceTargetForSession', () => ({
    resolveWorkspaceTargetForSession: () => ({
        workspaceCacheKey: 'server:m1:/repo',
        machineId: 'm1',
        rootPath: '/repo',
        serverId: 'server',
    }),
}));

vi.mock('@/sync/ops/workspaceFileSystem', () => ({
    workspaceReadFile: vi.fn(),
}));

describe('useChangedFilesReviewDiffLoading (binary placeholders)', () => {
    it('normalizes non-unified binary diff placeholders to an empty diff', async () => {
        machineScmDiffFileSpy.mockClear();

        const file = {
            fileName: 'image.png',
            filePath: 'src',
            fullPath: 'src/image.png',
            status: 'modified',
            isIncluded: false,
            linesAdded: 0,
            linesRemoved: 0,
        } as any;

        let diffStateSource: any = null;

        function Probe() {
            const reviewFiles = React.useMemo(() => [file], []);
            const normalizeError = React.useCallback((e: unknown) => String((e as any)?.message ?? e), []);
            const hook = useChangedFilesReviewDiffLoading({
                sessionId: 's1',
                isRepo: true,
                reviewFiles,
                diffArea: 'pending',
                tooLarge: false,
                selectedPath: 'src/image.png',
                minRefetchMs: 0,
                refreshToken: 0,
                normalizeError,
                fallbackError: 'fallback',
            });
            diffStateSource = hook.diffStateSource;
            return React.createElement('Probe');
        }

        await renderScreen(React.createElement(Probe));

        for (let i = 0; i < 30; i++) {
            await act(async () => {
                await flushHookEffects({ cycles: 1, turns: 1 });
            });
            const current = diffStateSource?.getDiffState?.('src/image.png');
            if (current?.status === 'loaded') break;
        }

        expect(machineScmDiffFileSpy).toHaveBeenCalledTimes(1);
        const finalState = diffStateSource?.getDiffState?.('src/image.png');
        expect(finalState?.status).toBe('loaded');
        expect(String(finalState?.diff ?? '')).toBe('');
    });
});
