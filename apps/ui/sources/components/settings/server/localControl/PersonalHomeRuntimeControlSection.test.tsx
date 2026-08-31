import * as React from 'react';
import renderer from 'react-test-renderer';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installMachinesSettingsCommonModuleMocks } from '@/components/settings/machines/machinesSettingsTestHelpers';
import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import type { HomeMemorySearchReadiness } from '@/sync/domains/memory/useMemorySearchProvider';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modalMockRef = vi.hoisted(() => ({
    current: null as ReturnType<
        typeof import('@/dev/testkit/mocks/modal')['createModalModuleMock']
    > | null,
}));

installMachinesSettingsCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Platform: {
                OS: 'web',
                select: (options: Record<string, unknown>) => options?.web ?? options?.default,
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        const modalMock = createModalModuleMock();
        modalMockRef.current = modalMock;
        return modalMock.module;
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({ theme: { colors: { accent: { blue: 'blue', orange: 'orange', indigo: 'indigo' } } } });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title, footer }: { children?: React.ReactNode; title?: React.ReactNode; footer?: React.ReactNode }) =>
        React.createElement(
            'Group',
            { title, footer },
            typeof title === 'string' || typeof title === 'number'
                ? React.createElement('Text', null, String(title))
                : title ?? null,
            children,
        ),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => {
        const title = (props as { title?: unknown }).title;
        const subtitle = (props as { subtitle?: unknown }).subtitle;
        const subtitleTestID = (props as { subtitleTestID?: string }).subtitleTestID;
        const subtitleNode: React.ReactNode = typeof subtitle === 'string' || typeof subtitle === 'number'
            ? React.createElement('Text', { testID: subtitleTestID }, String(subtitle))
            : React.isValidElement(subtitle) ? subtitle : null;
        return React.createElement(
            'Item',
            props,
            title != null ? React.createElement('Text', null, String(title)) : null,
            subtitleNode,
        );
    },
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('Text', props, props.children),
    TextInput: (props: Record<string, unknown>) => React.createElement('TextInput', props),
}));

type ScriptedSpec = { kind: string; params: Record<string, unknown> };

function createScriptedRunnerHarness() {
    const listeners = new Map<string, { onEvent: (payload: unknown) => void; onResult: (payload: unknown) => void }>();
    const startedSpecs: ScriptedSpec[] = [];
    const startedTaskIds: string[] = [];
    let nextTaskNumber = 1;
    const startMock = vi.fn(async (spec: unknown) => {
        const parsed = spec as ScriptedSpec;
        startedSpecs.push(parsed);
        const taskId = `task_${nextTaskNumber++}:${parsed.kind}`;
        startedTaskIds.push(taskId);
        return taskId;
    });
    const respondMock = vi.fn(async (_taskId: string, _answer: unknown) => {});
    const runner: SystemTaskRunner = createSystemTaskRunner({
        bridge: {
            start: startMock,
            async subscribe(taskId, listenerSet) {
                listeners.set(taskId, listenerSet);
                if (taskId.endsWith('relay.runtime.status.v1')) {
                    listenerSet.onResult({ protocolVersion: 1, taskId, ok: true, data: { installed: true, version: '1', relayUrl: 'http://127.0.0.1:43123', healthy: true, purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }, anonymousSignupEnabled: false, service: { active: true, enabled: true } } });
                }
                return () => {
                    listeners.delete(taskId);
                };
            },
            async cancel() {},
            respond: respondMock,
        },
    });
    function resolveResult(taskId: string, ok: boolean, data?: unknown, message?: string): void {
        listeners.get(taskId)?.onResult(ok
            ? { protocolVersion: 1, taskId, ok: true, ...(data !== undefined ? { data } : {}) }
            : { protocolVersion: 1, taskId, ok: false, error: { code: 'operation_failed', ...(message ? { message } : {}) } });
    }
    function emitProgress(taskId: string, stepId: string, message?: string): void {
        listeners.get(taskId)?.onEvent({
            protocolVersion: 1,
            taskId,
            tsMs: startedTaskIds.length * 10,
            type: 'progress',
            stepId,
            ...(message ? { message } : {}),
        });
    }
    function emitErasePrompt(taskId: string, paths: readonly string[], estimatedBytes: number | null): void {
        listeners.get(taskId)?.onEvent({
            protocolVersion: 1,
            taskId,
            tsMs: startedTaskIds.length * 10,
            type: 'prompt',
            stepId: 'personal_home.confirm_erase',
            message: 'Confirm permanent deletion of these Personal Home paths.',
            data: { kind: 'personal_home.confirm_erase.v1', paths, estimatedBytes },
        });
    }
    function specByKind(kind: string): ScriptedSpec | undefined {
        return startedSpecs.find((spec) => spec.kind === kind);
    }
    function taskIdByKind(kind: string): string | undefined {
        return startedTaskIds.find((taskId) => taskId.endsWith(kind));
    }
    return { runner, startedSpecs, startedTaskIds, startMock, respondMock, resolveResult, emitProgress, emitErasePrompt, specByKind, taskIdByKind };
}

