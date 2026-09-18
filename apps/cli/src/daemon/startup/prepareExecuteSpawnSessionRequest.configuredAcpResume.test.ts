import { describe, expect, it, vi } from 'vitest';

import { SPAWN_SESSION_ERROR_CODES } from '@/session/shared/spawnSessionContract';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        debugLargeJson: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

import { prepareExecuteSpawnSessionRequest } from './prepareExecuteSpawnSessionRequest';

const CONFIGURED_BACKEND_ID = 'review-bot';
const PROVIDER_SESSION_ID = 'provider-session-42';

function accountSettingsWithConfiguredBackend(supportsLoadSession: boolean) {
    return {
        acpCatalogSettingsV1: {
            v: 2,
            backends: [{
                id: CONFIGURED_BACKEND_ID,
                name: CONFIGURED_BACKEND_ID,
                title: 'Review Bot',
                command: 'review-bot-acp',
                args: ['--stdio'],
                env: {},
                transportProfile: 'generic',
                capabilities: {
                    supportsLoadSession,
                    supportsModes: 'unknown',
                    supportsModels: 'unknown',
                    supportsConfigOptions: 'unknown',
                    promptImageSupport: 'no',
                },
                createdAt: 1,
                updatedAt: 2,
            }],
        },
    } as const;
}

async function prepareConfiguredAcpResume(params: Readonly<{
    accountSettings?: Readonly<Record<string, unknown>>;
    backendId?: string;
}>) {
    return await prepareExecuteSpawnSessionRequest({
        request: {
            options: {
                directory: '/tmp/configured-acp-resume',
                machineId: 'machine-1',
                backendTarget: {
                    kind: 'backend',
                    backendId: params.backendId ?? CONFIGURED_BACKEND_ID,
                    configuredBackendId: params.backendId ?? CONFIGURED_BACKEND_ID,
                    sourceKind: 'configured',
                },
                resume: PROVIDER_SESSION_ID,
                approvedNewDirectoryCreation: true,
            },
            ...(params.accountSettings ? { accountSettings: params.accountSettings } : {}),
            credentials: { token: 'token', encryption: null },
        },
        validateEnvVarRecordStrict: () => ({ ok: true, env: {} }),
    });
}

describe('prepareExecuteSpawnSessionRequest Account-configured ACP resume admission', () => {
    it('admits native resume when the resolved Account declaration proves load-session support', async () => {
        const result = await prepareConfiguredAcpResume({
            accountSettings: accountSettingsWithConfiguredBackend(true),
        });

        expect(result).toMatchObject({
            effectiveResume: PROVIDER_SESSION_ID,
            catalogAgentId: null,
            effectiveBackendTargetV2: expect.objectContaining({
                sourceKind: 'configured',
                backendId: CONFIGURED_BACKEND_ID,
            }),
        });
    });

    it('refuses native resume when the Account declaration does not prove load-session support', async () => {
        const result = await prepareConfiguredAcpResume({
            accountSettings: accountSettingsWithConfiguredBackend(false),
        });

        expect(result).toEqual({
            type: 'error',
            errorCode: SPAWN_SESSION_ERROR_CODES.RESUME_NOT_SUPPORTED,
            errorMessage: `Resume is not supported for configured ACP backend '${CONFIGURED_BACKEND_ID}'.`,
        });
    });

    it('fails closed when the configured backend is absent from the admitted Account snapshot', async () => {
        const result = await prepareConfiguredAcpResume({});

        expect(result).toEqual({
            type: 'error',
            errorCode: SPAWN_SESSION_ERROR_CODES.RESUME_NOT_SUPPORTED,
            errorMessage: `Resume is not supported for configured ACP backend '${CONFIGURED_BACKEND_ID}'.`,
        });
    });

    it('never consults the built-in Agent vendor-resume owner for a configured backend', async () => {
        const catalogHooks = await import('@/session/runtime/catalogHooks');
        const getVendorResumeSupport = vi.spyOn(catalogHooks, 'getVendorResumeSupport');

        await prepareConfiguredAcpResume({
            accountSettings: accountSettingsWithConfiguredBackend(true),
        });

        expect(getVendorResumeSupport).not.toHaveBeenCalled();
        getVendorResumeSupport.mockRestore();
    });
});
