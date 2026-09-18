import * as React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installMachinesSettingsCommonModuleMocks } from '@/components/settings/machines/machinesSettingsTestHelpers';

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const LOCAL_PARAMS = {
    target: { kind: 'local' },
    surface: 'desktop.ui',
    mode: 'user',
    // The app's release ring: local tasks acquire the managed CLI from it.
    channel: 'stable',
};

async function createHarness() {
    const { createSystemTaskRunner } = await import('@/components/systemTasks/createSystemTaskRunner');
    const { SystemTaskSpecSchema } = await import('@happier-dev/protocol');

    let nextTaskId = 1;
    const listeners = new Map<string, {
        onEvent: (payload: unknown) => void;
        onResult: (payload: unknown) => void;
    }>();
    const starts: Array<{ kind: string; params: unknown }> = [];

    const runner = createSystemTaskRunner({
        bridge: {
            async start(spec) {
                const parsed = SystemTaskSpecSchema.parse(spec);
                starts.push({ kind: parsed.kind, params: parsed.params });
                return `task_${nextTaskId++}:${parsed.kind}`;
            },
            async subscribe(taskId, listenerSet) {
                listeners.set(taskId, listenerSet);
                return () => {
                    listeners.delete(taskId);
                };
            },
            async cancel() {},
            async respond() {},
        },
    });

    const { LocalCliPathExposureSection } = await import('./LocalCliPathExposureSection');
    const screen = await renderScreen(React.createElement(LocalCliPathExposureSection, { runner }));

    return {
        screen,
        starts,
        /** The props this section hands the canonical `Item` primitive. */
        row(testID: string): Record<string, unknown> {
            const match = screen.findAllByTestId(testID)
                .find((node) => typeof node.type !== 'string' && node.props?.title !== undefined);
            if (!match) throw new Error(`no Item row for ${testID}`);
            return match.props as Record<string, unknown>;
        },
        subtitleOf(testID: string): unknown {
            const match = screen.findAllByTestId(testID)
                .find((node) => typeof node.type !== 'string' && node.props?.title !== undefined);
            return match?.props.subtitle;
        },
        async resolve(taskId: string, data: Record<string, unknown>) {
            await renderer.act(async () => {
                listeners.get(taskId)?.onResult({ protocolVersion: 1, taskId, ok: true, data });
            });
        },
        async fail(taskId: string, message: string) {
            await renderer.act(async () => {
                listeners.get(taskId)?.onResult({
                    protocolVersion: 1,
                    taskId,
                    ok: false,
                    error: { code: 'cli_path_exposure_failed', message },
                });
            });
        },
    };
}

