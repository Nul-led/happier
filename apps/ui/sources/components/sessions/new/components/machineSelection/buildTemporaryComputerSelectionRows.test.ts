import { describe, expect, it, vi } from 'vitest';
import type { VerifiedRunnerArtifactV1 } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';

import type { TemporaryComputerAvailability } from '@/components/sessions/new/hooks/useTemporaryComputerAvailability';
import { buildTemporaryComputerSelectionRows } from './buildTemporaryComputerSelectionRows';

const artifact = (target: string) => ({ identity: { target } } as unknown as VerifiedRunnerArtifactV1);

const available = (...targets: readonly string[]): TemporaryComputerAvailability => ({
    status: 'available',
    artifacts: targets.map(artifact),
    client: { listArtifacts: vi.fn() } as never,
    retry: vi.fn(),
});

const unavailable = (
    reason: 'feature_disabled' | 'automation_unsupported' | 'artifact_unavailable' | 'request_failed',
    retry = vi.fn(),
): TemporaryComputerAvailability => ({
    status: 'unavailable',
    reason,
    retry,
});

describe('Temporary computer destination rows', () => {
    it('keeps a transient Home availability failure visible and routes retry to its projection owner', () => {
        const retry = vi.fn();
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: unavailable('request_failed', retry),
            selectedTarget: null,
            launchBlockText: null,
            unavailableText: 'Could not reach this Home.',
            onSelect: vi.fn(),
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            serverId: 'server-a',
            artifactTarget: null,
            selected: false,
            workspace: null,
            disabled: true,
            unavailableText: 'Could not reach this Home.',
            onRetry: retry,
        });
    });

    it('keeps the pending artifact check visible without offering a redundant retry', () => {
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: { status: 'loading', retry: vi.fn() },
            selectedTarget: null,
            launchBlockText: null,
            unavailableText: 'Checking available packages…',
            onSelect: vi.fn(),
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            serverId: 'server-a',
            artifactTarget: null,
            selected: false,
            workspace: null,
            disabled: true,
            unavailableText: 'Checking available packages…',
        });
        expect(rows[0]?.onRetry).toBeUndefined();
    });

    it.each(['feature_disabled', 'automation_unsupported'] as const)(
        'renders nothing when the capability does not exist here (%s)',
        (reason) => {
            // Not a recoverable condition: a permanently dead row on every Home
            // with the feature off is noise, not discoverability.
            expect(buildTemporaryComputerSelectionRows({
                serverId: 'server-a',
                availability: unavailable(reason),
                selectedTarget: null,
                launchBlockText: null,
                unavailableText: 'ignored',
                onSelect: vi.fn(),
            })).toEqual([]);
        },
    );

    it('does not expose the destination when no exact platform artifact is published', () => {
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: unavailable('artifact_unavailable'),
            selectedTarget: null,
            launchBlockText: null,
            unavailableText: 'No package is published for this home yet.',
            onSelect: vi.fn(),
        });

        expect(rows).toEqual([]);
    });

    it('offers every published platform as a selectable destination', () => {
        const onSelect = vi.fn();
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: available('linux-x64', 'darwin-arm64'),
            selectedTarget: null,
            launchBlockText: null,
            unavailableText: null,
            onSelect,
        });

        expect(rows.map((row) => row.artifactTarget)).toEqual(['linux-x64', 'darwin-arm64']);
        expect(rows.every((row) => row.disabled !== true)).toBe(true);
        rows[1]?.onSelect({ kind: 'endpoint_home' }, undefined);
        expect(onSelect).toHaveBeenCalledWith('darwin-arm64', { kind: 'endpoint_home' }, undefined);
    });

    it('keeps an eligible destination selectable while launch readiness is blocked, and explains why', () => {
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: available('linux-x64'),
            selectedTarget: null,
            launchBlockText: 'Choose a Team model for this Agent.',
            unavailableText: null,
            onSelect: vi.fn(),
        });

        // Destination eligibility and launch readiness are separate contracts:
        // an unready launch explains itself without removing the destination.
        expect(rows).toHaveLength(1);
        expect(rows[0]?.disabled).not.toBe(true);
        expect(rows[0]?.unavailableText).toBe('Choose a Team model for this Agent.');
    });

    it('does not retain a restored platform after its exact artifact disappeared', () => {
        const retry = vi.fn();
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: available('linux-x64'),
            selectedTarget: {
                kind: 'temporary_computer',
                serverId: 'server-a',
                artifactTarget: 'windows-x64',
                workspace: { kind: 'endpoint_home' },
            },
            launchBlockText: null,
            unavailableText: 'This platform is no longer published.',
            onSelect: vi.fn(),
            retry,
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ artifactTarget: 'linux-x64', selected: false });
        expect(rows[0]?.selected).toBe(false);
    });

    it('carries a committed absolute package expiry back into the row it belongs to', () => {
        const expiresAt = 1_800_000_000_000;
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: available('linux-x64', 'darwin-arm64'),
            selectedTarget: {
                kind: 'temporary_computer',
                serverId: 'server-a',
                artifactTarget: 'darwin-arm64',
                workspace: { kind: 'endpoint_home' },
                packageExpiresAt: expiresAt,
            },
            launchBlockText: null,
            unavailableText: null,
            onSelect: vi.fn(),
        });

        expect(rows[0]?.packageExpiresAt).toBeUndefined();
        expect(rows[1]?.packageExpiresAt).toBe(expiresAt);
    });

    it('marks the restored selection when its platform is still published', () => {
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: available('linux-x64'),
            selectedTarget: {
                kind: 'temporary_computer',
                serverId: 'server-a',
                artifactTarget: 'linux-x64',
                workspace: { kind: 'choose_on_endpoint' },
            },
            launchBlockText: null,
            unavailableText: null,
            onSelect: vi.fn(),
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            artifactTarget: 'linux-x64',
            selected: true,
            workspace: { kind: 'choose_on_endpoint' },
        });
    });

    it('renders nothing without a qualified Home, because an unqualified row cannot be launched', () => {
        expect(buildTemporaryComputerSelectionRows({
            serverId: null,
            availability: available('linux-x64'),
            selectedTarget: null,
            launchBlockText: null,
            unavailableText: null,
            onSelect: vi.fn(),
        })).toEqual([]);
    });

    it('ignores a restored selection that belongs to another Home', () => {
        const rows = buildTemporaryComputerSelectionRows({
            serverId: 'server-a',
            availability: available('linux-x64'),
            selectedTarget: {
                kind: 'temporary_computer',
                serverId: 'server-b',
                artifactTarget: 'windows-x64',
                workspace: { kind: 'endpoint_home' },
            },
            launchBlockText: null,
            unavailableText: null,
            onSelect: vi.fn(),
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ artifactTarget: 'linux-x64', selected: false });
    });
});
