import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen as renderTestScreen, pressTestInstanceAsync } from '@/dev/testkit';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import type { ToolCall } from '@happier-dev/session-core/messages';

vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => 'tablet' }));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ useWindowDimensions: () => ({ width: 1400, height: 900 }) });
});
const boundary = vi.hoisted(() => ({ views: [] as unknown[], requests: [] as unknown[] }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: async (input: unknown) => {
        boundary.requests.push(input);
        return { protocolVersion: 1, views: boundary.views };
    },
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) });
});
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub, createStorageStoreMock } = await import('@/dev/testkit/mocks/storage');
    const { createSessionFixture } = await import('@/dev/testkit/fixtures/sessionFixtures');
    const { createMachineFixture } = await import('@/dev/testkit/fixtures/machineFixtures');
    const storage = createStorageStoreMock({
        sessions: { session_1: createSessionFixture({ id: 'session_1', serverId: 'server_1' }) },
        machineListByServerId: { server_1: [createMachineFixture()] },
    });
    return createStorageModuleStub({ storage, getStorage: () => storage });
});

// Imported at collection: the module graph is large and must not count against a test's timeout.
import { BrowserActionResultReference } from './BrowserActionResultReference';

const view = { browserSessionId: 'browser_session_1', viewId: 'browser_view_1' } as const;

function renderScreen(element: React.ReactElement) {
    return renderTestScreen(<AppPaneProvider>{element}</AppPaneProvider>);
}

function tool(overrides: Partial<ToolCall>): ToolCall {
    return {
        name: 'mcp__happier__action_execute',
        state: 'completed',
        input: {},
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        description: null,
        result: null,
        ...overrides,
    } as ToolCall;
}

describe('BrowserActionResultReference', () => {
    beforeEach(() => { boundary.views = []; boundary.requests = []; });

    it('watches the exact admitted daemon capture source without reopening the action URL', async () => {
        boundary.views = [{ ...view, sourceId: 'exact-source', platform: 'web', adapterKind: 'chromiumSidecar',
            target: { kind: 'externalUrl', targetId: 'agent-target', url: 'https://example.com' }, events: [],
            captureSource: { v: 1, sourceId: 'exact-source', sourceKind: 'browser', supportedCodecs: ['image.mjpeg'],
                inputMode: 'shared', sidebands: [], health: { status: 'available' } } }];
        let paneState: ReturnType<typeof useAppPaneScope>['scopeState'] = null;
        const readPaneState = (): ReturnType<typeof useAppPaneScope>['scopeState'] => paneState;
        function Probe() {
            paneState = useAppPaneScope(createSessionPaneScopeId('session_1', 'server_1')).scopeState;
            return null;
        }
        const screen = await renderScreen(<>
            <BrowserActionResultReference sessionId="session_1" serverId="server_1" tool={tool({
                input: { actionId: 'browser.view.open', input: { ...view,
                    target: { kind: 'externalUrl', targetId: 'agent-target', url: 'https://example.com' } } },
            })} />
            <Probe />
        </>);
        await pressTestInstanceAsync(screen.findByTestId('transcript-browser-action-browser.view.open-watch')!);
        expect(boundary.requests).toContainEqual(expect.objectContaining({ serverId: 'server_1', machineId: 'machine-1',
            payload: { machineId: 'machine-1', browserSessionId: 'browser_session_1' } }));
        expect(readPaneState()?.details.tabs[0]?.resource).toMatchObject({ ...view,
            target: { kind: 'streamedBrowser', streamId: 'exact-source', targetId: 'exact-source' } });
    });

    it('says what the agent did in the page and shows the screenshot it took', async () => {
        const click = await renderScreen(
            <BrowserActionResultReference
                sessionId="session_1"
                tool={tool({
                    input: {
                        actionId: 'browser.automation.click',
                        input: { ...view, actionKind: 'click', payload: { locator: 'role=button[name="Sign in"]', url: 'http://localhost:5173/login?x=1' } },
                    },
                })}
            />,
        );
        expect(click.getTextContent()).toContain('browserTool.clicked:{"target":"Sign in"}');
        expect(click.getTextContent()).toContain('localhost:5173/login');
        expect(click.getTextContent()).not.toContain('x=1');

        const shot = await renderScreen(
            <BrowserActionResultReference
                sessionId="session_1"
                tool={tool({
                    input: { actionId: 'browser.context.captureScreenshot', input: { ...view } },
                    result: {
                        screenshot: {
                            mediaId: 'media_1',
                            mediaKind: 'image',
                            width: 1280,
                            height: 800,
                            sizeBytes: 48_000,
                            file: {
                                sessionId: 'session_1',
                                storage: 'session',
                                path: '.happier/media/browser/shot-1.png',
                                sha256: 'b'.repeat(64),
                                mimeType: 'image/png',
                            },
                        },
                    },
                })}
            />,
        );
        expect(shot.getTextContent()).toContain('browserTool.screenshot');
        expect(shot.findByTestId(
            'transcript-browser-action-browser.context.captureScreenshot-inline-image:.happier/media/browser/shot-1.png',
        )).toBeTruthy();
    });

    it('shows the thumbnail of a screenshot the daemon stored for this Session', async () => {
        // The managed browser's captures live in the daemon's Session media store (W2B), not in the
        // Session's working directory.
        const shot = await renderScreen(
            <BrowserActionResultReference
                sessionId="session_1"
                serverId="server_1"
                tool={tool({
                    input: { actionId: 'browser.context.captureScreenshot', input: { ...view } },
                    result: {
                        screenshot: {
                            mediaId: 'media_2',
                            mediaKind: 'image',
                            width: 1280,
                            height: 800,
                            sizeBytes: 48_000,
                            file: {
                                sessionId: 'session_1',
                                storage: 'daemon',
                                path: 'media/sessions/session_1/shot-2.png',
                                sha256: 'c'.repeat(64),
                                mimeType: 'image/png',
                            },
                        },
                    },
                })}
            />,
        );
        expect(shot.findByTestId(
            'transcript-browser-action-browser.context.captureScreenshot-inline-image:media/sessions/session_1/shot-2.png',
        )).toBeTruthy();
    });

    it('renders nothing for a tool call that is not a browser Action', async () => {
        const screen = await renderScreen(
            <BrowserActionResultReference
                sessionId="session_1"
                tool={tool({ input: { actionId: 'workflow.run.start', input: {} } })}
            />,
        );
        expect(screen.tree.toJSON()).toBeNull();
    });
});
