import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalServiceLaunchTargetV1 } from '@happier-dev/protocol';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';

import { useServicesOpenInBrowser } from './useServicesOpenInBrowser';
import { readLocalServiceActionOutcome } from './localServiceActionOutcome';

const machineRpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: machineRpcMock }));

const openableTarget: LocalServiceLaunchTargetV1 = {
    id: 'preview:open-feed',
    source: 'registered_preview',
    machineId: 'machine-a',
    sessionId: 'session-a',
    title: 'Open feed preview',
    subtitle: 'localhost:5173',
    confidence: 'high',
    state: 'available',
    actions: [],
    browserTarget: {
        kind: 'localServicePreview',
        targetId: 'preview-open',
        sessionId: 'session-a',
        machineId: 'machine-a',
    },
};

const unmappableTarget: LocalServiceLaunchTargetV1 = {
    ...openableTarget,
    id: 'preview:unmappable',
    machineId: '',
    browserTarget: undefined,
};

type Captured = {
    open: ReturnType<typeof useServicesOpenInBrowser> | null;
};

function HookProbe(props: Readonly<{
    scopeId: string;
    captured: Captured;
    onAfterOpen?: () => void;
}>) {
    const pane = useAppPaneScope(props.scopeId);
    const open = useServicesOpenInBrowser({
        scopeId: props.scopeId,
        scope: 'sessionDetails',
        // The transport is supplied at the machine RPC boundary; keep the real preview store.
        machineId: null,
        serverId: 'server-a',
        sessionId: 'session-a',
        onAfterOpen: props.onAfterOpen,
    });
    props.captured.open = open ?? null;

    return React.createElement('HookProbe', {
        detailsTabKinds: (pane.scopeState?.details.tabs ?? []).map((tab) => tab.kind),
    });
}

describe('useServicesOpenInBrowser', () => {
    beforeEach(() => {
        standardCleanup();
        const resource = {
            previewId: 'preview-open', sessionId: 'session-a', machineId: 'machine-a',
            owner: { kind: 'session', id: 'session-a' }, target: { scheme: 'http', host: '127.0.0.1', port: 5173 },
            initialPath: { pathname: '/', search: '' }, display: { title: 'Open feed preview', addressLabel: 'localhost:5173' },
            originMode: 'host', browserTarget: openableTarget.browserTarget,
        };
        const preview = { previewId: resource.previewId, resource, accessUrl: 'https://preview-open.preview.test/?previewToken=fresh', expiresAt: 61_000, diagnostics: [] };
        machineRpcMock.mockResolvedValue({ protocolVersion: 1, status: 'existing', preview, snapshot: { v: 1, machineId: resource.machineId, generatedAt: 1_000, refreshState: 'idle', resources: [resource], previews: [preview], diagnostics: [] } });
    });

    it('opens a browser-surface details tab in the pane scope for a mappable service target', async () => {
        const captured: Captured = { open: null };
        const screen = await renderScreen(
            <AppPaneProvider>
                <HookProbe scopeId="session:s1:details" captured={captured} />
            </AppPaneProvider>,
        );

        expect(captured.open).toBeTypeOf('function');
        await act(async () => {
            const result = await captured.open?.(openableTarget);
            expect(readLocalServiceActionOutcome(result)).toEqual({ kind: 'succeeded' });
        });

        const probe = screen.tree.findByType('HookProbe' as never);
        expect(probe.props.detailsTabKinds).toContain('browser-view');
    });

    it('invokes onAfterOpen only when the target is mappable', async () => {
        const onAfterOpen = vi.fn();
        const captured: Captured = { open: null };
        await renderScreen(
            <AppPaneProvider>
                <HookProbe scopeId="session:s2:details" captured={captured} onAfterOpen={onAfterOpen} />
            </AppPaneProvider>,
        );

        await act(async () => {
            const result = await captured.open?.(unmappableTarget);
            expect(result).toMatchObject({ status: 'denied' });
            expect(readLocalServiceActionOutcome(result).kind).toBe('failed');
        });
        expect(onAfterOpen).not.toHaveBeenCalled();

        await act(async () => {
            await captured.open?.(openableTarget);
        });
        expect(onAfterOpen).toHaveBeenCalledTimes(1);
    });

    it('does not open a tab for an unmappable target', async () => {
        const captured: Captured = { open: null };
        const screen = await renderScreen(
            <AppPaneProvider>
                <HookProbe scopeId="session:s3:details" captured={captured} />
            </AppPaneProvider>,
        );

        await act(async () => {
            await captured.open?.(unmappableTarget);
        });

        const probe = screen.tree.findByType('HookProbe' as never);
        expect(probe.props.detailsTabKinds).not.toContain('browser-view');
    });
});