describe('LocalCliPathExposureSection', () => {
    it('starts the ensure task from the add row and shows the returned reload hint', async () => {
        const harness = await createHarness();

        expect(harness.starts).toEqual([]);
        await harness.screen.pressByTestIdAsync('settings.localCliPath.add');

        expect(harness.starts).toEqual([{ kind: 'cli.pathExposure.ensure.v1', params: LOCAL_PARAMS }]);

        // While the owner is working the row says so and claims no outcome yet.
        expect(harness.row('settings.localCliPath.add').loading).toBe(true);
        expect(harness.subtitleOf('settings.localCliPath.status')).toBe('machine.cliPath.working');

        await harness.resolve('task_1:cli.pathExposure.ensure.v1', {
            changed: true,
            shellReloadHint: 'Open a new terminal, or run: source "/home/me/.zshrc"',
            failure: null,
        });

        expect(harness.subtitleOf('settings.localCliPath.status'))
            .toBe('Open a new terminal, or run: source "/home/me/.zshrc"');
        expect(harness.row('settings.localCliPath.add').loading).toBe(false);
    });

    it('reports an already-present entry without claiming a change', async () => {
        const harness = await createHarness();

        await harness.screen.pressByTestIdAsync('settings.localCliPath.add');
        await harness.resolve('task_1:cli.pathExposure.ensure.v1', { changed: false, shellReloadHint: null, failure: null });

        expect(harness.subtitleOf('settings.localCliPath.status')).toBe('machine.cliPath.alreadyPresent');
        // `changed: false` does not prove Happier owns the entry, so removal stays offered.
        expect(harness.row('settings.localCliPath.remove').disabled).toBe(false);
    });

    it('starts the remove task from the remove row and reports what the owner removed', async () => {
        const harness = await createHarness();

        await harness.screen.pressByTestIdAsync('settings.localCliPath.remove');

        expect(harness.starts).toEqual([{ kind: 'cli.pathExposure.remove.v1', params: LOCAL_PARAMS }]);

        await harness.resolve('task_1:cli.pathExposure.remove.v1', { removed: true, failure: null });
        expect(harness.subtitleOf('settings.localCliPath.status')).toBe('machine.cliPath.removed');
    });

    it('stops offering removal once the owner reports there is no Desktop-created entry', async () => {
        const harness = await createHarness();

        expect(harness.row('settings.localCliPath.remove').disabled).toBe(false);

        await harness.screen.pressByTestIdAsync('settings.localCliPath.remove');
        await harness.resolve('task_1:cli.pathExposure.remove.v1', { removed: false, failure: null });

        expect(harness.subtitleOf('settings.localCliPath.status')).toBe('machine.cliPath.nothingToRemove');
        expect(harness.row('settings.localCliPath.remove').disabled).toBe(true);
        expect(harness.screen.findHostByTestId('settings.localCliPath.remove')?.props.disabled).toBe(true);
        expect(harness.row('settings.localCliPath.add').disabled).toBe(false);

        // Adding the entry back makes it removable again — both facts come from the owner.
        await harness.screen.pressByTestIdAsync('settings.localCliPath.add');
        await harness.resolve('task_2:cli.pathExposure.ensure.v1', { changed: true, shellReloadHint: null, failure: null });
        expect(harness.row('settings.localCliPath.remove').disabled).toBe(false);
    });

    it('surfaces a task failure as the repair affordance and keeps both actions available', async () => {
        const harness = await createHarness();

        await harness.screen.pressByTestIdAsync('settings.localCliPath.add');
        await harness.fail('task_1:cli.pathExposure.ensure.v1', 'Could not update shell profile /home/me/.profile: EACCES');

        expect(harness.subtitleOf('settings.localCliPath.status'))
            .toBe('Could not update shell profile /home/me/.profile: EACCES');
        expect(harness.row('settings.localCliPath.add').disabled).toBe(false);
        expect(harness.row('settings.localCliPath.remove').disabled).toBe(false);
    });

    it('announces the outcome politely and labels every row', async () => {
        const harness = await createHarness();

        await harness.screen.pressByTestIdAsync('settings.localCliPath.add');
        await harness.resolve('task_1:cli.pathExposure.ensure.v1', { changed: true, shellReloadHint: null, failure: null });

        const status = harness.row('settings.localCliPath.status');
        expect(status.accessibilityLiveRegion).toBe('polite');
        expect(status.title).toBe('machine.status');
        expect(harness.row('settings.localCliPath.add').title).toBe('machine.cliPath.addTitle');
        expect(harness.row('settings.localCliPath.remove').title).toBe('machine.cliPath.removeTitle');

        // What the primitive actually renders: a keyboard-reachable button carrying both labels,
        // and a polite live region for the outcome.
        const addHost = harness.screen.findHostByTestId('settings.localCliPath.add');
        expect(addHost?.props.role).toBe('button');
        expect(addHost?.props.tabIndex).toBe(0);
        expect(addHost?.props['aria-label']).toBe('machine.cliPath.addTitle. machine.cliPath.addSubtitle');
        expect(harness.screen.findHostByTestId('settings.localCliPath.status')?.props['aria-live']).toBe('polite');
        expect(harness.screen.getTextContent()).toContain('machine.cliPath.addTitle');
    });
});
