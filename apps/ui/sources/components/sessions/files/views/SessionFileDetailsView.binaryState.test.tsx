import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import type { Session, ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import type { Project } from '@/sync/runtime/orchestration/projectManager';
import { installSessionFilesViewCommonModuleMocks } from './sessionFilesViewsTestHelpers';
import { FileBinaryState } from '@/components/sessions/files/file/FileScreenState';

const video = vi.hoisted(() => ({
    modifiedMs: 1,
    download: vi.fn(),
    revoke: vi.fn(),
    sourceCounter: 0,
}));
vi.mock('@/sync/ops', () => ({
    sessionStatFile: async () => ({ success: true, exists: true, kind: 'file', sizeBytes: 12_000_000, modifiedMs: video.modifiedMs }),
    sessionReadFile: vi.fn(),
    sessionScmDiffFile: vi.fn(),
}));
vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline', () => ({ downloadDaemonSessionFileToDestination: video.download }));
vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});
vi.mock('expo-video', () => ({
    VideoView: 'VideoView',
    useVideoPlayer: (source: string) => React.useMemo(() => ({
        source, status: 'readyToPlay', currentTime: 0, pause: vi.fn(),
        addListener: () => ({ remove: vi.fn() }),
    }), [source]),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__DEV__ = false;

installSessionFilesViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (spec: any) => spec?.web ?? spec?.default,
            },
        });
    },
    storage: async (importOriginal) => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSession: () => binarySession,
            useProjectForSession: () => binaryProject,
            useSessionWorkspacePath: () => '/workspace',
            useSessions: () => [],
            useSessionReviewCommentsDrafts: () => [],
            useSessionProjectScmCommitSelectionPaths: () => [],
            useSessionProjectScmCommitSelectionPatches: () => [],
            useSessionProjectScmInFlightOperation: () => null,
            useSessionProjectScmSnapshot: () => binarySnapshot,
            useSetting: () => null,
            importOriginal,
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

vi.mock('@/components/sessions/files/file/FileHeader', () => ({
  FileHeader: (props: any) => React.createElement('FileHeader', props, props.rightElement ?? null),
}));

vi.mock('@/components/sessions/sourceControl/changes/ScmChangeDiscardButton', () => ({
  ScmChangeDiscardButton: (props: any) => React.createElement('ScmChangeDiscardButton', props),
}));

vi.mock('@/components/sessions/files/file/FileActionToolbar', () => ({
  FileActionToolbar: (props: any) => React.createElement('FileActionToolbar', props, props.rightElement ?? null),
}));

vi.mock('@/components/sessions/files/file/FileContentPanel', () => ({
  FileContentPanel: (props: any) => React.createElement('FileContentPanel', props),
}));

vi.mock('@/components/sessions/files/file/editor/FileEditorPanel', () => ({
  FileEditorPanel: (props: any) => React.createElement('FileEditorPanel', props),
}));

vi.mock('@/components/ui/markdown/editor/RichMarkdownEditorPanel', () => ({
  RichMarkdownEditorPanel: (props: any) => React.createElement('RichMarkdownEditorPanel', props),
}));

vi.mock('@/hooks/ui/useMountedRef', () => ({
  useMountedRef: () => ({ current: true }),
}));

vi.mock('@/components/ui/scroll/useScrollEdgeFades', () => ({
  useScrollEdgeFades: () => ({
    visibility: { top: false, bottom: false, left: false, right: false },
    onViewportLayout: vi.fn(),
    onContentSizeChange: vi.fn(),
    onScroll: vi.fn(),
  }),
}));

vi.mock('@/components/ui/scroll/ScrollEdgeFades', () => ({
  ScrollEdgeFades: (props: any) => React.createElement('ScrollEdgeFades', props),
}));

vi.mock('@/components/ui/scroll/ScrollEdgeIndicators', () => ({
  ScrollEdgeIndicators: (props: any) => React.createElement('ScrollEdgeIndicators', props),
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
  useAppPaneScope: () => ({
    scopeState: { details: { tabState: {} } },
    setDetailsTabState: vi.fn(),
  }),
}));

