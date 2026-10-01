import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AcpCatalogSettingsV1 } from '@happier-dev/protocol';
import { standardCleanup } from '@/dev/testkit';
import { renderSettingsView, type SettingsViewHarness } from '@/dev/testkit/harness/settingsViewHarness';
import { createUseSettingMutableMockFromReader } from '@/dev/testkit/mocks/storage';

import { installAcpCatalogSettingsCommonModuleMocks } from './acpCatalogSettingsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    routerPushSpy: vi.fn(),
    routerReplaceSpy: vi.fn(),
    routerBackSpy: vi.fn(),
    modalAlertSpy: vi.fn(),
    settingsState: { value: { v: 2, backends: [] } as AcpCatalogSettingsV1 },
    writes: [] as AcpCatalogSettingsV1[],
    settingsVersion: 1 as number | null,
}));

installAcpCatalogSettingsCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ confirmResult: true, spies: { alert: shared.modalAlertSpy } }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            pathname: '/settings/agents/custom',
            router: {
                push: shared.routerPushSpy,
                replace: shared.routerReplaceSpy,
                back: shared.routerBackSpy,
            },
        }).module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                // Boundary fixture: null until the Account settings have loaded.
                useSettingsVersion: () => shared.settingsVersion,
                // Boundary fixture: the synced Account settings store, keyed.
                useSettingMutable: createUseSettingMutableMockFromReader((key) => {
                    if (key === 'acpCatalogSettingsV1') {
                        return [shared.settingsState.value, (next: AcpCatalogSettingsV1) => {
                            shared.writes.push(next);
                            shared.settingsState.value = next;
                        }];
                    }
                    if (key === 'secrets') return [[], vi.fn()];
                    return [null, vi.fn()];
                }),
            },
        });
    },
});

// Machine administration boundary: this Account has no machine, so "use an agent" opens setup.
vi.mock('@/sync/domains/machines/administration/useTargetSelection', () => ({
    useMachineAdministrationTargetSelection: () => ({
        selectedTarget: null,
        resolveExecutionTarget: () => null,
        pickerRows: [],
        candidates: [],
    }),
}));

// The environment editor is its own list editor with a modal per variable (covered elsewhere).
vi.mock('@/components/settings/mcpServers/McpValueRefMapEditor', () => ({
    McpValueRefMapEditor: (props: Record<string, unknown>) => React.createElement('McpValueRefMapEditor', props),
}));

const EDITOR = 'settings.acpCatalog.backendEditor';

function input(screen: SettingsViewHarness, testID: string) {
    const node = screen.findAll((candidate) => candidate.props?.testID === testID
        && typeof candidate.props?.onChangeText === 'function')[0];
    if (!node) throw new Error(`No field ${testID}`);
    return node;
}

async function type(screen: SettingsViewHarness, testID: string, text: string) {
    await act(async () => {
        input(screen, testID).props.onChangeText(text);
    });
}

async function press(screen: SettingsViewHarness, testID: string) {
    await act(async () => {
        await screen.pressByTestIdAsync(testID);
    });
}

function errorText(screen: SettingsViewHarness, testID: string): string | null {
    const node = screen.findAll((candidate) => candidate.props?.testID === `${testID}.error`)[0];
    if (!node) return null;
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children);
}

async function renderEditor(backendId: string | null) {
    const { AcpBackendEditorScreen } = await import('./AcpBackendEditorScreen');
    return renderSettingsView(React.createElement(AcpBackendEditorScreen, { backendId }));
}

const existingKiro = {
    id: 'kiro',
    name: 'kiro',
    title: 'Kiro',
    command: 'kiro-cli',
    args: ['acp'],
    env: {},
    capabilities: {
        supportsLoadSession: false,
        supportsModes: 'unknown' as const,
        supportsModels: 'unknown' as const,
        supportsConfigOptions: 'unknown' as const,
        promptImageSupport: 'unknown' as const,
    },
    createdAt: 1,
    updatedAt: 1,
};

beforeEach(() => {
    shared.settingsState.value = { v: 2, backends: [] };
    shared.writes = [];
    shared.settingsVersion = 1;
});

afterEach(() => {
    shared.routerPushSpy.mockReset();
    shared.routerReplaceSpy.mockReset();
    shared.routerBackSpy.mockReset();
    shared.modalAlertSpy.mockReset();
    standardCleanup();
});

