import 'reflect-metadata';
import 'dotenv/config';

import { initializeServerSentry } from '@/app/monitoring/sentry';
import {
    applyLightDefaultEnv,
    applyPackagedLightRuntimeSqliteDefaults,
    loadExistingHandyMasterSecret,
    resolveLightDataDir,
} from '@/flavors/light/env';
import { applySqliteMigrationsFromEnvironment } from '@/flavors/light/sqliteMigrations';
import { registerProcessHandlers } from '@/utils/process/processHandlers';

function readPositiveSafeIntegerArgument(argv: readonly string[], name: string): number | null {
    const prefix = `${name}=`;
    const direct = argv.find((argument) => argument.startsWith(prefix));
    const value = direct
        ? direct.slice(prefix.length)
        : (() => {
            const index = argv.indexOf(name);
            return index < 0 ? '' : String(argv[index + 1] ?? '');
        })();
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed < Number.MAX_SAFE_INTEGER ? parsed : null;
}

export async function runLightServerMain(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    process.env.HAPPY_SERVER_FLAVOR = 'light';
    process.env.HAPPIER_SERVER_FLAVOR = 'light';

    if (argv.includes('--attest-personal-home-readiness')) {
        applyLightDefaultEnv(process.env);
        applyPackagedLightRuntimeSqliteDefaults(process.env);
        await loadExistingHandyMasterSecret(process.env);
        const [
            { auth },
            { createPersonalHomeAuthenticatedReadiness },
            { initDbSqlite, shutdownDbClient },
        ] = await Promise.all([
            import('@/app/auth/auth'),
            import('@/app/runtime/personalHomeReadiness'),
            import('@/storage/db'),
        ]);
        await initDbSqlite();
        const readiness = await (async () => {
            await auth.init();
            return await createPersonalHomeAuthenticatedReadiness(process.env);
        })().finally(async () => {
            await shutdownDbClient();
        });
        if (!readiness) {
            throw new Error('Personal Home authenticated readiness requires an initialized Account');
        }
        process.stdout.write(`${JSON.stringify(readiness)}\n`);
        return;
    }

    if (argv.includes('--materialize-iroh-endpoint-descriptor')) {
        const sourceDescriptorRevision = readPositiveSafeIntegerArgument(
            argv,
            '--source-descriptor-revision',
        );
        if (sourceDescriptorRevision === null) {
            throw new Error('--materialize-iroh-endpoint-descriptor requires a positive --source-descriptor-revision');
        }
        applyLightDefaultEnv(process.env);
        applyPackagedLightRuntimeSqliteDefaults(process.env);
        const [{ materializeHomeIrohEndpointDescriptor }, { initDbSqlite, shutdownDbClient }] = await Promise.all([
            import('@/app/iroh/homeIrohEndpoint'),
            import('@/storage/db'),
        ]);
        await initDbSqlite();
        const result = await materializeHomeIrohEndpointDescriptor({
            env: process.env,
            sourceDescriptorRevision,
        }).finally(async () => {
            await shutdownDbClient();
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
    }

    if (argv.includes('--migrate-only')) {
        applyLightDefaultEnv(process.env);
        applyPackagedLightRuntimeSqliteDefaults(process.env);
        await applySqliteMigrationsFromEnvironment({
            env: process.env,
            dataDir: resolveLightDataDir(process.env),
        });
        return;
    }

    // Initialize Sentry before importing the server runtime so auto-instrumentation can patch dependencies (Fastify, etc).
    initializeServerSentry(process.env);
    registerProcessHandlers();

    const { startServer } = await import('@/startServer');
    await startServer('light');
}
