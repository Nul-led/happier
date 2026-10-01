import { describe, expect, it } from 'vitest';

import {
    formatAutomationWatcherImpediment,
    resolveAutomationEventObserverRuntimeHealth,
    resolveAutomationWatcherHealth,
} from './automationWatcherHealth';

describe('Automation Event observer runtime health', () => {
    it('accepts exact current source custody from the eligible Event producer', () => {
        expect(resolveAutomationEventObserverRuntimeHealth({
            currentSourceCustody: { kind: 'development', registeredRootId: 'github-generation-current' },
            reporterSourceCustody: { kind: 'development', registeredRootId: 'github-generation-current' },
        })).toEqual({ kind: 'current' });
    });

    it('rejects retained status from replaced source custody', () => {
        expect(resolveAutomationEventObserverRuntimeHealth({
            currentSourceCustody: { kind: 'development', registeredRootId: 'github-generation-current' },
            reporterSourceCustody: { kind: 'development', registeredRootId: 'github-generation-retired' },
        })).toEqual({ kind: 'generationReplaced' });
    });

    it('does not present retained status without a current eligible-event producer', () => {
        expect(resolveAutomationEventObserverRuntimeHealth({
            currentSourceCustody: null,
            reporterSourceCustody: { kind: 'development', registeredRootId: 'github-generation-current' },
        })).toEqual({ kind: 'runtimeUnavailable' });
    });
});

describe('Automation watcher health', () => {
    const watcher = { machineId: 'machine-a', machineInstallationId: 'install-a' };

    it('does not call the watcher\'s machine gone while the machine list is still loading', () => {
        const checking = resolveAutomationWatcherHealth({ watcher, machine: undefined, machineListSettled: false });
        expect(checking.kind).not.toBe('machineUnknown');
        expect(formatAutomationWatcherImpediment(checking)).toBeUndefined();
    });

    it('says the machine left the account once a settled list lacks it', () => {
        expect(resolveAutomationWatcherHealth({ watcher, machine: undefined, machineListSettled: true }))
            .toEqual({ kind: 'machineUnknown' });
    });
});
