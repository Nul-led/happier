import { describe, expect, it } from 'vitest';

import {
    resolveExistingSessionMcpSelectionRollback,
    shouldShowExistingSessionMcpChip,
} from './useExistingSessionMcpSelection';

describe('shouldShowExistingSessionMcpChip', () => {
    it('allows MCP selection only for writable inactive sessions with an agent', () => {
        expect(shouldShowExistingSessionMcpChip({ isReadOnly: false, sessionActive: false, agentAvailable: true })).toBe(true);
        expect(shouldShowExistingSessionMcpChip({ isReadOnly: true, sessionActive: false, agentAvailable: true })).toBe(false);
        expect(shouldShowExistingSessionMcpChip({ isReadOnly: false, sessionActive: true, agentAvailable: true })).toBe(true);
        expect(shouldShowExistingSessionMcpChip({ isReadOnly: false, sessionActive: false, agentAvailable: false })).toBe(false);
    });

    it('rolls the latest failed write back to server-confirmed selection only', () => {
        const persistedSelection = {
            v: 1 as const,
            managedServersEnabled: true,
            forceIncludeServerIds: ['persisted'],
            forceExcludeServerIds: [],
        };
        expect(resolveExistingSessionMcpSelectionRollback({
            failedSelectionKey: 'latest',
            pendingSelectionKey: 'latest',
            persistedSelection,
        })).toEqual(persistedSelection);
        expect(resolveExistingSessionMcpSelectionRollback({
            failedSelectionKey: 'older',
            pendingSelectionKey: 'latest',
            persistedSelection,
        })).toBeNull();
    });
});
