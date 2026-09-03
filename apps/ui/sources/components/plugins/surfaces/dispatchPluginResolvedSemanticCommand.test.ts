import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_PLUGIN_UI_PROJECTION, type PluginUiProjectionModel } from '@/sync/domains/plugins/ui/projection';

import { dispatchPluginResolvedSemanticCommand } from './dispatchPluginResolvedSemanticCommand';

const launch = vi.hoisted(() => vi.fn());

vi.mock('./launchPluginSurfaceAction', () => ({ launchPluginSurfaceAction: launch }));

const SCOPED = Object.freeze({
    serverId: 'server-1',
    machineId: 'machine-1',
    generation: 4,
    interactionEnabled: true,
});

function projection(): PluginUiProjectionModel {
    return Object.freeze({
        ...EMPTY_PLUGIN_UI_PROJECTION,
        generation: 4,
        actionsById: Object.freeze({
            'acme.demo/read': Object.freeze({
                id: 'read',
                pluginId: 'acme.demo',
                title: 'Read',
                scopes: ['global'],
                surfaces: ['ui'],
                execution: { target: 'daemon' },
                dangerLevel: 'safe',
                available: true,
            }),
        }),
    }) as PluginUiProjectionModel;
}

function unionProjectionWithActionOrigin(): PluginUiProjectionModel {
    return Object.freeze({
        ...projection(),
        generation: 999,
        actionsById: Object.freeze({
            'acme.demo/read': Object.freeze({
                ...projection().actionsById['acme.demo/read'],
                hostOrigin: Object.freeze({
                    machineId: 'machine-action',
                    serverId: 'server-action',
                    generation: 41,
                    interactionEnabled: true,
                    phase: 'current' as const,
                    executionOrigin: {
                        serverIdentityId: 'srv_test',
                        materializationRef: {
                            pluginId: 'acme.demo',
                            machineId: 'machine-action',
                            materializationId: 'machine-action:acme.demo',
                        },
                    },
                }),
            }),
        }),
    }) as PluginUiProjectionModel;
}

beforeEach(() => {
    launch.mockReset();
    launch.mockResolvedValue({ kind: 'settled', outcome: { ok: true, result: null } });
});

