import { describe, expect, it } from 'vitest';

import {
    resolveMachineSessionGoalExecutionCapabilities,
    resolveSessionGoalExecutionCapabilities,
    resolveSessionNativeGoalOwner,
} from './sessionGoalExecutionCapabilities';

describe('session goal execution capabilities', () => {
    it('uses the live runtime registry for active sessions', () => {
        expect(resolveSessionGoalExecutionCapabilities({
            session: {
                active: true,
                agentState: {
                    capabilities: {
                        sessionGoalSetSupported: true,
                        sessionGoalClearSupported: false,
                    },
                },
            },
            machine: { metadata: { daemonSessionGoalControlsSupported: true } },
        })).toEqual({ canSet: true, canClear: false });
    });

    it('keeps the goal with the daemon when the opened runtime has no goal controls (Keep going owns continuation, F5/X16)', () => {
        expect(resolveSessionGoalExecutionCapabilities({
            session: { active: true, agentState: null },
            machine: { metadata: { daemonSessionGoalControlsSupported: true } },
        })).toEqual({ canSet: true, canClear: true });
        expect(resolveSessionGoalExecutionCapabilities({
            session: { active: true, agentState: { capabilities: {} } },
            machine: { metadata: {} },
        })).toEqual({ canSet: false, canClear: false });
    });

    it('uses the daemon-owned capability for inactive sessions', () => {
        expect(resolveSessionGoalExecutionCapabilities({
            session: { active: false, agentState: null },
            machine: { metadata: { daemonSessionGoalControlsSupported: true } },
        })).toEqual({ canSet: true, canClear: true });
        expect(resolveSessionGoalExecutionCapabilities({
            session: { active: false, agentState: null },
            machine: { metadata: {} },
        })).toEqual({ canSet: false, canClear: false });
    });

    it('fails closed for pre-session controls unless the daemon advertises support', () => {
        expect(resolveMachineSessionGoalExecutionCapabilities({
            metadata: { daemonSessionGoalControlsSupported: true },
        })).toEqual({ canSet: true, canClear: true });
        expect(resolveMachineSessionGoalExecutionCapabilities({ metadata: {} })).toEqual({
            canSet: false,
            canClear: false,
        });
    });

    it('names the opened runtime the continuation owner only when it carries native goal controls (X16)', () => {
        expect(resolveSessionNativeGoalOwner({
            active: true,
            agentState: { capabilities: { sessionGoalSetSupported: true, sessionGoalClearSupported: true } },
        })).toBe(true);
        expect(resolveSessionNativeGoalOwner({
            active: true,
            agentState: { capabilities: { sessionGoalSetSupported: true, sessionGoalClearSupported: false } },
        })).toBe(false);
        // A closed session has no opened runtime: Keep going is its continuation owner.
        expect(resolveSessionNativeGoalOwner({
            active: false,
            agentState: { capabilities: { sessionGoalSetSupported: true, sessionGoalClearSupported: true } },
        })).toBe(false);
    });
});
