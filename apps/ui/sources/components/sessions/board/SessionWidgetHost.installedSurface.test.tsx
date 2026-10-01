import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginProjectionV2 } from '@happier-dev/protocol';
import { normalizePluginUiInlineSurfaceBindingV1 } from '@happier-dev/protocol/plugins/ui';
import { SessionSurfaceItemV1Schema, type SessionSurfaceItemV1 } from '@happier-dev/protocol/sessions/board';

import { manifest as publicAuthoringManifest } from '../../../../../../packages/plugin-sdk/examples/public-authoring/index.ts';
import { readCanonicalPluginManifest } from '../../../../../cli/src/plugins/manifest/normalize.ts';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { normalizePluginUiProjection } from '@/sync/domains/plugins/ui/projection';
import type { SessionBoardItemProjection, SessionBoardMountHost } from '@/sync/domains/session/board';
import { selectWidgetCandidates } from '@/components/widgets/widgetCatalog';

import { SessionWidgetHost } from './SessionWidgetHost';
import { createSessionBoardSourceAvailabilityResolver } from './sessionBoardItemPresentation';

/**
 * The shared widget shell's installed arm across placements.
 *
 * The failure pinned here is invisible until it costs something: a Board card, a
 * compact sidebar card and a Companion card all showing the same item, each
 * starting its own executable plugin frame, Host API binding and Resource
 * subscription just to look busy. The one-primary rule says only the placement
 * the Session shell selected may run; the others are inert references.
 *
 * The incumbent plugin subsystem is replaced at its own owner boundary (the same
 * convention `AgentInlineSurface.test.tsx` uses); the shell, presentation and
 * correlation below all run for real.
 */

const state = vi.hoisted(() => ({
    mounts: [] as Record<string, unknown>[],
    activeMountKeys: new Set<string>(),
    session: null as ReturnType<typeof createSessionFixture> | null,
}));

vi.mock('@/components/plugins/surfaces', () => ({
    PluginInlineSurfaceHost: (props: Record<string, unknown>) => {
        state.mounts.push(props);
        const mountInstanceKey = String(props.mountInstanceKey);
        React.useEffect(() => {
            state.activeMountKeys.add(mountInstanceKey);
            return () => { state.activeMountKeys.delete(mountInstanceKey); };
        }, [mountInstanceKey]);
        return React.createElement('PluginInlineSurfaceHost');
    },
}));

// Policy evaluation has its own owner tests. This composition suite supplies
// the same admitted exact-Session context so importing its runtime hook does not
// require generated bundled-plugin artifacts that are intentionally absent from
// source-only remote mirrors.
vi.mock('@/components/sessions/plugins/useSessionPluginPolicyContext', () => ({
    useSessionPluginPolicyContext: () => ({ platform: 'web' }),
}));

// Store hooks are a process boundary for this focused host test. Keep the mock
// closed so an unrelated generated Artifact inventory cannot determine whether
// the placement/currentness behavior is runnable on a remote executor.
vi.mock('@/sync/store/hooks', () => ({
    useSession: () => state.session,
    useSessionServerId: () => 'home-a',
    useSettings: () => ({}),
    useLocalSetting: () => null,
}));

vi.mock('@/utils/sessions/sessionUtils', () => ({
    useSessionStatus: () => ({ state: 'waiting' }),
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesSnapshotForServerId: () => ({ status: 'ready', features: {} }),
    resolveRuntimeFeatureDecisionFromSnapshot: () => ({ state: 'enabled' }),
}));

// The generated app-package byte inventory is intentionally absent from the
// source-only remote test mirror. Installed-surface correlation/currentness is
// below that Artifact-read boundary, and the executable host itself is already
// replaced above.
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => null,
}));
vi.mock('@/sync/domains/plugins/availability/reader', () => ({
    createPluginAccountAvailabilityReader: vi.fn(() => null),
    createPluginAccountAvailabilityReaderStore: vi.fn(() => ({
        get: vi.fn(() => null),
        subscribe: vi.fn(() => () => {}),
    })),
    projectPluginAccountAvailabilityMaterializationIdentity: vi.fn(() => null),
}));

const SURFACE = { pluginId: 'acme.review', localId: 'review-status-widget' } as const;

