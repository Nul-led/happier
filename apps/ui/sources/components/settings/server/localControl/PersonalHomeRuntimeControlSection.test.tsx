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

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props),
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
                    queueMicrotask(() => {
                        listenerSet.onResult({ protocolVersion: 1, taskId, ok: true, data: { installed: true, dataPresent: true, version: '1', relayUrl: 'http://127.0.0.1:43123', healthy: true, purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }, anonymousSignupEnabled: false, service: { active: true, enabled: true } } });
                    });
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
            data: {
                kind: 'personal_home.confirm_erase.v1',
                canonicalServerUrl: 'http://127.0.0.1:43123',
                homeServerIdentityId: 'home-identity-1',
                paths,
                estimatedBytes,
            },
        });
    }
    function emitRelocationPrompt(taskId: string, kind: string, data: Record<string, unknown>): void {
        listeners.get(taskId)?.onEvent({
            protocolVersion: 1,
            taskId,
            tsMs: startedTaskIds.length * 10,
            type: 'prompt',
            stepId: 'personal_home.relocation',
            message: 'Publish relocation destination.',
            data: { kind, ...data },
        });
    }
    function specByKind(kind: string): ScriptedSpec | undefined {
        return startedSpecs.find((spec) => spec.kind === kind);
    }
    function taskIdByKind(kind: string): string | undefined {
        return startedTaskIds.find((taskId) => taskId.endsWith(kind));
    }
    return { runner, startedSpecs, startedTaskIds, startMock, respondMock, resolveResult, emitProgress, emitErasePrompt, emitRelocationPrompt, specByKind, taskIdByKind };
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

