import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const state = vi.hoisted(() => ({
    machines: [] as Array<{
        id: string;
        active: boolean;
        metadata: { displayName: string; host: string };
    }>,
}));
const fetchMachineDoctorSnapshotMock = vi.hoisted(() => vi.fn());
const serverFetchMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children, ...props }: any) => React.createElement('ItemList', props, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, ...props }: any) => React.createElement('ItemGroup', props, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
    TextInput: (props: any) => React.createElement('TextInput', props),
}));

vi.mock('@/components/ui/icons/Icon', () => ({
    Icon: (props: any) => React.createElement('Icon', props),
    ICON_SIZE: {
        xs: 12,
        sm: 14,
        md: 18,
        lg: 20,
        xl: 24,
        xxl: 32,
    },
}));

vi.mock('@/components/ui/copy/CopiedPill', () => ({
    CopiedPill: (props: any) => React.createElement('CopiedPill', props),
}));

vi.mock('@/components/ui/copy/useTemporaryCopyFeedback', () => ({
    useTemporaryCopyFeedback: () => ({
        isCopied: () => false,
        markCopied: vi.fn(),
    }),
}));

vi.mock('@/utils/ui/clipboard', () => ({
    setClipboardStringSafe: vi.fn(async () => true),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: 'home-1',
        serverUrl: 'https://home.example',
        generation: 1,
    }),
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    listServerProfiles: () => [{ id: 'home-1', serverUrl: 'https://home.example' }],
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useMachineListByServerId: () => ({ 'home-1': state.machines }),
    useProfile: () => ({ id: 'account-1' }),
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchMock,
}));

vi.mock('@/components/machines/doctorSnapshot/useMachineDoctorSnapshot', () => ({
    useMachineDoctorSnapshot: () => ({
        fetchMachineDoctorSnapshot: fetchMachineDoctorSnapshotMock,
        readMachineDoctorSnapshot: () => null,
    }),
}));

function snapshotFor(machineId: string, serverUrl = 'https://home.example') {
    return {
        capturedAt: '2026-09-15T00:00:00.000Z',
        server: {
            activeServerId: 'home-1',
            serverUrl,
            publicServerUrl: serverUrl,
            webappUrl: 'https://app.example',
        },
        accountId: 'account-1',
        settings: {
            activeServerId: 'home-1',
            servers: [],
            knownAccountIds: ['account-1'],
        },
        machineId,
    };
}

async function settle(): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    state.machines = Array.from({ length: 4 }, (_, index) => ({
        id: `machine-${index + 1}`,
        active: true,
        metadata: {
            displayName: `Machine ${index + 1}`,
            host: `machine-${index + 1}`,
        },
    }));
    fetchMachineDoctorSnapshotMock.mockReset();
    fetchMachineDoctorSnapshotMock.mockImplementation(async ({ machineId }: { machineId: string }) => ({
        status: 'ready',
        snapshot: snapshotFor(machineId),
    }));
    serverFetchMock.mockReset();
    serverFetchMock.mockResolvedValue({ ok: true, status: 200 });
});

describe('DiagnosisView', () => {
    it('renders and checks every online machine before announcing whole-system success', async () => {
        const { DiagnosisView } = await import('./DiagnosisView');
        const screen = await renderScreen(<DiagnosisView />);

        const machineRows = screen.findAllByType('Item' as any)
            .filter((node) => typeof node.props.title === 'string' && node.props.title.startsWith('Machine '));
        expect(machineRows.map((node) => node.props.title)).toEqual([
            'Machine 1',
            'Machine 2',
            'Machine 3',
            'Machine 4',
        ]);

        await act(async () => {
            screen.pressByTestId('diagnosis-run-button');
            await settle();
        });

        expect(fetchMachineDoctorSnapshotMock.mock.calls.map(([input]) => input.machineId)).toEqual([
            'machine-1',
            'machine-2',
            'machine-3',
            'machine-4',
        ]);
        const status = screen.findByTestId('diagnosis-accessibility-status');
        expect(status?.props.accessibilityLiveRegion).toBe('polite');
        expect(status?.props['aria-live']).toBe('polite');
        expect(status?.props.children).toBe('diagnosis.findings.none');
    });

    it('labels the diagnostics JSON input and announces the bounded running state', async () => {
        fetchMachineDoctorSnapshotMock.mockImplementationOnce(() => new Promise(() => {}));

        const { DiagnosisView } = await import('./DiagnosisView');
        const screen = await renderScreen(<DiagnosisView />);

        expect(screen.findByTestId('diagnosis-paste-input')?.props.accessibilityLabel)
            .toBe('diagnosis.sections.pasteDoctorJson');

        act(() => {
            screen.changeTextByTestId('diagnosis-paste-input', '{ invalid json');
        });
        const parseAction = screen.findAllByType('Item' as any)
            .find((node) => node.props.title === 'diagnosis.pasteDoctorJson.parse');
        await act(async () => {
            parseAction?.props.onPress?.();
            await settle();
        });
        const parseError = screen.findAllByType('Text' as any)
            .find((node) => node.props.children === 'diagnosis.pasteDoctorJson.error');
        expect(parseError?.props.accessibilityLiveRegion).toBe('polite');
        expect(parseError?.props['aria-live']).toBe('polite');

        act(() => {
            screen.pressByTestId('diagnosis-run-button');
        });
        expect(screen.findByTestId('diagnosis-accessibility-status')?.props.children)
            .toBe('diagnosis.machineRuns.loading');

        await screen.unmount();
    });

    it('announces terminal findings instead of claiming success', async () => {
        fetchMachineDoctorSnapshotMock.mockImplementation(async ({ machineId }: { machineId: string }) => {
            return {
                status: 'ready',
                snapshot: snapshotFor(
                    machineId,
                    machineId === 'machine-3' ? 'https://other-home.example' : 'https://home.example',
                ),
            };
        });

        const { DiagnosisView } = await import('./DiagnosisView');
        const screen = await renderScreen(<DiagnosisView />);

        await act(async () => {
            screen.pressByTestId('diagnosis-run-button');
            await settle();
        });

        const status = screen.findByTestId('diagnosis-accessibility-status');
        expect(status?.props.children).toContain('diagnosis.findings.serverMismatch.title');
        expect(status?.props.children).not.toContain('diagnosis.findings.none');
    });

    it('announces partial machine failures and does not render whole-system success', async () => {
        fetchMachineDoctorSnapshotMock.mockImplementation(async ({ machineId }: { machineId: string }) => {
            if (machineId === 'machine-2') {
                return { status: 'error', detail: 'unavailable' };
            }
            return { status: 'ready', snapshot: snapshotFor(machineId) };
        });

        const { DiagnosisView } = await import('./DiagnosisView');
        const screen = await renderScreen(<DiagnosisView />);

        await act(async () => {
            screen.pressByTestId('diagnosis-run-button');
            await settle();
        });

        const status = screen.findByTestId('diagnosis-accessibility-status');
        expect(status?.props.children).toContain('diagnosis.machineRuns.error');
        expect(status?.props.children).not.toContain('diagnosis.findings.none');
        expect(screen.findByTestId('diagnosis-machine-run-summary')?.props.title)
            .toBe('diagnosis.machineRuns.error');
        const failedMachine = screen.findAllByType('Item' as any)
            .find((node) => node.props.title === 'Machine 2');
        expect(failedMachine?.props.detail).toBe('diagnosis.machineRuns.error');
    });
});