describe('dispatchPluginResolvedSemanticCommand', () => {
    it('carries the caller AbortSignal into the canonical dispatcher', async () => {
        const controller = new AbortController();
        await dispatchPluginResolvedSemanticCommand({
            projection: projection(),
            callerPluginId: 'acme.demo',
            command: { kind: 'executeAction', action: { pluginId: 'acme.demo', localId: 'read' } },
            scopedLaunchFacts: SCOPED,
            signal: controller.signal,
        });
        expect(launch.mock.calls[0]![0].signal).toBe(controller.signal);
        // Structured identity, never the qualified string: a bare string would
        // be offered to the host ActionSpec branch first.
        expect(launch.mock.calls[0]![0].action).toEqual({ pluginId: 'acme.demo', localId: 'read' });
        expect(launch.mock.calls[0]![0].contributedAction).toMatchObject({
            machineId: 'machine-1',
            expectedGeneration: '4',
        });
    });

    it('uses the resolved Action origin for execution while retaining union generation as the currentness fence', async () => {
        await dispatchPluginResolvedSemanticCommand({
            projection: unionProjectionWithActionOrigin(),
            callerPluginId: 'acme.demo',
            command: { kind: 'executeAction', action: { pluginId: 'acme.demo', localId: 'read' } },
            scopedLaunchFacts: {
                serverId: null,
                machineId: null,
                generation: 999,
                interactionEnabled: true,
            },
        });

        expect(launch.mock.calls[0]![0].contributedAction).toMatchObject({
            machineId: 'machine-action',
            serverId: 'server-action',
            expectedGeneration: '41',
        });
    });

    it('routes openSurface to the destination owner rather than the Action dispatcher', async () => {
        const openSurface = vi.fn().mockResolvedValue({ ok: true });
        const outcome = await dispatchPluginResolvedSemanticCommand({
            projection: projection(),
            callerPluginId: 'acme.demo',
            command: {
                kind: 'openSurface',
                destination: { pluginId: 'acme.demo', localId: 'page' },
                input: { v: 1 },
                subPath: '',
            },
            scopedLaunchFacts: SCOPED,
            openSurface,
        });
        expect(openSurface).toHaveBeenCalledWith({
            destination: { pluginId: 'acme.demo', localId: 'page' },
            input: { v: 1 },
            subPath: '',
        });
        expect(launch).not.toHaveBeenCalled();
        expect(outcome).toEqual({ ok: true });
    });

    /**
     * The preflight runs BEFORE the outward navigation, exactly as the Action
     * branch runs it before dispatch. Opening a destination is an outward
     * effect on the reader's shell; a row whose admitting projection is already
     * retired must not perform it.
     */
    it('refuses an openSurface command once the admitting generation is retired', async () => {
        const openSurface = vi.fn().mockResolvedValue({ ok: true });
        const outcome = await dispatchPluginResolvedSemanticCommand({
            projection: projection(),
            callerPluginId: 'acme.demo',
            command: { kind: 'openSurface', destination: { pluginId: 'acme.demo', localId: 'page' } },
            scopedLaunchFacts: { ...SCOPED, generation: 3 },
            openSurface,
        });
        expect(outcome).toEqual({
            ok: false,
            code: 'stale_surface',
            reason: 'plugin_ui_generation_retired',
        });
        expect(openSurface).not.toHaveBeenCalled();
    });

    it('refuses an openSurface command once the Account scope is no longer current', async () => {
        const openSurface = vi.fn().mockResolvedValue({ ok: true });
        const outcome = await dispatchPluginResolvedSemanticCommand({
            projection: projection(),
            callerPluginId: 'acme.demo',
            command: { kind: 'openSurface', destination: { pluginId: 'acme.demo', localId: 'page' } },
            scopedLaunchFacts: SCOPED,
            scopeIsCurrent: () => false,
            openSurface,
        });
        expect(outcome).toEqual({
            ok: false,
            code: 'stale_surface',
            reason: 'plugin_ui_generation_retired',
        });
        expect(openSurface).not.toHaveBeenCalled();
    });

    /**
     * The navigation itself commonly retires the source surface. The preflight
     * is therefore the only fence: a current open that unmounts its origin must
     * still settle as the success it was.
     */
    it('succeeds for a current open whose navigation retires the source surface', async () => {
        let current = true;
        const openSurface = vi.fn().mockImplementation(async () => {
            current = false;
            return { ok: true };
        });
        const outcome = await dispatchPluginResolvedSemanticCommand({
            projection: projection(),
            callerPluginId: 'acme.demo',
            command: { kind: 'openSurface', destination: { pluginId: 'acme.demo', localId: 'page' } },
            scopedLaunchFacts: SCOPED,
            scopeIsCurrent: () => current,
            openSurface,
        });
        expect(openSurface).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual({ ok: true });
    });

    it('refuses a daemon Action once the admitting generation is retired', async () => {
        const outcome = await dispatchPluginResolvedSemanticCommand({
            projection: projection(),
            callerPluginId: 'acme.demo',
            command: { kind: 'executeAction', action: { pluginId: 'acme.demo', localId: 'read' } },
            scopedLaunchFacts: { ...SCOPED, generation: 3 },
        });
        expect(outcome).toEqual({
            ok: false,
            code: 'unavailable',
            reason: 'plugin_ui_action_unavailable',
        });
        expect(launch).not.toHaveBeenCalled();
    });

    it('refuses an Action the current projection no longer publishes as available', async () => {
        const retired = Object.freeze({
            ...projection(),
            actionsById: Object.freeze({}),
        }) as PluginUiProjectionModel;
        const outcome = await dispatchPluginResolvedSemanticCommand({
            projection: retired,
            callerPluginId: 'acme.demo',
            command: { kind: 'executeAction', action: { pluginId: 'acme.demo', localId: 'read' } },
            scopedLaunchFacts: SCOPED,
        });
        expect(outcome).toEqual({
            ok: false,
            code: 'unavailable',
            reason: 'plugin_ui_action_unavailable',
        });
        expect(launch).not.toHaveBeenCalled();
    });
});
