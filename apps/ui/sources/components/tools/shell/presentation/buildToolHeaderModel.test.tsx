import { describe, expect, it, vi } from 'vitest';

import { buildToolHeaderModel } from './buildToolHeaderModel';
import { installToolShellPresentationCommonModuleMocks } from './toolShellPresentationTestHelpers';

installToolShellPresentationCommonModuleMocks();

vi.mock('@/components/tools/shell/presentation/resolveToolHeaderTextPresentation', () => ({
    resolveToolHeaderTextPresentation: ({ tool }: any) => ({
        normalizedToolName: tool.name,
        usedInferenceFallback: false,
        title: tool.name,
        subtitle: null,
        statusText: null,
    }),
}));

vi.mock('@/components/tools/catalog', () => ({
    knownTools: {
        SubAgentRun: {
            icon: (_size: number, _color: string, opts: unknown) => opts,
        },
    },
}));

vi.mock('@/components/tools/renderers/core/_registry', () => ({
    getToolViewComponent: () => null,
}));

vi.mock('@/agents/catalog/catalog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/agents/catalog/catalog')>();
    return {
        ...actual,
        resolveAgentIdFromFlavor: () => null,
        getAgentCore: () => ({ toolRendering: { hideUnknownToolsByDefault: false } }),
    };
});

describe('buildToolHeaderModel', () => {
    it('passes normalized tool and session metadata to contextual catalog icons', () => {
        const tool = {
            name: 'SubAgentRun',
            state: 'running',
            input: { backendTarget: { kind: 'builtInAgent', agentId: 'codex' } },
            createdAt: 1,
            startedAt: 1,
            completedAt: null,
            description: null,
            result: null,
        } as any;
        const metadata = { flavor: 'claude' } as any;
        const model = buildToolHeaderModel({
            tool,
            metadata,
            iconSize: 16,
            iconColorPrimary: '#111',
            iconColorSecondary: '#555',
        });

        expect(model.icon).toEqual({ tool, metadata });
    });

    it('marks completed unknown tools as collapsed by default', () => {
        const model = buildToolHeaderModel({
            tool: {
                name: 'WeirdTool',
                state: 'completed',
                input: {},
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
                description: null,
                result: {},
            } as any,
            metadata: null,
            iconSize: 16,
            iconColorPrimary: '#111',
            iconColorSecondary: '#555',
        });

        expect(model.isUnknownTool).toBe(true);
        expect(model.shouldCollapseUnknownToolByDefault).toBe(true);
    });

    it('marks running tools with pending permission as waiting for permission', () => {
        const model = buildToolHeaderModel({
            tool: {
                name: 'Edit',
                state: 'running',
                input: {},
                createdAt: 1,
                startedAt: 1,
                completedAt: null,
                description: null,
                result: null,
                permission: { status: 'pending' },
            } as any,
            metadata: null,
            iconSize: 16,
            iconColorPrimary: '#111',
            iconColorSecondary: '#555',
        });

        expect(model.isWaitingForPermission).toBe(true);
    });

    it('does not treat mcp tools as unknown', () => {
        const model = buildToolHeaderModel({
            tool: {
                name: 'mcp__foo__bar',
                state: 'completed',
                input: {},
                createdAt: 1,
                startedAt: 1,
                completedAt: 2,
                description: null,
                result: {},
            } as any,
            metadata: null,
            iconSize: 16,
            iconColorPrimary: '#111',
            iconColorSecondary: '#555',
        });

        expect(model.isUnknownTool).toBe(false);
        expect(model.shouldCollapseUnknownToolByDefault).toBe(false);
    });
});
