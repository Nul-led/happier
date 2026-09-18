import { describe, expect, it } from 'vitest';

import { buildSessionFolderMoveTargetSignature } from './useSessionListViewState';

describe('session list content signatures', () => {
    it('keeps control-character-bearing folder move target tuples distinct', () => {
        const first = buildSessionFolderMoveTargetSignature('folders', {
            t: 'workspaceScope',
            serverId: 'home\u0000one',
            machineId: 'machine\u0001part',
            rootPath: '/repo\u0002part',
        }, 'folder');
        const second = buildSessionFolderMoveTargetSignature('folders', {
            t: 'workspaceScope',
            serverId: 'home',
            machineId: 'one\u0000machine\u0001part',
            rootPath: '/repo\u0002part',
        }, 'folder');

        expect(first).not.toBe(second);
    });
});