const INSPECT_RESULT_DATA = {
    purpose: 'personal-home',
    running: true,
    identity: { homeServerIdentityId: 'home-identity-1', schemaVersion: '7' },
    masterSecret: { present: true, fingerprint: 'fp' },
    layout: {
        dataDir: '/home/.happier/self-host/data',
        configDir: '/home/.happier/self-host/config',
        logsDir: '/home/.happier/self-host/logs',
        backupsDir: '/home/.happier/self-host/data/backups',
    },
    storage: {
        databasePresent: true,
        databaseBytes: 5033164,
        publicFilesPresent: true,
        privateFilesPresent: true,
        backupsCount: 2,
        ownedErasePaths: ['/data/home.sqlite', '/data/files'],
        estimatedOwnedBytes: 5033164,
        destinationEmpty: false,
        latestBackup: {
            path: '/home/.happier/self-host/data/backups/personal-home-2026-02-02T03-04-05-006Z.tar',
            createdAt: '2026-02-02T03:04:05.006Z',
            archiveBytes: 4096,
        },
    },
    restoreRecovery: { status: 'none', affectedTargets: [] },
};

const BACKUP_RESULT_DATA = {
    path: '/tmp/home-backup.tar',
    sha256: 'abc123',
    archiveBytes: 8192,
    manifest: {
        format: 'happier-personal-home-backup',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        homeServerIdentityId: 'home-identity-1',
        entries: [{ path: 'database/home.sqlite', size: 15, sha256: 'h1' }],
    },
};

async function resolveInitialInspectionWith(harness: ReturnType<typeof createScriptedRunnerHarness>, inspection: typeof INSPECT_RESULT_DATA): Promise<void> {
    const taskId = harness.taskIdByKind('relay.runtime.personal_home.inspect.v1');
    if (!taskId) throw new Error('inspect task was not started');
    await renderer.act(async () => {
        harness.resolveResult(taskId, true, inspection);
    });
}

const VERIFY_RESULT_DATA = {
    manifest: {
        format: 'happier-personal-home-backup',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        homeServerIdentityId: 'home-identity-1',
        entries: [],
    },
    identityMatchesCurrentHome: 'match',
};

function confirmRef() {
    const confirm = modalMockRef.current?.spies.confirm;
    if (!confirm) throw new Error('modal mock was not installed');
    return confirm;
}

function promptRef() {
    const prompt = modalMockRef.current?.spies.prompt;
    if (!prompt) throw new Error('modal mock was not installed');
    return prompt;
}

async function resolveInitialInspection(harness: ReturnType<typeof createScriptedRunnerHarness>): Promise<void> {
    const taskId = harness.taskIdByKind('relay.runtime.personal_home.inspect.v1');
    if (!taskId) throw new Error('inspect task was not started');
    await renderer.act(async () => {
        harness.resolveResult(taskId, true, INSPECT_RESULT_DATA);
    });
}