async function resolveInitialInspectionWith(
    harness: ReturnType<typeof createScriptedRunnerHarness>,
    inspection: typeof INSPECT_RESULT_DATA & Record<string, unknown>,
): Promise<void> {
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

function alertRef() {
    const alert = modalMockRef.current?.spies.alert;
    if (!alert) throw new Error('modal mock was not installed');
    return alert;
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
        alertRef().mockReset();
    });

    it('composes the canonical runtime owner once and presents inspect facts from the inspect task', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            homeLabel: 'My Personal Home',
        }));

        // Exactly one status task for the composed runtime owner (not one per section).
        expect(harness.startedSpecs.filter((spec) => spec.kind === 'relay.runtime.status.v1')).toHaveLength(1);
        expect(screen.findByTestId('settings.localRelayRuntime.status')).toBeTruthy();

        // The section refreshes Home facts through the inspect task.
        const inspectTaskId = harness.taskIdByKind('relay.runtime.personal_home.inspect.v1');
        expect(inspectTaskId).toBeTruthy();
        await renderer.act(async () => {
            harness.resolveResult(inspectTaskId!, true, INSPECT_RESULT_DATA);
        });

        expect(screen.findByTestId('settings.personalHomeRuntime.home')?.props.subtitle).toBe('My Personal Home');
        expect(screen.findByTestId('settings.personalHomeRuntime.home')?.props.subtitle).not.toContain('home-identity-1');
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.homeDetails');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('home-identity-1');
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
            'Personal Home',
            'Protection',
            'Advanced',
            'Delete Home Data',
        ]);
    });

    it('starts Back Up Now immediately in the canonical directory without a modal or path prompt', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');

        expect(confirmRef()).not.toHaveBeenCalled();
        expect(promptRef()).not.toHaveBeenCalled();
        const backupSpec = harness.specByKind('relay.runtime.personal_home.backup.v1');
        expect(backupSpec?.params).toEqual({
            target: { kind: 'local' },
            channel: 'stable',
            mode: 'user',
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        });

        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!, true, BACKUP_RESULT_DATA);
        });

        const backupResult = screen.findByTestId('settings.personalHomeRuntime.backupResult');
        if (!backupResult) throw new Error('backup result was not rendered');
        expect(String(backupResult.props.subtitle)).not.toContain('/tmp/home-backup.tar');
        expect(String(backupResult.props.subtitle)).not.toContain('home-identity-1');
        expect(String(backupResult.props.subtitle)).toContain('8.0 KB');
        expect(String(backupResult.props.subtitle)).not.toContain('T00:00:00.000Z');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backupResultDetails');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('/tmp/home-backup.tar');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('home-identity-1');
    });

    it('keeps Export Backup separate and passes only the native picker destination to the same owner', async () => {
        const harness = createScriptedRunnerHarness();
        const selectBackupExportDestination = vi.fn(async () => ' /tmp/chosen.tar ');
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { selectBackupExportDestination },
        }));

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.exportBackup');

        expect(selectBackupExportDestination).toHaveBeenCalledTimes(1);
        expect(confirmRef()).not.toHaveBeenCalled();
        expect(promptRef()).not.toHaveBeenCalled();
        const backupSpec = harness.specByKind('relay.runtime.personal_home.backup.v1');
        expect(backupSpec?.params.purpose).toEqual({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' });
        expect(backupSpec?.params.outputPath).toBe('/tmp/chosen.tar');
        // No transfer/publication callbacks, purpose, or env ride along with the operation spec.
        expect(Object.keys(backupSpec?.params ?? {}).sort()).toEqual([
            'channel',
            'mode',
            'outputPath',
            'purpose',
            'target',
        ]);
    });

    it('verifies and starts restore on the first explicitly confirmed attempt', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const selectBackupArchive = vi.fn(async () => '/a.tar');
        const revealBackupOutput = vi.fn(async () => {});
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { selectBackupArchive, revealBackupOutput },
        }));
        confirmRef().mockResolvedValue(true);

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.restore');

        await renderer.act(async () => {
            harness.resolveResult(harness.startedTaskIds.at(-1)!, true, VERIFY_RESULT_DATA);
        });

        const verificationRow = screen.findByTestId('settings.personalHomeRuntime.verifyResult');
        expect(String(verificationRow?.props.subtitle)).not.toContain('/a.tar');
        expect(String(verificationRow?.props.subtitle)).not.toContain('home-identity-1');
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.verifyResultDetails');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('/a.tar');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('home-identity-1');

        const verifySpec = harness.specByKind('relay.runtime.personal_home.verify_backup.v1');
        expect(selectBackupArchive).toHaveBeenCalledTimes(1);
        expect(promptRef()).not.toHaveBeenCalled();
        expect(verifySpec?.params).toEqual({
            target: { kind: 'local' },
            channel: 'stable',
            mode: 'user',
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
            archivePath: '/a.tar',
        });

        const restoreSpec = harness.specByKind('relay.runtime.personal_home.restore.v1');
        expect(restoreSpec?.params).toEqual({
            target: { kind: 'local' },
            channel: 'stable',
            mode: 'user',
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
            archivePath: '/a.tar',
            confirmOverwrite: true,
        });
        const kinds = harness.startedSpecs.map((spec) => spec.kind);
        expect(kinds.indexOf('relay.runtime.personal_home.verify_backup.v1')).toBeLessThan(kinds.indexOf('relay.runtime.personal_home.restore.v1'));

        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.restore.v1')!, true, {
                outcome: 'restored',
                rollbackPaths: ['/private/restore/rollback-home'],
                recoveryArchive: {
                    path: '/backups/personal-home-pre-restore.tar',
                    sha256: 'recovery-sha256',
                    archiveBytes: 16384,
                    manifest: {
                        format: 'happier-personal-home-backup',
                        version: 1,
                        createdAt: '2026-01-02T00:00:00.000Z',
                        homeServerIdentityId: 'home-identity-1',
                        entries: [],
                    },
                },
            });
        });
        expect(screen.findByTestId('settings.personalHomeRuntime.restoreResult')?.props.subtitle).toBe('Home restored');
        const recoveryBackup = screen.findByTestId('settings.personalHomeRuntime.restoreRecoveryBackup');
        expect(recoveryBackup?.props.subtitle).toContain('16.0 KB');
        expect(recoveryBackup?.props.subtitle).not.toContain('home-identity-1');
        expect(recoveryBackup?.props.subtitle).not.toContain('/backups/personal-home-pre-restore.tar');
        expect(recoveryBackup?.props.subtitle).not.toContain('recovery-sha256');
        expect(screen.findByTestId('settings.personalHomeRuntime.restoreResult')?.props.subtitle).not.toContain('/private/restore/rollback-home');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.restoreRecoveryBackupDetails');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('/backups/personal-home-pre-restore.tar');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('recovery-sha256');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.restoreRecoveryBackupReveal');
        expect(revealBackupOutput).toHaveBeenCalledWith('/backups/personal-home-pre-restore.tar');
    });

    it('keeps completed-restore recovery controls until automatic post-auth finalization is proven', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        await resolveInitialInspectionWith(harness, {
            ...INSPECT_RESULT_DATA,
            restoreRecovery: { status: 'finalization_available', affectedTargets: ['/data/home', '/data/home.rollback'] },
        } as typeof INSPECT_RESULT_DATA);

        expect(screen.findByTestId('settings.personalHomeRuntime.recoverRestore')).toBeTruthy();
        expect(screen.findByTestId('settings.personalHomeRuntime.finalizeRestore')).toBeTruthy();

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.recoverRestore');
        expect(confirmRef().mock.calls.at(-1)?.[1]).not.toContain('/data/home');
        expect(confirmRef().mock.calls.at(-1)?.[1]).not.toContain('/data/home.rollback');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.finalizeRestore');
        expect(confirmRef().mock.calls.at(-1)?.[1]).not.toContain('/data/home');
        expect(confirmRef().mock.calls.at(-1)?.[1]).not.toContain('/data/home.rollback');
    });

    it('starts erase first, confirms its exact owner-held paths through Modal, and responds through the shared runner', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');
        const declinedTaskId = harness.taskIdByKind('relay.runtime.personal_home.erase.v1')!;
        await renderer.act(async () => {
            harness.emitErasePrompt(declinedTaskId, ['/locked/current.sqlite'], 8192);
        });
        await renderer.act(async () => {});
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('http://127.0.0.1:43123');
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('home-identity-1');
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('/locked/current.sqlite');
        expect(confirmRef().mock.calls.at(-1)?.[1]).toContain('8.0 KB');
        expect(confirmRef()).toHaveBeenCalledTimes(1);
        expect(harness.respondMock).toHaveBeenCalledWith(declinedTaskId, { confirmed: false });
        await renderer.act(async () => {
            harness.resolveResult(declinedTaskId, false, undefined, 'Personal Home data deletion was not explicitly confirmed.');
        });

        confirmRef().mockResolvedValueOnce(true);
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.eraseData');

        const eraseSpecs = harness.startedSpecs.filter((spec) => spec.kind === 'relay.runtime.personal_home.erase.v1');
        const eraseSpec = eraseSpecs.at(-1);
        expect(eraseSpec?.params).toEqual({
            target: { kind: 'local' },
            channel: 'stable',
            mode: 'user',
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

    it('hides Move Home until a real resolver-backed action exists', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

        expect(screen.findByTestId('settings.personalHomeRuntime.relocate')).toBeNull();
        expect(harness.startedSpecs.every((spec) => spec.kind !== 'relay.runtime.personal_home.relocate.v1')).toBe(true);
    });

    it('starts the resolver-backed SSH relocation task after one source-deactivation confirmation and answers only its bound publication prompt', async () => {
        const harness = createScriptedRunnerHarness();
        const respondToPrompt = vi.fn(async () => ({ descriptor: {
            v: 1,
            homeServerIdentityId: 'home-identity-1',
            canonicalServerUrl: 'https://destination.example.test',
            revision: 2,
            endpoints: [{ kind: 'https', url: 'https://destination.example.test' }],
        } }));
        const prepare = vi.fn(async () => ({
            spec: {
                protocolVersion: 1,
                kind: 'remote.ssh.manageHost.v1',
                params: {
                    action: 'personalHome.relocate',
                    personalHomeRelocation: {
                        operationId: 'relocation-1',
                        destinationMachineId: 'managed-host-1',
                        sourceDescriptorRevision: 1,
                    },
                },
            },
            respondToPrompt,
        }));
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: {
                relocation: {
                    destinations: [{ id: 'managed-host-1', title: 'Home server', subtitle: 'ops@destination.example.test' }],
                    prepare,
                },
            },
        }));
        await resolveInitialInspection(harness);
        await renderer.act(async () => {});

        confirmRef().mockResolvedValueOnce(true);
        const relocationMenu = screen.findByType('DropdownMenu');
        await renderer.act(async () => {
            relocationMenu.props.onSelect('managed-host-1');
        });
        await renderer.act(async () => {});

        expect(prepare).toHaveBeenCalledWith('managed-host-1');
        expect(confirmRef()).toHaveBeenCalledTimes(1);
        expect(harness.specByKind('remote.ssh.manageHost.v1')?.params).toMatchObject({
            action: 'personalHome.relocate',
            personalHomeRelocation: { operationId: 'relocation-1', destinationMachineId: 'managed-host-1' },
        });
        expect(harness.startedSpecs.some((spec) => spec.kind === 'relay.runtime.personal_home.relocate.v1')).toBe(false);

        const taskId = harness.taskIdByKind('remote.ssh.manageHost.v1')!;
        await renderer.act(async () => {
            harness.emitRelocationPrompt(taskId, 'personal_home.publish_relocation_descriptor.v1', {
                operationId: 'relocation-1',
                homeServerIdentityId: 'home-identity-1',
            });
        });
        await renderer.act(async () => {});
        expect(respondToPrompt).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'personal_home.publish_relocation_descriptor.v1',
        }));
        expect(harness.respondMock).toHaveBeenCalledWith(taskId, expect.objectContaining({ descriptor: expect.any(Object) }));
    });

    it('surfaces only the coordinator-selected relocation recovery and resumes it through the same remote task owner', async () => {
        const harness = createScriptedRunnerHarness();
        const respondToPrompt = vi.fn(async () => ({ descriptor: null }));
        const prepare = vi.fn(async () => ({
            spec: {
                protocolVersion: 1,
                kind: 'remote.ssh.manageHost.v1',
                params: { action: 'personalHome.relocate' },
            },
            respondToPrompt,
        }));
        const prepareRecovery = vi.fn(async (recovery: Readonly<{
            operationId: string;
            destinationMachineId: string;
            sourceDescriptorRevision: number;
            recoveryAction: 'finish_move' | 'return_to_source';
        }>) => ({
            spec: {
                protocolVersion: 1,
                kind: 'remote.ssh.manageHost.v1',
                params: {
                    action: 'personalHome.relocate',
                    personalHomeRelocation: recovery,
                },
            },
            respondToPrompt,
        }));
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: {
                relocation: {
                    destinations: [{ id: 'managed-host-1', title: 'Home server' }],
                    prepare,
                    prepareRecovery,
                },
            },
        }));
        await resolveInitialInspection(harness);
        confirmRef().mockResolvedValueOnce(true);
        await renderer.act(async () => {
            screen.findByType('DropdownMenu').props.onSelect('managed-host-1');
        });
        await renderer.act(async () => {});
        const taskId = harness.taskIdByKind('remote.ssh.manageHost.v1')!;
        await renderer.act(async () => {
            harness.resolveResult(taskId, true, {
                action: 'personalHome.relocate',
                personalHome: {
                    operationId: 'relocation-1',
                    destinationMachineId: 'managed-host-1',
                    sourceDescriptorRevision: 1,
                    status: 'pending',
                    recoveryAction: 'finish_move',
                },
            });
        });

        const recovery = screen.findByTestId('settings.personalHomeRuntime.recoverRelocation');
        expect(recovery).toBeTruthy();
        expect(recovery?.props.title).toBe('Finish Moving');
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.recoverRelocation');
        expect(prepareRecovery).toHaveBeenCalledWith({
            operationId: 'relocation-1',
            destinationMachineId: 'managed-host-1',
            sourceDescriptorRevision: 1,
            recoveryAction: 'finish_move',
        });
        expect(harness.startedSpecs.filter((spec) => spec.kind === 'remote.ssh.manageHost.v1')).toHaveLength(2);
        expect(harness.startedSpecs.at(-1)?.params).toMatchObject({
            action: 'personalHome.relocate',
            personalHomeRelocation: {
                operationId: 'relocation-1',
                recoveryAction: 'finish_move',
            },
        });
        expect(confirmRef()).toHaveBeenCalledTimes(1);
    });

    it('derives the two authority-safe recovery actions from durable inspection facts after reopening settings', async () => {
        const harness = createScriptedRunnerHarness();
        const prepareRecovery = vi.fn(async (recovery: Readonly<{
            operationId: string;
            destinationMachineId: string;
            sourceDescriptorRevision: number;
            recoveryAction: 'finish_move' | 'return_to_source';
        }>) => ({
            spec: {
                protocolVersion: 1,
                kind: 'remote.ssh.manageHost.v1',
                params: { action: 'personalHome.relocate', personalHomeRelocation: recovery },
            },
            respondToPrompt: async () => ({ descriptor: null }),
        }));
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: {
                relocation: {
                    destinations: [{ id: 'managed-host-1', title: 'Home server' }],
                    prepare: async () => { throw new Error('not used'); },
                    prepareRecovery,
                },
            },
        }));
        await resolveInitialInspectionWith(harness, {
            ...INSPECT_RESULT_DATA,
            relocationRecovery: {
                status: 'recovery_available',
                operationId: 'relocation-1',
                destinationMachineId: 'managed-host-1',
                sourceDescriptorRevision: 1,
                primaryAction: 'finish_move',
                secondaryAction: 'return_to_source',
            },
        });

        expect(screen.findByTestId('settings.personalHomeRuntime.recoverRelocation')).toBeTruthy();
        expect(screen.findByTestId('settings.personalHomeRuntime.recoverRelocationReturn')).toBeTruthy();
        await screen.pressByTestIdAsync('settings.personalHomeRuntime.recoverRelocationReturn');
        expect(prepareRecovery).toHaveBeenCalledWith({
            operationId: 'relocation-1',
            destinationMachineId: 'managed-host-1',
            sourceDescriptorRevision: 1,
            recoveryAction: 'return_to_source',
        });
        expect(confirmRef()).not.toHaveBeenCalled();
    });

    it('keeps the terminal failed snapshot rendered with truthful stages and announces the failure assertively', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, { runner: harness.runner }));

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
        expect(screen.findByTestId('settings.personalHomeRuntime.restore')).toBeNull();
        expect(screen.findByTestId('settings.personalHomeRuntime.eraseData')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings.personalHomeRuntime.inspect')?.props.disabled).toBe(true);
    });

    it('shows search readiness only while indexing and hides routine or non-actionable states', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const cases: ReadonlyArray<Readonly<{ readiness: HomeMemorySearchReadiness; expected: string | null }>> = [
            { readiness: 'ready', expected: null },
            { readiness: 'indexing', expected: 'Search indexing' },
            { readiness: 'unavailable', expected: null },
            { readiness: 'unknown', expected: null },
        ];
        for (const testCase of cases) {
            const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
                runner: harness.runner,
                searchReadiness: testCase.readiness,
            }));
            const row = screen.findByTestId('settings.personalHomeRuntime.search');
            expect(row?.props.subtitle ?? null).toBe(testCase.expected);
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
        expect(String(row?.props.subtitle)).toContain('2026');
    });

    it('keeps verified backup facts calm in the primary row and exposes technical facts through Details', async () => {
        const harness = createScriptedRunnerHarness();
        const revealBackupOutput = vi.fn(async (_path: string) => {});
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { revealBackupOutput },
        }));

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backup');
        await renderer.act(async () => {
            harness.resolveResult(harness.taskIdByKind('relay.runtime.personal_home.backup.v1')!, true, BACKUP_RESULT_DATA);
        });

        const resultRow = screen.findByTestId('settings.personalHomeRuntime.backupResult');
        expect(String(resultRow?.props.subtitle)).not.toContain('/tmp/home-backup.tar');
        expect(String(resultRow?.props.subtitle)).toContain('8.0 KB');
        expect(String(resultRow?.props.subtitle)).not.toContain('home-identity-1');
        expect(String(resultRow?.props.subtitle)).toContain('2026');
        expect(String(resultRow?.props.subtitle)).not.toContain('T00:00:00.000Z');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backupResultDetails');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('/tmp/home-backup.tar');
        expect(alertRef().mock.calls.at(-1)?.[1]).toContain('home-identity-1');

        await screen.pressByTestIdAsync('settings.personalHomeRuntime.backupReveal');
        expect(revealBackupOutput).toHaveBeenCalledWith('/tmp/home-backup.tar');
    });

    it('exposes the typed restore recovery outcome without leaking internal rollback paths into primary UI', async () => {
        const harness = createScriptedRunnerHarness();
        const { PersonalHomeRuntimeControlSection } = await import('./PersonalHomeRuntimeControlSection');
        const screen = await renderScreen(React.createElement(PersonalHomeRuntimeControlSection, {
            runner: harness.runner,
            operations: { selectBackupArchive: async () => '/a.tar' },
        }));
        await resolveInitialInspectionWith(harness, INSPECT_RESULT_DATA);

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
        expect(subtitle).not.toContain('/home/.happier/self-host/data/.operations/rollback-previous');
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
