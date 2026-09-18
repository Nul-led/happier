import { describe, expect, it } from 'vitest';

import { resolveSystemTaskStepLabel } from './resolveSystemTaskStepLabel';

describe('resolveSystemTaskStepLabel', () => {
    it('returns null when step id is null', () => {
        expect(resolveSystemTaskStepLabel(null)).toBeNull();
    });

    it('translates known remote SSH step ids', () => {
        expect(resolveSystemTaskStepLabel('ssh.trust')).not.toBe('ssh.trust');
    });

    it('translates every local repair step id the repair task emits', () => {
        for (const stepId of [
            'setup.repairThisComputer.prepare',
            'setup.repairThisComputer.configureRelay',
            'setup.repairThisComputer.authRequest',
            'setup.repairThisComputer.authenticate',
            'setup.repairThisComputer.installService',
            'setup.repairThisComputer.startService',
            'setup.repairThisComputer.waitForReady',
            'setup.repairThisComputer.finish',
        ]) {
            expect(resolveSystemTaskStepLabel(stepId), stepId).not.toBe(stepId);
        }
    });

    it('translates known Tailscale secure access step ids', () => {
        expect(resolveSystemTaskStepLabel('tailscale.serveEnable')).not.toBe('tailscale.serveEnable');
        expect(resolveSystemTaskStepLabel('tailscale.verifyUrl')).not.toBe('tailscale.verifyUrl');
    });

    it('translates known relay access step ids', () => {
        expect(resolveSystemTaskStepLabel('relay.access.status.inspect')).not.toBe('relay.access.status.inspect');
        expect(resolveSystemTaskStepLabel('relay.access.configure.apply')).not.toBe('relay.access.configure.apply');
    });

    it('translates setup-this-computer preflight ownership step ids', () => {
        expect(resolveSystemTaskStepLabel('setup.thisComputer.ensureCli'))
            .not.toBe('setup.thisComputer.ensureCli');
        expect(resolveSystemTaskStepLabel('setup.thisComputer.preflight.releaseChannel'))
            .not.toBe('setup.thisComputer.preflight.releaseChannel');
        expect(resolveSystemTaskStepLabel('setup.thisComputer.preflight.serviceConflict'))
            .not.toBe('setup.thisComputer.preflight.serviceConflict');
    });

    it('returns null for unknown step ids', () => {
        expect(resolveSystemTaskStepLabel('unknown.step.id')).toBe('unknown.step.id');
    });
});
