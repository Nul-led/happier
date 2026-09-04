import { describe, expect, it, vi } from 'vitest';

import { runUniversalSearchActivation } from './runUniversalSearchActivation';
import { prepareUniversalSearchResult } from './prepareUniversalSearchResult';
import type { UniversalSearchTarget } from './universalSearchResult';

describe('prepareUniversalSearchResult', () => {
    it.each(['deleted', 'revoked'] as const)(
        'keeps Search open when an exact scoped Session became %s',
        async () => {
            const target: UniversalSearchTarget = {
                kind: 'session',
                serverId: 'home-b',
                accountId: 'account-b',
                sessionId: 'same-session',
                seq: 42,
            };
            const dismiss = vi.fn();
            const activate = vi.fn(async () => true);
            const presentFailure = vi.fn();
            const readExactSession = vi.fn(async () => ({ ok: false }));

            await runUniversalSearchActivation({
                prepare: () => prepareUniversalSearchResult(target, {
                    isTargetCurrent: () => true,
                    readExactSession,
                }),
                dismiss,
                activate,
                presentFailure,
            });

            expect(readExactSession).toHaveBeenCalledWith({
                serverId: 'home-b',
                accountId: 'account-b',
                sessionId: 'same-session',
                seq: 42,
            });
            expect(dismiss).not.toHaveBeenCalled();
            expect(activate).not.toHaveBeenCalled();
            expect(presentFailure).toHaveBeenCalledOnce();
        },
    );

    it('keeps Search open when a message is no longer inside the current publication ceiling', async () => {
        const target: UniversalSearchTarget = {
            kind: 'session',
            serverId: 'home-b',
            accountId: 'account-b',
            sessionId: 'shared-session',
            seq: 43,
        };
        const dismiss = vi.fn();
        const activate = vi.fn(async () => true);

        await runUniversalSearchActivation({
            prepare: () => prepareUniversalSearchResult(target, {
                isTargetCurrent: () => true,
                readExactSession: async () => ({ ok: true, visibleThroughSeq: 42 }),
            }),
            dismiss,
            activate,
            presentFailure: vi.fn(),
        });

        expect(dismiss).not.toHaveBeenCalled();
        expect(activate).not.toHaveBeenCalled();
    });

    it('does not issue a Session read when a workspace target already failed currentness', async () => {
        const readExactSession = vi.fn(async () => ({ ok: true, visibleThroughSeq: 1 }));
        const target: UniversalSearchTarget = {
            kind: 'workspaceFile',
            scope: { serverId: 'home-b', machineId: 'machine-b', rootPath: '/repo/b' },
            path: 'src/index.ts',
            workspaceRefId: null,
            sessionId: 'same-session',
            serverId: 'home-b',
            accountId: 'account-b',
        };

        await expect(prepareUniversalSearchResult(target, {
            isTargetCurrent: () => false,
            readExactSession,
        })).resolves.toBe(false);
        expect(readExactSession).not.toHaveBeenCalled();
    });
});