function publicAuthoringProjection() {
    const manifest = readCanonicalPluginManifest(publicAuthoringManifest);
    if (!manifest) throw new Error('the maintained public-authoring manifest must remain canonical');
    const view = manifest.contributes.ui.views.find((candidate) => candidate.id === 'review-status-widget');
    if (!view) throw new Error('the maintained public-authoring example must emit review-status-widget');
    const rendererIds = manifest.contributes.ui.renderers.map((candidate) => candidate.id);
    const binding = normalizePluginUiInlineSurfaceBindingV1({
        pluginId: manifest.id,
        surfaceId: view.id,
        rendererId: view.renderer,
        fallbackRendererIds: view.fallbackRenderers,
        availableRendererIds: rendererIds,
        role: view.container,
        target: view.target,
    });
    if (!binding) throw new Error('the emitted public-authoring widget must remain Registry-admitted');
    const primaryRenderer = manifest.contributes.ui.renderers.find((candidate) => candidate.id === view.renderer);
    if (!primaryRenderer) throw new Error('the emitted public-authoring widget renderer must be present');
    const entry = {
        id: `surfacePlacement:${manifest.id}:${view.id}`,
        pluginId: manifest.id,
        contributionKind: 'surfacePlacement',
        descriptorId: view.id,
        // The daemon producer stamps every projected UI entry with its plugin-slot occurrence.
        occurrenceId: `${manifest.id}#1`,
        binding,
        target: binding.target,
        renderer: { kind: primaryRenderer.kind, contributionId: primaryRenderer.id },
        display: { title: view.title },
        availability: { state: 'available', reason: 'available', diagnostics: [] },
    };
    return normalizePluginUiProjection({
        v: 2,
        generation: 17,
        installedPackagesById: {
            [manifest.id]: {
                id: manifest.id,
                displayName: manifest.displayName,
                version: manifest.version,
                enabled: true,
                immutableGenerationId: 'public-authoring-generation-17',
                source: { kind: 'path', locator: '/fixtures/public-authoring' },
            },
        },
        actionsById: {},
        familiesById: { pluginUi: { entriesById: { [entry.id]: entry } } },
    } as unknown as PluginProjectionV2);
}

function projection(options: Readonly<{
    generation?: number;
    installed?: boolean;
    includePlacement?: boolean;
    availability?: 'available' | 'disabled';
}> = {}) {
    const binding = normalizePluginUiInlineSurfaceBindingV1({
        pluginId: SURFACE.pluginId,
        surfaceId: SURFACE.localId,
        rendererId: 'review-native',
        role: 'widget',
        target: { kind: 'session' },
    });
    if (!binding) throw new Error('fixture must use an admitted inline binding');
    const entry = {
        id: `surfacePlacement:${SURFACE.pluginId}:${SURFACE.localId}`,
        pluginId: SURFACE.pluginId,
        contributionKind: 'surfacePlacement',
        descriptorId: SURFACE.localId,
        occurrenceId: `${SURFACE.pluginId}#${options.generation ?? 3}`,
        binding,
        target: binding.target,
        renderer: { kind: 'reactNative', contributionId: 'review-native' },
        display: { title: 'Review status' },
        availability: options.availability === 'disabled'
            ? { state: 'disabled', reason: 'plugin_disabled', diagnostics: [] }
            : { state: 'available', reason: 'available', diagnostics: [] },
    };
    return normalizePluginUiProjection({
        v: 2,
        generation: options.generation ?? 3,
        installedPackagesById: options.installed === false ? {} : {
            [SURFACE.pluginId]: {
                id: SURFACE.pluginId,
                displayName: 'Review Assistant',
                enabled: true,
                source: { kind: 'local', path: '/plugins/acme.review' },
            },
        },
        actionsById: {},
        familiesById: {
            pluginUi: {
                entriesById: options.includePlacement === false ? {} : { [entry.id]: entry },
            },
        },
    } as unknown as PluginProjectionV2);
}

function runtime(overrides: Partial<SessionPluginRuntimeState> = {}): SessionPluginRuntimeState {
    return {
        pluginUiProjection: projection(),
        pluginBrowserProjection: null,
        phase: 'current',
        interactionEnabled: true,
        machineId: 'machine-a',
        serverId: 'home-a',
        platform: 'web',
        ...overrides,
    } as SessionPluginRuntimeState;
}