const startDownloadSpy = vi.fn(async (_input: any) => ({ ok: true as const }));
const downloadAvailabilityState = { value: true };
const binarySession: Session = createSessionFixture({
    id: 's1',
    active: true,
    metadata: {
        path: '/workspace',
        host: 'tester.local',
        homeDir: '/Users/tester',
        machineId: 'm1',
    } as Session['metadata'],
});
const binaryProject: Project = {
    id: 'project-1',
    key: { machineId: 'm1', path: '/workspace' },
    sessionIds: ['s1'],
    createdAt: 1,
    updatedAt: 1,
};
const binaryEntry: ScmWorkingSnapshot['entries'][number] = {
    path: 'bin.zip',
    kind: 'modified',
    includeStatus: 'unmodified',
    pendingStatus: 'modified',
    hasIncludedDelta: false,
    hasPendingDelta: true,
    previousPath: null,
    stats: {
        pendingAdded: 1,
        pendingRemoved: 1,
        includedAdded: 0,
        includedRemoved: 0,
        isBinary: true,
    },
};
let binarySnapshot: ScmWorkingSnapshot = {
    projectKey: 'project-1',
    fetchedAt: 1,
    repo: {
        isRepo: true,
        rootPath: '/workspace',
        backendId: 'git',
        mode: '.git',
        worktrees: [],
    },
    branch: {
        head: 'main',
        upstream: null,
        ahead: 0,
        behind: 0,
        detached: false,
    },
    hasConflicts: false,
    entries: [binaryEntry],
    totals: {
        includedFiles: 0,
        pendingFiles: 1,
        untrackedFiles: 0,
        includedAdded: 0,
        includedRemoved: 0,
        pendingAdded: 1,
        pendingRemoved: 1,
    },
    capabilities: { writeDiscard: true } as ScmWorkingSnapshot['capabilities'],
};

vi.mock('@/hooks/session/files/useWorkspaceFileTransfers', () => ({
  useWorkspaceFileTransfers: () => ({
    uploadState: { status: 'idle' },
    downloadState: { status: 'idle' },
    startUploads: vi.fn(async () => ({ ok: true })),
    cancelUploads: vi.fn(),
    startDownload: (input: any) => startDownloadSpy(input),
    cancelDownload: vi.fn(),
  }),
}));

vi.mock('@/hooks/session/files/useFileScmStageActions', () => ({
  useFileScmStageActions: () => ({
    isApplyingStage: false,
    handleStage: vi.fn(),
    handleUnstage: vi.fn(),
    applySelectedLines: vi.fn(),
  }),
}));

vi.mock('./sessionFileDetails/useSessionFileEditorState', () => ({
  useSessionFileEditorState: () => ({
    editorSurfaceEnabled: false,
    editorSeedText: '',
    editorHandleRef: { current: null },
    onEditorChange: vi.fn(),
    getEditorText: () => '',
    editorDirty: false,
    editorTooLarge: false,
    editorChunkTooLarge: false,
    isEditingFile: false,
    isSavingEdits: false,
    fileWriteSupported: true,
    startEditingFile: vi.fn(),
    cancelEditingFile: vi.fn(),
    saveFileEdits: vi.fn(),
    editorResetKey: 0,
  }),
}));

vi.mock('@/components/sessions/reviews/comments/useSessionReviewCommentDraftHandlers', () => ({
  useSessionReviewCommentDraftHandlers: () => ({
    onUpsertReviewCommentDraft: vi.fn(),
    onDeleteReviewCommentDraft: vi.fn(),
    onReviewCommentError: vi.fn(),
  }),
}));

