import { describe, expect, it } from 'vitest';

import { resolveTemporaryComputerWaitingTarget } from './temporaryComputerWaitingTarget';

const committedTarget = {
    kind: 'temporary_computer',
    serverId: 'server-a',
    artifactTarget: 'linux-x64',
    workspace: { kind: 'choose_on_endpoint' },
} as const;

function projection(artifact: Readonly<{ target: string; version: string }>) {
    return { artifact } as never;
}

describe('resolveTemporaryComputerWaitingTarget', () => {
    it('names the destination from the authoring draft before an activation exists', () => {
        expect(resolveTemporaryComputerWaitingTarget({
            projection: null,
            committedTarget,
            homeLabel: 'Work',
            accountLabel: null,
        })).toEqual({
            homeLabel: 'Work',
            accountLabel: null,
            artifactTarget: 'linux-x64',
            workspace: 'choose_on_endpoint',
        });
    });

    // The live package already carries one platform. If the author switches the
    // composer to macOS while a Linux package waits on someone else's computer,
    // the waiting surface must keep describing the package that exists.
    it('keeps describing the activation the Home actually froze, not a later draft edit', () => {
        const resolved = resolveTemporaryComputerWaitingTarget({
            projection: projection({ target: 'linux-arm64', version: '0.3.7' }),
            committedTarget: { ...committedTarget, artifactTarget: 'darwin-arm64' },
            homeLabel: 'Work',
            accountLabel: null,
        });

        expect(resolved?.artifactTarget).toBe('linux-arm64');
    });

    it('qualifies a request that does not belong to the Account in focus', () => {
        expect(resolveTemporaryComputerWaitingTarget({
            projection: projection({ target: 'windows-x64', version: '0.3.7' }),
            committedTarget: null,
            homeLabel: 'Work',
            accountLabel: 'acc_other',
        })).toEqual({
            homeLabel: 'Work',
            accountLabel: 'acc_other',
            artifactTarget: 'windows-x64',
            workspace: null,
        });
    });

    it('reports no readable Home rather than an empty label', () => {
        expect(resolveTemporaryComputerWaitingTarget({
            projection: null,
            committedTarget,
            homeLabel: '   ',
            accountLabel: '  ',
        })).toMatchObject({ homeLabel: null, accountLabel: null });
    });

    it('has no destination to state without an activation or a committed target', () => {
        expect(resolveTemporaryComputerWaitingTarget({
            projection: null,
            committedTarget: null,
            homeLabel: 'Work',
            accountLabel: null,
        })).toBeNull();
    });
});