const item: SessionBoardItemProjection = {
    itemId: 'widget-1',
    revision: 'rev-1',
    state: {
        kind: 'ready',
        item: {
            v: 1,
            title: 'Review status',
            frame: 'card',
            height: { mode: 'auto', fallback: 'regular' },
            source: { kind: 'installedSurface', surface: SURFACE },
            input: { view: 'summary' },
        } as SessionSurfaceItemV1,
    },
};

async function renderPlacement(input: Readonly<{
    host: SessionBoardMountHost;
    primaryHost: SessionBoardMountHost | null;
    density: 'full' | 'compact' | 'preview';
    expanded?: boolean;
    runtimeOverrides?: Partial<SessionPluginRuntimeState>;
    onManagePlugin?: () => void;
    onOpenHere?: () => void;
    executableCurrentness?: 'current' | 'stale' | 'offline' | 'unverified';
}>) {
    const current = { ...runtime(), ...input.runtimeOverrides } as SessionPluginRuntimeState;
    return await renderScreen(React.createElement(SessionWidgetHost, {
        sessionId: 'session-1',
        session: state.session ?? undefined,
        item,
        host: input.host,
        primaryHost: input.primaryHost,
        density: input.density,
        expanded: input.expanded,
        canEdit: true,
        executableCurrentness: input.executableCurrentness ?? 'current',
        heightBounds: { min: 96, max: 520 },
        pluginRuntime: current,
        resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(current),
        ...(input.onManagePlugin ? { onManagePlugin: input.onManagePlugin } : {}),
        ...(input.onOpenHere ? { onOpenHere: input.onOpenHere } : {}),
        testID: 'widget',
    }));
}

function actionsOf(screen: Awaited<ReturnType<typeof renderScreen>>): ReadonlyArray<Record<string, unknown>> {
    const owners = screen.tree.root.findAll(
        (node) => Array.isArray((node.props as { actions?: unknown }).actions)
            && (node.props as { overflowTriggerTestID?: string }).overflowTriggerTestID === 'widget-actions',
        { deep: true },
    );
    return (owners.at(-1)?.props as { actions?: ReadonlyArray<Record<string, unknown>> } | undefined)
        ?.actions ?? [];
}

