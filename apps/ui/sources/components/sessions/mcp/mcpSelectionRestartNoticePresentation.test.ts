import { describe, expect, it } from 'vitest';

import { buildMcpSelectionRestartNoticePresentation } from './mcpSelectionRestartNoticePresentation';

const metadata = {
    mcpSelectionV1: {
        v: 1,
        managedServersEnabled: true,
        forceIncludeServerIds: ['server-new'],
        forceExcludeServerIds: [],
    },
    mcpSelectionRestartRequiredV1: {
        v: 1,
        appliedSelection: {
            v: 1,
            managedServersEnabled: true,
            forceIncludeServerIds: [],
            forceExcludeServerIds: [],
        },
    },
};

describe('buildMcpSelectionRestartNoticePresentation', () => {
    it('shows only a real active-session divergence', () => {
        expect(buildMcpSelectionRestartNoticePresentation({
            sessionActive: true,
            metadata,
            operationStatus: null,
            translate: (key) => key,
        })).toMatchObject({
            banner: { testID: 'session.mcpSelectionRestartRequired.banner', disabled: false },
            statusBadge: { key: 'session-mcp-selection-restart-required', tone: 'warning' },
        });
        expect(buildMcpSelectionRestartNoticePresentation({
            sessionActive: false,
            metadata,
            operationStatus: null,
            translate: (key) => key,
        })).toBeNull();
        expect(buildMcpSelectionRestartNoticePresentation({
            sessionActive: true,
            metadata: {
                ...metadata,
                mcpSelectionRestartRequiredV1: {
                    v: 1,
                    appliedSelection: metadata.mcpSelectionV1,
                },
            },
            operationStatus: null,
            translate: (key) => key,
        })).toBeNull();
    });
});