describe('PersonalHomeRuntimeControlSection Personal Home operations', () => {
    beforeAll(async () => {
        await import('./PersonalHomeRuntimeControlSection');
    });
    beforeEach(() => {
        standardCleanup();
        confirmRef().mockReset();
        confirmRef().mockResolvedValue(false);
        promptRef().mockReset();
        promptRef().mockResolvedValue(null);
    });

    it('composes the canonical runtime owner once and presents inspect facts from the inspect task', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        // Exactly one status task for the composed runtime owner (not one per section).
        expect(harness.startedSpecs.filter((spec) => spec.kind === 'relay.runtime.status.v1')).toHaveLength(1);
        expect(screen.findByTestId('settings.localRelayRuntime.status')).toBeTruthy();

        // The section refreshes Home facts through the inspect task.
        const inspectTaskId = harness.taskIdByKind('relay.runtime.personal_home.inspect.v1');
        expect(inspectTaskId).toBeTruthy();
        await renderer.act(async () => {
            harness.resolveResult(inspectTaskId!, true, INSPECT_RESULT_DATA);
        });

        expect(screen.findByTestId('settings.personalHomeRuntime.identity')?.props.subtitle).toBe('home-identity-1');
        expect(screen.findByTestId('settings.personalHomeRuntime.storage')?.props.subtitle).toBe('4.8 MB');
        expect(screen.findByTestId('settings.personalHomeRuntime.backupsCount')?.props.title).toBe('Backup archives');
        expect(screen.findByTestId('settings.personalHomeRuntime.backupsCount')?.props.subtitle).toBe('2');
        expect(screen.findByTestId('settings.personalHomeRuntime.masterSecret')?.props.subtitle).toBe('Present');
    });

    it('groups overview, backup, storage, and destructive actions by intent', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: {
                uninstallRuntime: async () => {},
            },
        }));

        const groups = screen.findAllByType('Group' as any);
        expect(groups.map((group) => group.props.title)).toEqual([
            'settings.localRelayRuntime.title',
            'Overview',
            'Backups',
            'Storage & Relocation',
            'Remove Personal Home',
        ]);
    });

    it('declining the plaintext backup disclosure starts no task', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');

        expect(confirmRef().mock.calls.length).toBeGreaterThan(0);
        expect(promptRef()).not.toHaveBeenCalled();
        expect(harness.startedSpecs.every((spec) => spec.kind !== 'relay.runtime.personal_home.backup.v1')).toBe(true);
    });

    it('accepting the disclosure starts the exact backup kind through the shared runner and consumes the verified result', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        confirmRef().mockResolvedValue(true);
        promptRef().mockResolvedValue('');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');

        const backupSpec = harness.specByKind('relay.runtime.personal_home.backup.v1');
        expect(backupSpec?.params).toEqual({
            target: { kind: 'local' },
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        });

        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!, true, BACKUP_RESULT_DATA);
        });

        const backupResult = screen.findByTestId('settings.personalHomeRuntime.backupResult');
        if (!backupResult) throw new Error('backup result was not rendered');
        expect(String(backupResult.props.subtitle)).toContain('/tmp/home-backup.tar');
        expect(String(backupResult.props.subtitle)).toContain('8.0 KB');
    });

    it('cancelling the backup destination prompt starts no backup task', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        confirmRef().mockResolvedValue(true);
        promptRef().mockResolvedValue(null);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');

        expect(harness.startedSpecs.every((spec) => spec.kind !== 'relay.runtime.personal_home.backup.v1')).toBe(true);
    });

    it('passes an optional chosen output path as the only caller-owned backup fact', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        confirmRef().mockResolvedValue(true);
        promptRef().mockResolvedValue(' /tmp/chosen.tar ');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');

        const backupSpec = harness.specByKind('relay.runtime.personal_home.backup.v1');
        expect(backupSpec?.params.purpose).toEqual({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' });
        expect(backupSpec?.params.outputPath).toBe('/tmp/chosen.tar');
        // No transfer/publication callbacks, purpose, or env ride along with the operation spec.
        expect(Object.keys(backupSpec?.params ?? {}).sort()).toEqual([
            'outputPath',
            'purpose',
            'target',
        ]);
    });

    it('verifies and starts restore on the first explicitly confirmed attempt', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        promptRef().mockResolvedValue('/a.tar');
        confirmRef().mockResolvedValue(true);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.restore');

        await renderer.act(async () => {
            harness.resolveResult(harness.startedTaskIds.at(-1)!, true, VERIFY_RESULT_DATA);
        });

        const verifySpec = harness.specByKind('relay.runtime.personal_home.verify_backup.v1');
        expect(verifySpec?.params).toEqual({
            target: { kind: 'local' },
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
            archivePath: '/a.tar',
        });

        const restoreSpec = harness.specByKind('relay.runtime.personal_home.restore.v1');
        expect(restoreSpec?.params).toEqual({
            target: { kind: 'local' },
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
            archivePath: '/a.tar',
            confirmOverwrite: true,
        });
        const kinds = harness.startedSpecs.map((spec) => spec.kind);
        expect(kinds.indexOf('relay.runtime.personal_home.verify_backup.v1')).toBeLessThan(kinds.indexOf('relay.runtime.personal_home.restore.v1'));

        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.restore.v1')!, true, { outcome: 'restored' });
        });
        expect(screen.findByTestId('settings.personalHomeRuntime.restoreResult')?.props.subtitle).toBe('Home restored');
    });

    it('shows completed restore rollback and finalization as distinct confirmed actions', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        await resolveInitialInspectionWith(harness, {
            ...INSPECT_RESULT_DATA,
            restoreRecovery: { status: 'finalization_available', affectedTargets: ['/data/home', '/data/home.rollback'] },
        } as typeof INSPECT_RESULT_DATA);

        expect(screen.findByTestId('settings.personalHomeRuntime.recoverRestore')).toBeTruthy();
        expect(screen.findByTestId('settings.personalHomeRuntime.finalizeRestore')).toBeTruthy();

        confirmRef().mockResolvedValueOnce(true);
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.finalizeRestore');
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('/data/home.rollback');
        expect(harness.specByKind('relay.runtime.personal_home.restore.v1')?.params).toEqual({
            target: { kind: 'local' },
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
            action: 'finalize',
        });
    });

    it('starts erase first, confirms its exact owner-held paths through Modal, and responds through the shared runner', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
        expect(confirmRef().mock.calls[0]?.[0]).toContain('Back up');
        const declinedTaskId = harness.taskIdByKind('relay.runtime.personal_home.erase.v1')!;
        await renderer.act(async () => {
            harness.emitErasePrompt(declinedTaskId, ['/locked/current.sqlite'], 8192);
        });
        await renderer.act(async () => {});
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('/locked/current.sqlite');
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('8.0 KB');
        expect(harness.respondMock).toHaveBeenCalledWith(declinedTaskId, { confirmed: false });
        await renderer.act(async () => {
            harness.resolveResult(declinedTaskId, false, undefined, 'Personal Home data deletion was not explicitly confirmed.');
        });

        confirmRef()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');

        const eraseSpecs = harness.startedSpecs.filter((spec) => spec.kind === 'relay.runtime.personal_home.erase.v1');
        const eraseSpec = eraseSpecs.at(-1);
        expect(eraseSpec?.params).toEqual({
            target: { kind: 'local' },
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        });
        const confirmedTaskId = harness.startedTaskIds.filter((taskId) => taskId.endsWith('relay.runtime.personal_home.erase.v1')).at(-1)!;
        await renderer.act(async () => {
            harness.emitErasePrompt(confirmedTaskId, ['/locked/new.sqlite', '/locked/files'], 4096);
        });
        await renderer.act(async () => {});
        expect(harness.respondMock).toHaveBeenCalledWith(confirmedTaskId, { confirmed: true });

        await renderer.act(async () => {
            harness.resolveResult(confirmedTaskId, true, {
                removedPaths: ['/data/a', '/data/b'],
                stoppedRunningHome: true,
            });
        });
        expect(screen.findByTestId('settings.personalHomeRuntime.eraseResult')?.props.subtitle).toContain('2');
    });

    it('waits for a chosen verified backup before starting erase', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        confirmRef()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);
        promptRef().mockResolvedValue('/safe/home-before-erase.tar');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
        expect(harness.specByKind('relay.runtime.personal_home.backup.v1')?.params.outputPath).toBe('/safe/home-before-erase.tar');
        expect(harness.specByKind('relay.runtime.personal_home.erase.v1')).toBeUndefined();

        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!, true, {
                ...BACKUP_RESULT_DATA,
                path: '/safe/home-before-erase.tar',
            });
        });
        expect(harness.specByKind('relay.runtime.personal_home.erase.v1')).toBeTruthy();
    });

    it('does not erase when the chosen backup lacks verified final facts', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        confirmRef()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);
        promptRef().mockResolvedValue('/safe/home-before-erase.tar');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!, true, {
                path: '',
                manifest: { entries: [] },
            });
        });

        expect(harness.specByKind('relay.runtime.personal_home.erase.v1')).toBeUndefined();
    });

    it('starts neither backup nor erase when the chosen backup destination is cancelled', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        confirmRef()
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true);
        promptRef().mockResolvedValue(null);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');

        expect(harness.specByKind('relay.runtime.personal_home.backup.v1')).toBeUndefined();
        expect(harness.specByKind('relay.runtime.personal_home.erase.v1')).toBeUndefined();
    });

    it('does not erase when the canonical backup owner rejects an unsafe erase-safety destination', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);
        confirmRef().mockResolvedValueOnce(true);
        promptRef().mockResolvedValue('/home/.happier/self-host/data/backups/will-be-erased.tar');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
        const backupTaskId = harness.taskIdByKind('relay.runtime.personal_home.backup.v1');
        expect(backupTaskId).toBeTruthy();
        await renderer.act(async () => {
            harness.resolveResult(backupTaskId!, false, {
                message: 'The pre-erase safety backup must be outside Personal Home data.',
            });
        });

        expect(harness.specByKind('relay.runtime.personal_home.erase.v1')).toBeUndefined();
        expect(modalMockRef.current?.spies.alert).toHaveBeenCalled();
    });

    it('keeps erase, runtime uninstall, and profile removal as distinct controls that cannot call one another', async () => {
        const harness = createScriptedRunnerHarness();
        const removeProfile = vi.fn(async () => {});
        const uninstallRuntime = vi.fn(async () => {});
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { removeProfile, uninstallRuntime },
        }));
        await resolveInitialInspection(harness);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
        expect(harness.startedSpecs.some((spec) => spec.kind === 'relay.runtime.personal_home.erase.v1')).toBe(true);
        expect(removeProfile).not.toHaveBeenCalled();
        expect(uninstallRuntime).not.toHaveBeenCalled();

        confirmRef().mockResolvedValue(true);
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.removeProfile');
        expect(removeProfile).toHaveBeenCalledTimes(1);
        expect(uninstallRuntime).not.toHaveBeenCalled();
        expect(harness.startedSpecs.filter((spec) => spec.kind === 'relay.runtime.personal_home.erase.v1')).toHaveLength(1);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.uninstallRuntime');
        expect(uninstallRuntime).toHaveBeenCalledTimes(1);
        expect(removeProfile).toHaveBeenCalledTimes(1);
        expect(harness.startedSpecs.filter((spec) => spec.kind === 'relay.runtime.personal_home.erase.v1')).toHaveLength(1);
    });

    it('presents relocation as clearly unavailable and gives it no way to start a task', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        const relocate = screen.findByTestId('settings.personalHomeRuntime.relocate');
        if (!relocate) throw new Error('relocation control was not rendered');
        expect(relocate.props.disabled).toBe(true);
        expect(relocate.props.subtitle).toBe('Unavailable until a supported destination can be selected.');
        // No destination grammar and no transfer/publication callbacks exist in the UI.
        expect(relocate.props.onPress).toBeUndefined();
        expect(harness.startedSpecs.every((spec) => spec.kind !== 'relay.runtime.personal_home.relocate.v1')).toBe(true);
    });

    it('keeps the terminal failed snapshot rendered with truthful stages and announces the failure assertively', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        confirmRef().mockResolvedValue(true);
        promptRef().mockResolvedValue('');
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');
        const backupTaskId = harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!;

        await renderer.act(async () => {
            harness.emitProgress(backupTaskId, 'personal_home.backup', 'Creating backup archive');
        });

        // Polite live progress while running.
        const progressAnnouncer = screen.findByTestId('system-task-a11y-progress');
        if (!progressAnnouncer) throw new Error('progress announcer was not rendered');
        expect(progressAnnouncer.props.accessibilityLiveRegion).toBe('polite');

        await renderer.act(async () => {
            harness.resolveResult(backupTaskId, false, undefined, 'sqlite_snapshot_unstable');
        });

        // The terminal snapshot remains rendered, with the completed stage and the failure visible.
        expect(screen.findByTestId('system-task-progress-card')).toBeTruthy();
        expect(screen.findByTestId('system-task-progress-status-failed')).toBeTruthy();
        expect(screen.findByTestId('system-task-progress-checklist-step-failed-personal-home-backup')).toBeTruthy();

        // The failure is announced assertively; the polite progress announcer is gone.
        const failureAnnouncer = screen.findByTestId('system-task-a11y-failure');
        if (!failureAnnouncer) throw new Error('failure announcer was not rendered');
        expect(failureAnnouncer.props.accessibilityLiveRegion).toBe('assertive');
        expect(screen.findByTestId('system-task-a11y-progress')).toBeNull();

        // Dismissal clears the retained result.
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.dismissResult');
        expect(screen.findByTestId('system-task-progress-card')).toBeNull();
        expect(screen.findByTestId('system-task-a11y-failure')).toBeNull();
    });

    it('restarts through the real lifecycle task of the composed runtime owner', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.restart');

        expect(harness.specByKind('relay.runtime.restart.v1')).toBeTruthy();
        expect(harness.startedSpecs.every((spec) => !spec.kind.startsWith('relay.runtime.personal_home.erase'))).toBe(true);
    });

    it('disables the Personal Home operations when the system task bridge is unavailable', async () => {
        const harness = createScriptedRunnerHarness();
        const unavailableRunner = createSystemTaskRunner({
            mode: 'unavailable',
            bridge: {
                start: harness.startMock,
                async subscribe() {
                    return () => {};
                },
                async cancel() {},
                async respond() {},
            },
        });
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: unavailableRunner }));

        expect(harness.startMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings.personalHomeRuntime.backup')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings.personalHomeRuntime.restore')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings.personalHomeRuntime.eraseData')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings.personalHomeRuntime.inspect')?.props.disabled).toBe(true);
    });

    it('presents search readiness from the existing production capability source without a second polling owner', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const cases: ReadonlyArray<Readonly<{ readiness: HomeMemorySearchReadiness; expected: string }>> = [
            { readiness: 'ready', expected: 'Search ready' },
            { readiness: 'indexing', expected: 'Search indexing' },
            { readiness: 'unavailable', expected: 'Search unavailable' },
            { readiness: 'unknown', expected: 'Search unknown' },
        ];
        for (const testCase of cases) {
            const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
                runner: harness.runner,
                searchReadiness: testCase.readiness,
            }));
            const row = screen.findByTestId('settings.personalHomeRuntime.search');
            if (!row) throw new Error(`search readiness row was not rendered for ${testCase.readiness}`);
            expect(row.props.subtitle).toBe(testCase.expected);
        }
    });

    it('shows the canonical Last backup fact from the inspect result and never a second persisted UI cache', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        // Before inspection resolves, the row states the honest unknown instead of guessing.
        expect(screen.findByTestId('settings.personalHomeRuntime.lastBackup')?.props.subtitle).toContain('unknown');

        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);
        const row = screen.findByTestId('settings.personalHomeRuntime.lastBackup');
        expect(String(row?.props.subtitle)).toContain('2026-02-02');
    });

    it('discloses the verified backup result with destination, bytes, identity, timestamp, and a reveal action', async () => {
        const harness = createScriptedRunnerHarness();
        const revealBackupOutput = vi.fn(async (_path: string) => {});
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { revealBackupOutput },
        }));

        confirmRef().mockResolvedValue(true);
        promptRef().mockResolvedValue('');
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');
        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!, true, BACKUP_RESULT_DATA);
        });

        const resultRow = screen.findByTestId('settings.personalHomeRuntime.backupResult');
        expect(String(resultRow?.props.subtitle)).toContain('/tmp/home-backup.tar');
        expect(String(resultRow?.props.subtitle)).toContain('8.0 KB');
        expect(String(resultRow?.props.subtitle)).toContain('home-identity-1');
        expect(String(resultRow?.props.subtitle)).toContain('2026-01-01');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backupReveal');
        expect(revealBackupOutput).toHaveBeenCalledWith('/tmp/home-backup.tar');
    });

    it('exposes the typed restore recovery outcome and retained rollback paths explicitly', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);

        promptRef().mockResolvedValue('/a.tar');
        confirmRef().mockResolvedValue(true);
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.restore');
        await renderer.act(async () => {
            harness.resolveResult(harness.startedTaskIds.at(-1)!, true, VERIFY_RESULT_DATA);
        });
        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.restore.v1')!, true, {
                outcome: 'recovery_required',
                rollbackPaths: ['/home/.happier/self-host/data/.operations/rollback-previous'],
                error: 'health check failed after swap',
            });
        });

        const row = screen.findByTestId('settings.personalHomeRuntime.restoreResult');
        const subtitle = String(row?.props.subtitle ?? '');
        expect(subtitle).toContain('Recovery needed');
        expect(subtitle).toContain('health check failed after swap');
        expect(subtitle).toContain('/home/.happier/self-host/data/.operations/rollback-previous');
    });

    it('opens the canonical Home data and log locations through the injected production path opener', async () => {
        const harness = createScriptedRunnerHarness();
        const openDataLocation = vi.fn(async (_path: string) => {});
        const openLogs = vi.fn(async (_path: string) => {});
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { openDataLocation, openLogs },
        }));

        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.openDataLocation');
        expect(openDataLocation).toHaveBeenCalledWith('/home/.happier/self-host/data');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.openLogs');
        expect(openLogs).toHaveBeenCalledWith('/home/.happier/self-host/logs');
    });

    it('hides Cancel once the running operation passed its irreversible boundary and keeps it before that', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');

        const cases: ReadonlyArray<Readonly<{ stepId: string; cancelVisible: boolean }>> = [
            { stepId: 'personal_home.inspecting', cancelVisible: true },
            { stepId: 'personal_home.stopping_home', cancelVisible: false },
            { stepId: 'personal_home.checkpointing', cancelVisible: false },
        ];

        for (const testCase of cases) {
            const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
            confirmRef().mockResolvedValue(true);
            promptRef().mockResolvedValue('');
            await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');
            const backupTaskId = harness.startedTaskIds.filter((taskId) => taskId.endsWith('relay.runtime.personal_home.backup.v1')).at(-1);
            if (!backupTaskId) throw new Error('backup operation task was not started');
            await renderer.act(async () => {
                harness.emitProgress(backupTaskId, testCase.stepId);
            });
            const cancelButton = screen.findByTestId('system-task-progress-cancel');
            expect(Boolean(cancelButton)).toBe(testCase.cancelVisible);
        }

        // Erase stays cancellable through explicit confirmation and loses Cancel at the erasing boundary.
        const eraseCases: ReadonlyArray<Readonly<{ stepId: string; cancelVisible: boolean }>> = [
            { stepId: 'personal_home.awaiting_confirmation', cancelVisible: true },
            { stepId: 'personal_home.erasing', cancelVisible: false },
        ];
        for (const testCase of eraseCases) {
            const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
            confirmRef().mockResolvedValue(false);
            await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
            const eraseTaskId = harness.startedTaskIds.filter((taskId) => taskId.endsWith('relay.runtime.personal_home.erase.v1')).at(-1);
            if (!eraseTaskId) throw new Error('erase operation task was not started');
            await renderer.act(async () => {
                harness.emitProgress(eraseTaskId, testCase.stepId);
            });
            const cancelButton = screen.findByTestId('system-task-progress-cancel');
            expect(Boolean(cancelButton)).toBe(testCase.cancelVisible);
        }
    });
});