describe('AcpBackendEditorScreen', () => {
    it('saves a new agent with an ID made from its name and its arguments in order, then opens it in the collection', async () => {
        const screen = await renderEditor(null);

        await type(screen, `${EDITOR}.title`, 'My Kiro');
        await type(screen, `${EDITOR}.command`, 'kiro-cli');
        await press(screen, `${EDITOR}.args.add`);
        await type(screen, `${EDITOR}.args.item.0`, 'acp');
        await press(screen, `${EDITOR}.args.add`);
        await type(screen, `${EDITOR}.args.item.1`, '--stdio');
        await press(screen, `${EDITOR}.save`);

        expect(shared.writes).toHaveLength(1);
        expect(shared.writes[0]?.backends).toEqual([expect.objectContaining({
            id: 'my-kiro',
            name: 'my-kiro',
            title: 'My Kiro',
            command: 'kiro-cli',
            args: ['acp', '--stdio'],
        })]);
        expect(shared.routerReplaceSpy).toHaveBeenCalledWith('/(app)/settings/agents/custom/my-kiro');
        expect(shared.modalAlertSpy).not.toHaveBeenCalled();
    });

    it('shows each refusal beside its field and writes nothing', async () => {
        const screen = await renderEditor(null);

        await press(screen, `${EDITOR}.save`);

        expect(shared.writes).toHaveLength(0);
        expect(errorText(screen, `${EDITOR}.title`)).toBe('settingsAgents.customAcp.errors.nameRequired');
        expect(errorText(screen, `${EDITOR}.command`)).toBe('settingsAgents.customAcp.errors.commandRequired');
        expect(shared.modalAlertSpy).not.toHaveBeenCalled();

        await type(screen, `${EDITOR}.command`, 'kiro-cli');
        expect(errorText(screen, `${EDITOR}.command`)).toBeNull();
    });

    it('refuses a new agent whose edited ID is already taken instead of replacing that agent', async () => {
        shared.settingsState.value = { v: 2, backends: [existingKiro] };
        const screen = await renderEditor(null);

        await type(screen, `${EDITOR}.title`, 'Kiro again');
        await type(screen, `${EDITOR}.command`, 'kiro-cli');
        await press(screen, `${EDITOR}.editId`);
        await type(screen, `${EDITOR}.id`, 'kiro');
        await press(screen, `${EDITOR}.save`);

        expect(shared.writes).toHaveLength(0);
        expect(errorText(screen, `${EDITOR}.id`)).toBe('settingsAgents.customAcp.errors.idTaken');
    });

    it('updates an existing agent in place and keeps its ID', async () => {
        shared.settingsState.value = { v: 2, backends: [existingKiro] };
        const screen = await renderEditor('kiro');

        await press(screen, `${EDITOR}.args.remove.0`);
        await type(screen, `${EDITOR}.title`, 'Kiro CLI');
        await press(screen, `${EDITOR}.save`);

        expect(shared.writes).toHaveLength(1);
        expect(shared.writes[0]?.backends).toEqual([expect.objectContaining({ id: 'kiro', title: 'Kiro CLI', args: [] })]);
        expect(shared.routerReplaceSpy).not.toHaveBeenCalled();
    });

    it('says a missing agent is gone only once the Account settings have loaded', async () => {
        shared.settingsVersion = null;
        const loading = await renderEditor('kiro');
        expect(loading.findAll((node) => node.props?.description === 'settingsAgents.customAcp.notFound')).toHaveLength(0);

        shared.settingsVersion = 3;
        const loaded = await renderEditor('kiro');
        expect(loaded.findAll((node) => node.props?.description === 'settingsAgents.customAcp.notFound').length).toBeGreaterThan(0);
    });

    it('deletes an existing agent from its menu after confirmation and leaves the page', async () => {
        shared.settingsState.value = { v: 2, backends: [existingKiro] };
        const screen = await renderEditor('kiro');

        const menu = screen.findAll((node) => node.props?.testID === `${EDITOR}.menu`
            && typeof node.props?.onSelect === 'function')[0];
        expect(menu?.props.items.map((item: { id: string }) => item.id)).toEqual(['delete']);
        await act(async () => {
            await menu?.props.onSelect('delete');
        });

        expect(shared.writes.at(-1)?.backends).toEqual([]);
        expect(shared.routerReplaceSpy).toHaveBeenCalledWith('/(app)/settings/agents');
    });
});
