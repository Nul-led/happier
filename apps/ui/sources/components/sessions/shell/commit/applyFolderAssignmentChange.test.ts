import { describe, expect, it, vi } from 'vitest';

import { applyFolderAssignmentChange } from './applyFolderAssignmentChange';

describe('applyFolderAssignmentChange', () => {
    it('does not serialize mutations for distinct delimiter-bearing Session addresses', async () => {
        let releaseFirst: () => void = () => {
            throw new Error('first mutation was not started');
        };
        const firstPending = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const secondStarted = vi.fn();

        const first = applyFolderAssignmentChange({
            serverId: 'https://home.example/a',
            sessionId: 'b:c',
            folderId: 'folder-a',
            setSessionFolderAssignment: async () => firstPending,
        });
        const second = applyFolderAssignmentChange({
            serverId: 'https://home.example/a:b',
            sessionId: 'c',
            folderId: 'folder-b',
            setSessionFolderAssignment: async () => {
                secondStarted();
            },
        });

        await vi.waitFor(() => {
            expect(secondStarted).toHaveBeenCalledTimes(1);
        });

        releaseFirst();
        await Promise.all([first, second]);
    });
});
