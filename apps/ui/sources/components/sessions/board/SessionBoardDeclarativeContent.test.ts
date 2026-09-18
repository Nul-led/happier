import { describe, expect, it } from 'vitest';

import { resolveSessionBoardDeclarativeContentDocument } from './SessionBoardDeclarativeContent';

describe('SessionBoardDeclarativeContent admission', () => {
    it('adopts the normalized shared declarative model instead of raw stored grammar', () => {
        const normalized = resolveSessionBoardDeclarativeContentDocument({
            version: 1,
            root: {
                kind: 'stack',
                children: [{ kind: 'markdown', text: '# Note' }],
            },
        });

        expect(normalized?.root).toMatchObject({ kind: 'stack', path: 'root', order: 0 });
        expect(normalized?.nodes[1]).toMatchObject({
            kind: 'markdown',
            path: 'root.children[0]',
            order: 1,
        });
    });

    it('fails closed for raw plugin-authority grammar even if it reaches the mount', () => {
        expect(resolveSessionBoardDeclarativeContentDocument({
            version: 1,
            root: {
                kind: 'action',
                label: 'Run',
                action: { pluginId: 'com.acme.test', localId: 'run' },
            },
        })).toBeNull();
    });
});