vi.mock('@/components/ui/code/highlighting/useCodeLinesSyntaxHighlighting', () => ({
  useCodeLinesSyntaxHighlighting: () => ({ syntaxHighlighting: null }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
  useFeatureEnabled: (id: string) => id === 'scm.writeOperations',
}));

vi.mock('@/scm/scmLineSelection', () => ({
  buildFileLineSelectionFingerprint: () => 'fp',
  canUseLineSelection: () => false,
    canStartLineSelection: () => false,
}));

vi.mock('@/utils/code/fileLanguage', () => ({
  getFileLanguageFromPath: () => 'txt',
}));

vi.mock('@/scm/settings/commitStrategy', () => ({
  SCM_COMMIT_STRATEGIES: ['atomic', 'git_staging'],
  allowsLiveStaging: () => false,
  isAtomicCommitStrategy: () => true,
}));

vi.mock('@/scm/diff/defaultMode', () => ({
  resolveDefaultDiffModeForFile: () => 'pending',
}));

vi.mock('@/components/sessions/files/useSessionFileDownloadAvailability', () => ({
  useSessionFileDownloadAvailability: () => downloadAvailabilityState.value,
}));

beforeEach(() => {
  downloadAvailabilityState.value = true;
  binarySnapshot = { ...binarySnapshot, fetchedAt: 1, entries: [binaryEntry] };
  video.modifiedMs = 1;
  video.sourceCounter = 0;
  video.revoke.mockClear();
  video.download.mockReset().mockResolvedValue({ ok: true, name: 'demo.mp4', sizeBytes: 12_000_000 });
  vi.stubGlobal('URL', { createObjectURL: () => `blob:video-${++video.sourceCounter}`, revokeObjectURL: video.revoke });
});

describe('SessionFileDetailsView (binary)', () => {
  it('hides the download action when downloads are unavailable', async () => {
    downloadAvailabilityState.value = false;
    const { SessionFileDetailsView } = await import('./SessionFileDetailsView');

    let tree!: renderer.ReactTestRenderer;
    tree = (await renderScreen(<SessionFileDetailsView sessionId="s1" scopeId="session:s1" filePath="bin.zip" />)).tree;

    await act(async () => {});

    expect(tree.findAllByType('FileActionToolbar' as any).length).toBe(1);
    expect(tree.findAllByProps({ testID: 'file-header-download', accessibilityRole: 'button' }).length).toBe(0);
  });

  it('renders header actions even when file content is binary', async () => {
    const { SessionFileDetailsView } = await import('./SessionFileDetailsView');

    let tree!: renderer.ReactTestRenderer;
    tree = (await renderScreen(<SessionFileDetailsView sessionId="s1" scopeId="session:s1" filePath="bin.zip" />)).tree;

    // Flush the refresh effect.
    await act(async () => {});

    expect(tree.findAllByType('FileActionToolbar' as any).length).toBe(1);
    expect(tree.findByType('FileActionToolbar' as any).props.showWrapLinesToggle).toBe(false);
    expect(tree.findAllByType('ScmChangeDiscardButton' as any).length).toBe(1);
    expect(tree.findAllByProps({ testID: 'file-header-download', accessibilityRole: 'button' }).length).toBe(1);
    expect(tree.findAllByType(FileBinaryState).length).toBe(1);

    await act(async () => {
      await pressTestInstanceAsync(tree.findByProps({ testID: 'file-header-download', accessibilityRole: 'button' }));
    });

    expect(startDownloadSpy).toHaveBeenCalledWith({ path: 'bin.zip', asZip: false });
  });

  it('preserves a playing MP4 across unrelated SCM updates and reloads when that same-size file changes', async () => {
    await import('@/components/sessions/files/content/FileVideoPreview');
    const { SessionFileDetailsView } = await import('./SessionFileDetailsView');
    const screen = await renderScreen(<SessionFileDetailsView sessionId="s1" scopeId="session:s1" filePath="demo.mp4" />);
    await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
    const player = screen.findAllByType('VideoView')[0].props.player;
    player.currentTime = 15;
    const firstContent = screen.findByType(FileBinaryState).props;
    binarySnapshot = { ...binarySnapshot, fetchedAt: 2, entries: [binaryEntry, { ...binaryEntry, path: 'other.txt' }] };
    await screen.update(<SessionFileDetailsView sessionId="s1" scopeId="session:s1" filePath="demo.mp4" />);
    expect(screen.findAllByType('VideoView')[0].props.player).toBe(player);
    expect(player.currentTime).toBe(15);
    expect(video.download).toHaveBeenCalledTimes(1);
    expect(video.revoke).not.toHaveBeenCalled();
    expect(screen.findByType(FileBinaryState).props.videoPreviewRevision).toBe(firstContent.videoPreviewRevision);

    video.modifiedMs = 2;
    binarySnapshot = { ...binarySnapshot, fetchedAt: 3 };
    await screen.update(<SessionFileDetailsView sessionId="s1" scopeId="session:s1" filePath="demo.mp4" />);
    await vi.waitFor(() => expect(video.download).toHaveBeenCalledTimes(2));
    expect(screen.findAllByType('VideoView')[0].props.player).not.toBe(player);
    expect(player.pause).toHaveBeenCalled();
    expect(video.revoke).toHaveBeenCalledWith('blob:video-1');
  });
});