describe('SessionWidgetHost installed surface placements', () => {
    beforeEach(() => {
        standardCleanup();
        state.mounts = [];
        state.activeMountKeys.clear();
        state.session = createSessionFixture({ id: 'session-1' });
    });

    it('mounts the maintained emitted public-authoring widget through the real candidate and host path', async () => {
        const pluginUiProjection = publicAuthoringProjection();
        const candidate = selectWidgetCandidates(pluginUiProjection, 'session').find(
            (value) => value.surface.pluginId === publicAuthoringManifest.id
                && value.surface.localId === 'review-status-widget',
        );
        expect(candidate).toMatchObject({
            surface: {
                pluginId: publicAuthoringManifest.id,
                localId: 'review-status-widget',
            },
        });
        if (!candidate) throw new Error('the maintained public-authoring widget must be selectable');

        const publicItem: SessionBoardItemProjection = {
            itemId: 'public-authoring-widget',
            revision: 'public-authoring-revision-1',
            state: {
                kind: 'ready',
                item: SessionSurfaceItemV1Schema.parse({
                    v: 1,
                    title: candidate.title,
                    frame: 'card',
                    height: { mode: 'auto', fallback: 'regular' },
                    source: { kind: 'installedSurface', surface: candidate.surface },
                    input: { view: 'summary' },
                }),
            },
        };
        const current = runtime({ pluginUiProjection });
        const renderPublicWidget = (executableCurrentness: 'current' | 'stale') => React.createElement(SessionWidgetHost, {
            sessionId: 'session-1',
            session: state.session ?? undefined,
            item: publicItem,
            host: 'details' as const,
            primaryHost: 'details' as const,
            density: 'full' as const,
            canEdit: true,
            executableCurrentness,
            heightBounds: { min: 96, max: 520 },
            pluginRuntime: current,
            resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(current),
            testID: 'public-authoring-widget',
        });

        const screen = await renderScreen(renderPublicWidget('current'));
        expect(state.mounts).toHaveLength(1);
        expect(state.mounts[0]).toMatchObject({
            placement: {
                pluginId: publicAuthoringManifest.id,
                descriptorId: 'review-status-widget',
            },
            inlineMount: { role: 'widget', presentation: 'content' },
            launchInput: { view: 'summary' },
        });

        await screen.update(renderPublicWidget('stale'));
        expect(state.activeMountKeys).toEqual(new Set());
    });

    it('mounts the plugin exactly once in the shell-selected primary placement', async () => {
        // The compact sidebar is a real promised host and is the cheapest one to
        // render, so this pins the mount contract without dragging the spacious
        // grid's chrome into every assertion.
        await renderPlacement({ host: 'sidebar', primaryHost: 'sidebar', density: 'compact' });
        expect(state.mounts).toHaveLength(1);
        expect(state.mounts[0]!.launchInput).toEqual({ view: 'summary' });
    });

    it('uses current installed-frame height for Auto, ignores it while fixed, and restores it with Fit content', async () => {
        const onSetHeight = vi.fn();
        const renderWidget = (height: SessionSurfaceItemV1['height']) => React.createElement(SessionWidgetHost, {
            sessionId: 'session-1',
            session: state.session ?? undefined,
            item: {
                ...item,
                state: item.state.kind === 'ready'
                    ? { kind: 'ready' as const, item: { ...item.state.item, height } }
                    : item.state,
            },
            host: 'details' as const,
            primaryHost: 'details' as const,
            density: 'full' as const,
            canEdit: true,
            executableCurrentness: 'current' as const,
            heightBounds: { min: 96, max: 520 },
            pluginRuntime: runtime(),
            resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(runtime()),
            onSetHeight,
            testID: 'widget',
        });
        const screen = await renderScreen(renderWidget({ mode: 'auto', fallback: 'regular' }));
        const reportHeight = state.mounts.at(-1)?.onIntrinsicHeightChange as ((height: number) => void) | undefined;
        expect(reportHeight).toEqual(expect.any(Function));

        await act(async () => { reportHeight?.(432); });
        expect(screen.findByTestId('widget-body')?.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ height: 432 }),
        ]));

        await screen.update(renderWidget({ mode: 'fixed', size: 'compact' }));
        await act(async () => { reportHeight?.(500); });
        expect(screen.findByTestId('widget-body')?.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ height: 160 }),
        ]));

        const fitContent = actionsOf(screen).find((action) => action.id === 'height-auto');
        (fitContent?.onPress as (() => void) | undefined)?.();
        expect(onSetHeight).toHaveBeenLastCalledWith({ mode: 'auto', fallback: 'tall' });

        await screen.update(renderWidget({ mode: 'auto', fallback: 'tall' }));
        expect(screen.findByTestId('widget-body')?.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ height: 500 }),
        ]));
    });

    it('supplies the existing plugin-management recovery to the incumbent host for late lifecycle refusal', async () => {
        const managePlugin = vi.fn();
        await renderPlacement({
            host: 'details',
            primaryHost: 'details',
            density: 'full',
            onManagePlugin: managePlugin,
        });

        const action = state.mounts[0]?.unavailableAction as Readonly<{
            label: string;
            onPress: () => void;
        }> | undefined;
        expect(action?.label).toEqual(expect.any(String));
        action?.onPress();
        expect(managePlugin).toHaveBeenCalledOnce();
    });

    it('retains one item through disabled and uninstalled states and remounts a fresh H lifetime on reinstall', async () => {
        const managePlugin = vi.fn();
        const removeFromBoard = vi.fn();
        const renderWidget = (current: SessionPluginRuntimeState) => React.createElement(SessionWidgetHost, {
            sessionId: 'session-1',
            session: state.session ?? undefined,
            item,
            host: 'companion' as const,
            primaryHost: 'companion' as const,
            density: 'compact' as const,
            canEdit: true,
            executableCurrentness: 'current' as const,
            heightBounds: { min: 96, max: 520 },
            pluginRuntime: current,
            resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(current),
            onManagePlugin: managePlugin,
            onRemove: removeFromBoard,
            testID: 'widget',
        });
        const generationG = runtime({ pluginUiProjection: projection({ generation: 7 }) });
        const screen = await renderScreen(renderWidget(generationG));
        const generationGMountKey = state.mounts.at(-1)?.mountInstanceKey;

        const disabled = runtime({
            pluginUiProjection: projection({ generation: 8, availability: 'disabled' }),
        });
        await screen.update(renderWidget(disabled));
        // The canonical availability owner retires the executable mount before
        // publishing the two valid lifecycle recoveries on the inert card.
        expect(state.activeMountKeys).toEqual(new Set());
        await screen.pressByTestIdAsync('widget-state-action');
        await screen.pressByTestIdAsync('widget-state-secondary-action');
        expect(managePlugin).toHaveBeenCalledOnce();
        expect(removeFromBoard).toHaveBeenCalledOnce();

        managePlugin.mockClear();
        removeFromBoard.mockClear();

        const uninstalled = runtime({
            pluginUiProjection: projection({ generation: 9, installed: false, includePlacement: false }),
        });
        await screen.update(renderWidget(uninstalled));
        expect(state.activeMountKeys).toEqual(new Set());
        await screen.pressByTestIdAsync('widget-state-action');
        await screen.pressByTestIdAsync('widget-state-secondary-action');
        expect(managePlugin).toHaveBeenCalledOnce();
        expect(removeFromBoard).toHaveBeenCalledOnce();

        const generationH = runtime({ pluginUiProjection: projection({ generation: 10 }) });
        await screen.update(renderWidget(generationH));
        expect(state.mounts.at(-1)?.mountInstanceKey).not.toBe(generationGMountKey);
        expect(state.activeMountKeys).toEqual(new Set([String(state.mounts.at(-1)?.mountInstanceKey)]));
        // The shared record identity/revision never changed; lifecycle recovery
        // creates only a fresh executable mount, never a replacement Board item.
        expect(item.itemId).toBe('widget-1');
        expect(item.revision).toBe('rev-1');
    });

    it('keeps a non-primary placement an inert reference, not a duplicate frame', async () => {
        const screen = await renderPlacement({ host: 'sidebar', primaryHost: 'details', density: 'compact' });
        expect(state.mounts).toHaveLength(0);
        // ...and not a failure either: a healthy widget that simply runs in
        // another placement must never be reported as unavailable.
        expect(screen.findAllByTestId('widget-state')).toHaveLength(0);
        expect(screen.findByTestId('widget-provenance')).toBeTruthy();
    });

    it('never offers Open for an unavailable retained widget', async () => {
        const open = vi.fn();
        const screen = await renderPlacement({
            host: 'sidebar',
            primaryHost: 'details',
            density: 'compact',
            runtimeOverrides: {
                pluginUiProjection: projection({ availability: 'disabled' }),
            },
            onManagePlugin: vi.fn(),
            onOpenHere: open,
        });

        expect(state.mounts).toHaveLength(0);
        expect(screen.findByTestId('widget-state')).not.toBeNull();
        expect(actionsOf(screen).some((action) => action.id === 'openHere')).toBe(false);
        expect(open).not.toHaveBeenCalled();
    });

    it('unmounts a stale retained item and gives the same record a fresh physical lifetime after reconnect', async () => {
        const current = runtime();
        const renderWidget = (executableCurrentness: 'current' | 'stale' | 'offline' | 'unverified') => React.createElement(SessionWidgetHost, {
            sessionId: 'session-1',
            session: state.session ?? undefined,
            item,
            host: 'companion' as const,
            primaryHost: 'companion' as const,
            density: 'compact' as const,
            canEdit: true,
            executableCurrentness,
            heightBounds: { min: 96, max: 520 },
            pluginRuntime: current,
            resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(current),
            testID: 'widget',
        });
        const screen = await renderScreen(renderWidget('current'));
        const generationG = state.mounts.at(-1)?.mountInstanceKey;
        expect(state.activeMountKeys).toEqual(new Set([String(generationG)]));

        await screen.update(renderWidget('offline'));
        expect(state.activeMountKeys.size).toBe(0);
        expect(screen.findByTestId('widget-executable-offline')).not.toBeNull();

        await screen.update(renderWidget('current'));
        const generationH = state.mounts.at(-1)?.mountInstanceKey;
        expect(generationH).not.toBe(generationG);
        expect(state.activeMountKeys).toEqual(new Set([String(generationH)]));
    });

    it('never mounts retained plugin code when the Board record itself is still current', async () => {
        const screen = await renderPlacement({
            host: 'details',
            primaryHost: 'details',
            density: 'full',
            runtimeOverrides: { phase: 'retainedOffline', interactionEnabled: false },
            executableCurrentness: 'current',
        });

        expect(state.mounts).toHaveLength(0);
        expect(screen.findByTestId('widget-runtime-retainedOffline-state')).not.toBeNull();
    });

    it('binds a fresh physical mount nonce when the current installed generation changes', async () => {
        const renderWidget = (current: SessionPluginRuntimeState) => React.createElement(SessionWidgetHost, {
            sessionId: 'session-1',
            session: state.session ?? undefined,
            item,
            host: 'details' as const,
            primaryHost: 'details' as const,
            density: 'full' as const,
            canEdit: true,
            executableCurrentness: 'current' as const,
            heightBounds: { min: 96, max: 520 },
            pluginRuntime: current,
            resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(current),
            testID: 'widget',
        });
        const screen = await renderScreen(renderWidget(runtime({ pluginUiProjection: projection({ generation: 7 }) })));
        const generationGKey = state.mounts.at(-1)?.mountInstanceKey;

        await screen.update(renderWidget(runtime({ pluginUiProjection: projection({ generation: 8 }) })));

        expect(state.mounts.at(-1)?.mountInstanceKey).not.toBe(generationGKey);
        expect(state.activeMountKeys).toEqual(new Set([String(state.mounts.at(-1)?.mountInstanceKey)]));
    });

    it('never runs an inline transcript row, because the shell never elects that placement', async () => {
        // The transcript row passes the shell's answer straight through
        // (`SessionBoardActionResultReference.tsx:44-48`), and the visibility owner never puts
        // `inlineTranscript` in `visibleHosts` — so `primaryHost` is whatever pane is really
        // showing the item, or nothing at all. Both are previews here.
        await renderPlacement({ host: 'inlineTranscript', primaryHost: null, density: 'preview' });
        expect(state.mounts).toHaveLength(0);
        await renderPlacement({ host: 'inlineTranscript', primaryHost: 'details', density: 'preview' });
        expect(state.mounts).toHaveLength(0);
    });

    it('derives plugin presentation from the actual compact or expanded host, not persisted frame chrome', async () => {
        await renderPlacement({ host: 'companion', primaryHost: 'companion', density: 'compact' });
        expect(state.mounts.at(-1)?.inlineMount).toMatchObject({ presentation: 'content' });

        await renderPlacement({ host: 'focusedDetails', primaryHost: 'focusedDetails', density: 'full', expanded: true });
        expect(state.mounts.at(-1)?.inlineMount).toMatchObject({ presentation: 'fill' });
    });

    // The mobile Cockpit renders the Board before its Session projection has
    // hydrated. Reporting "this device cannot show this content" for a widget
    // whose plugin is installed, enabled and projected is a lie the person
    // cannot act on — and it is not a renderer fact at all.
    it('reports a Session that has not hydrated as loading, never as a missing renderer', async () => {
        state.session = null;
        const screen = await renderPlacement({ host: 'details', primaryHost: 'details', density: 'full' });

        expect(state.mounts).toHaveLength(0);
        const cards = screen.tree.root.findAll(
            (node) => typeof (node.props as { diagnosticCode?: unknown }).diagnosticCode === 'string',
            { deep: true },
        );
        const codes = cards.map((node) => (node.props as { diagnosticCode: string }).diagnosticCode);
        expect(codes).toContain('widget_session_hydrating');
        expect(codes).not.toContain('session_board_renderer_missing');
    });

    it('reports an establishing plugin projection as loading, never as an uninstalled plugin', async () => {
        const screen = await renderPlacement({
            host: 'details',
            primaryHost: 'details',
            density: 'full',
            runtimeOverrides: { pluginUiProjection: null, phase: 'establishing' },
        });

        expect(state.mounts).toHaveLength(0);
        const cards = screen.tree.root.findAll(
            (node) => typeof (node.props as { diagnosticCode?: unknown }).diagnosticCode === 'string',
            { deep: true },
        );
        const codes = cards.map((node) => (node.props as { diagnosticCode: string }).diagnosticCode);
        expect(codes).toContain('widget_projection_establishing');
        expect(codes).not.toContain('plugin_unavailable');
    });
});
