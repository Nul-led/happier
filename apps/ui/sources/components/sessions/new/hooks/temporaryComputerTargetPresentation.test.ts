import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RUNNER_ARTIFACT_TARGETS } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';

import { en } from '@/text/translations/en';

import type * as TargetPresentation from './temporaryComputerTargetPresentation';

vi.mock('@/text', async () => {
    // Resolves against the real English catalogue, so a row "labelled" through a
    // key nobody actually wrote reads as undefined here instead of passing.
    const { en: catalogue } = await import('@/text/translations/en');
    return {
        t: (key: string) => key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            catalogue as unknown,
        ),
    };
});

let describeRunnerArtifactTarget: typeof TargetPresentation.describeRunnerArtifactTarget;
let describeTemporaryComputerDestination: typeof TargetPresentation.describeTemporaryComputerDestination;
let describeExecutionTargetDestination: typeof TargetPresentation.describeExecutionTargetDestination;

beforeAll(async () => {
    ({
        describeRunnerArtifactTarget,
        describeTemporaryComputerDestination,
        describeExecutionTargetDestination,
    } = await import('./temporaryComputerTargetPresentation'));
});

describe('temporaryComputerTargetPresentation', () => {
    it('gives every published Runner artifact target a readable name', () => {
        for (const target of RUNNER_ARTIFACT_TARGETS) {
            const label = describeRunnerArtifactTarget(target);
            expect(typeof label).toBe('string');
            expect(label.length).toBeGreaterThan(0);
            // The wire identity must never be what the row shows.
            expect(label).not.toBe(target);
        }
        expect(new Set(RUNNER_ARTIFACT_TARGETS.map(describeRunnerArtifactTarget)).size)
            .toBe(RUNNER_ARTIFACT_TARGETS.length);
    });

    it('falls back safely for a target this build does not recognize', () => {
        const unknown = describeRunnerArtifactTarget('plan9-riscv64');
        expect(unknown).toBe(en.newSession.temporaryComputer.platform.unknown);
        expect(describeRunnerArtifactTarget(null)).toBe(unknown);
        expect(describeRunnerArtifactTarget(undefined)).toBe(unknown);
    });

    it('names the destination for every published target without echoing the identifier', () => {
        for (const target of RUNNER_ARTIFACT_TARGETS) {
            const label = describeTemporaryComputerDestination({
                kind: 'temporary_computer',
                serverId: 'home-a',
                artifactTarget: target,
                workspace: { kind: 'choose_on_endpoint' },
            });
            expect(typeof label).toBe('string');
            expect(label.length).toBeGreaterThan(0);
            expect(label).not.toContain(target);
        }
    });

    it('keeps the plain product name when the committed target is unrecognizable', () => {
        expect(describeTemporaryComputerDestination({
            kind: 'temporary_computer',
            serverId: 'home-a',
            artifactTarget: 'plan9-riscv64' as never,
            workspace: { kind: 'endpoint_home' },
        })).toBe(en.newSession.temporaryComputer.title);
    });

    it('leaves an exact-Machine target to its own owner', () => {
        expect(describeExecutionTargetDestination(null)).toBeNull();
        expect(describeExecutionTargetDestination(undefined)).toBeNull();
        expect(describeExecutionTargetDestination({
            kind: 'machine',
            target: { serverId: 'home-a', machineId: 'machine-a' },
        })).toBeNull();
    });
});
