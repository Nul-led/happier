import { describe, expect, it, vi } from 'vitest';

describe('buildLocalRelayRuntimeSystemTaskSpec', () => {
    it('uses channel=dev on publicdev builds', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({
            config: {
                variant: 'publicdev',
            },
        }));

        const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
        const spec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.status.v1');
        const params = spec.params as Record<string, unknown>;
        expect(params.channel).toBe('dev');

        const operation = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.inspect.v1', {
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        });
        expect(operation.params).toEqual({
            target: { kind: 'local' },
            channel: 'dev',
            mode: 'user',
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        });
        vi.doUnmock('@/config');
    });

    it('carries the fixed Personal Home purpose and environment', async () => {
        vi.resetModules();
        const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
        const spec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.installOrUpdate.v1', {
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        });
        const params = spec.params as Record<string, unknown>;
        expect(params.purpose).toEqual({ kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' });
        expect(params.env).toEqual(expect.objectContaining({
            HAPPIER_SERVER_HOST: '127.0.0.1',
            PORT: '43123',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
            HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
        }));
    });

    describe('Personal Home operation kinds', () => {
        const purpose = { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' };
        const baseParams = { target: { kind: 'local' }, channel: 'stable', mode: 'user', purpose };

        it('builds the exact inspect kind with no caller-owned facts', async () => {
            vi.resetModules();
            const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
            const spec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.inspect.v1', { purpose });
            expect(spec).toEqual({
                protocolVersion: 1,
                kind: 'relay.runtime.personal_home.inspect.v1',
                params: baseParams,
            });
        });

        it('omits outputPath unless the user chose a backup destination', async () => {
            vi.resetModules();
            const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
            const defaultSpec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.backup.v1', { purpose });
            expect(defaultSpec.params).toEqual(baseParams);

            const explicitSpec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.backup.v1', {
                purpose, personalHomeOperation: { outputPath: '  /tmp/home-backup.tar  ' },
            });
            expect(explicitSpec.params).toEqual({ ...baseParams, outputPath: '/tmp/home-backup.tar' });
        });

        it('requires an archive path for verify-backup and carries it for restore with the explicit overwrite confirmation', async () => {
            vi.resetModules();
            const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
            expect(() => buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.verify_backup.v1', { purpose })).toThrow();

            const verifySpec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.verify_backup.v1', {
                purpose, personalHomeOperation: { archivePath: '/tmp/home-backup.tar' },
            });
            expect(verifySpec.params).toEqual({ ...baseParams, archivePath: '/tmp/home-backup.tar' });

            const restoreSpec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.restore.v1', {
                purpose, personalHomeOperation: { archivePath: '/tmp/home-backup.tar', confirmOverwrite: true },
            });
            expect(restoreSpec.params).toEqual({
                ...baseParams,
                archivePath: '/tmp/home-backup.tar',
                confirmOverwrite: true,
            });

            const restoreWithoutOverwrite = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.restore.v1', {
                purpose, personalHomeOperation: { archivePath: '/tmp/home-backup.tar' },
            });
            expect(restoreWithoutOverwrite.params).toEqual({
                ...baseParams,
                archivePath: '/tmp/home-backup.tar',
            });

            const recoverSpec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.restore.v1', {
                purpose, personalHomeOperation: { action: 'recover' },
            });
            expect(recoverSpec.params).toEqual({ ...baseParams, action: 'recover' });
        });

        it('builds erase without a caller-owned confirmation bypass', async () => {
            vi.resetModules();
            const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
            const spec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.erase.v1', { purpose });
            expect(spec.params).toEqual(baseParams);
        });

        it('keeps operation specs free of install-time environment facts while binding the inspected purpose', async () => {
            vi.resetModules();
            const { buildLocalRelayRuntimeSystemTaskSpec } = await import('./buildLocalRelayRuntimeSystemTaskSpec');
            const spec = buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.personal_home.backup.v1', {
                purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
                anonymousSignupEnabled: true,
            });
            const params = spec.params as Record<string, unknown>;
            expect(params.env).toBeUndefined();
            expect(params.purpose).toEqual(purpose);
        });
    });
});
