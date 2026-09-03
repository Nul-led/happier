import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePersonalHomeRuntimeLayout } from '@happier-dev/cli-common/firstPartyRuntime';
import {
    createStartServerDbMocks,
    installStartServerCommonWiringMocks,
    installStartServerDbModuleMock,
} from '@/testkit/startServerMocks';
import { createStartServerHarness } from '@/testkit/startServerHarness';

const startServerDbMocks = createStartServerDbMocks({
    getDbProviderFromEnv: () => 'sqlite',
});
installStartServerDbModuleMock(startServerDbMocks);
installStartServerCommonWiringMocks();

const applySqliteMigrationsIfNeeded = vi.fn(async () => {});
vi.mock('@/flavors/light/sqliteMigrations', async () => {
    const actual = await vi.importActual<typeof import('@/flavors/light/sqliteMigrations')>('@/flavors/light/sqliteMigrations');
    return { ...actual, applySqliteMigrationsIfNeeded };
});

vi.mock('@/storage/redis/redis', () => ({
    getRedisClient: () => ({ ping: vi.fn(async () => 'PONG') }),
}));
vi.mock('@/app/events/createRedisStreamsRoomEmitter', () => ({
    createRedisStreamsRoomEmitter: vi.fn(() => ({})),
}));
vi.mock('@/app/events/eventRouter', () => ({
    eventRouter: { setIo: vi.fn() },
}));
vi.mock('@/utils/process/shutdown', async () => {
    const actual = await vi.importActual<typeof import('@/utils/process/shutdown')>('@/utils/process/shutdown');
    return { ...actual, awaitShutdown: vi.fn(async () => {}) };
});

const roots: string[] = [];

async function createDataDir(): Promise<string> {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-server-boot-admission-'));
    roots.push(homeDir);
    return resolvePersonalHomeRuntimeLayout({ homeDir, platform: 'linux', mode: 'user' }).dataDir;
}

async function writePreparedRestoreJournal(dataDir: string): Promise<void> {
    const env = { HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir };
    const layout = resolvePersonalHomeRuntimeLayout({ env, platform: 'linux', mode: 'user' });
    const id = '11111111-1111-4111-8111-111111111111';
    const stage = `${layout.dataDir}.restore-stage-${process.pid}-${id}`;
    await mkdir(join(dataDir, '.operations'), { recursive: true, mode: 0o700 });
    await writeFile(join(dataDir, '.operations', 'restore-journal.json'), `${JSON.stringify({
        version: 2,
        phase: 'prepared',
        stage,
        wasRunning: false,
        entries: [
            [layout.databasePath, join(stage, 'database/home.sqlite')],
            [layout.publicFilesDir, join(stage, 'files/public')],
            [layout.privateFilesDir, join(stage, 'files/private')],
            [layout.masterSecretPath, join(stage, 'secrets/handy-master-secret.txt')],
            [layout.derivedDataDir, join(stage, 'derived')],
        ].map(([target, source]) => ({
            target,
            source,
            rollback: `${target}.restore-rollback-${id}`,
            hadTarget: false,
            state: 'untouched',
        })),
    })}\n`, { mode: 0o600 });
}

describe('startServer Personal Home boot admission', () => {
    const harness = createStartServerHarness({
        SERVER_ROLE: 'api',
        HAPPIER_DB_PROVIDER: 'sqlite',
        HAPPY_DB_PROVIDER: undefined,
        DATABASE_URL: undefined,
    });

    beforeEach(() => {
        startServerDbMocks.reset();
        applySqliteMigrationsIfNeeded.mockReset().mockImplementation(async () => {});
        harness.reset();
    });

    afterEach(async () => {
        harness.restore();
        await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    it('starts a managed Personal Home when no operation marker blocks activation', async () => {
        const dataDir = await createDataDir();

        await harness.start('light', {
            HAPPIER_MANAGED_RELAY_PURPOSE: 'personal-home',
            HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir,
        });

        expect(startServerDbMocks.initDbSqlite).toHaveBeenCalledTimes(1);
        const { startApi } = await import('@/app/api/api');
        expect(startApi).toHaveBeenCalledTimes(1);
    });

    it('blocks an interrupted restore before secret creation, migration, database open, or API listen', async () => {
        const dataDir = await createDataDir();
        await writePreparedRestoreJournal(dataDir);

        await expect(harness.start('light', {
            HAPPIER_MANAGED_RELAY_PURPOSE: 'personal-home',
            HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir,
        })).rejects.toMatchObject({
            code: 'PERSONAL_HOME_BOOT_ADMISSION_BLOCKED',
            reason: 'restore_recovery_required',
        });

        const { ensureHandyMasterSecret } = await import('@/flavors/light/env');
        const { startApi } = await import('@/app/api/api');
        expect(ensureHandyMasterSecret).not.toHaveBeenCalled();
        expect(applySqliteMigrationsIfNeeded).not.toHaveBeenCalled();
        expect(startServerDbMocks.initDbSqlite).not.toHaveBeenCalled();
        expect(startApi).not.toHaveBeenCalled();
    });

    it('does not apply Personal Home marker admission to a generic light server', async () => {
        const dataDir = await createDataDir();
        await writePreparedRestoreJournal(dataDir);

        await harness.start('light', {
            HAPPIER_MANAGED_RELAY_PURPOSE: 'generic',
            HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir,
        });

        expect(startServerDbMocks.initDbSqlite).toHaveBeenCalledTimes(1);
        const { startApi } = await import('@/app/api/api');
        expect(startApi).toHaveBeenCalledTimes(1);
    });
});
