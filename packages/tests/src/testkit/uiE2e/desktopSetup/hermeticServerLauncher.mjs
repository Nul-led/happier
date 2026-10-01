// @ts-check
/**
 * The `happier-server` binary of the hermetic desktop computer's release-shaped server payload
 * (`hermeticDesktopComputer.ts`). The desktop's relay-runtime owner installs that payload as the
 * Personal Home runtime and starts it under the (test double) systemd user manager exactly as it
 * starts a downloaded release; this launcher is what that service runs.
 *
 * A packaged server is a Bun binary that migrates its SQLite database itself on start
 * (`applyPackagedLightRuntimeSqliteDefaults` + `bun:sqlite`). The server built from this checkout
 * runs on Node here, where that migrator is unavailable, so the one thing this launcher does
 * besides starting the source entry is give a Home without a database the already-migrated schema
 * of the run's server-light template (the same migrations, applied once by the testkit). It never
 * touches an existing database, decides nothing about the Home, and passes every argument and the
 * service environment through unchanged.
 *
 * argv: <tsx import hook> <server source entry> [server args...]
 * env:  HERMETIC_SERVER_TEMPLATE_DIR  the migrated template data dir staged for this computer
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [tsxHook, entry, ...serverArgs] = process.argv.slice(2);
if (!tsxHook || !entry) {
    process.stderr.write('hermetic server launcher: usage <tsx hook> <entry> [args...]\n');
    process.exit(64);
}

/** The server's own rule (`resolveLightSqliteDatabaseUrl`): DATABASE_URL, else `<dataDir>/happier-server-light.sqlite`. */
function resolveDatabasePath() {
    const url = String(process.env.DATABASE_URL ?? '').trim();
    if (url.startsWith('file:')) {
        const withoutQuery = url.split('?')[0] ?? url;
        try {
            return fileURLToPath(new URL(withoutQuery));
        } catch {
            return withoutQuery.slice('file:'.length);
        }
    }
    const dataDir = String(process.env.HAPPIER_SERVER_LIGHT_DATA_DIR ?? process.env.HAPPY_SERVER_LIGHT_DATA_DIR ?? '').trim();
    return dataDir ? join(dataDir, 'happier-server-light.sqlite') : '';
}

function seedDatabaseFromTemplate() {
    const databasePath = resolveDatabasePath();
    const templateDir = String(process.env.HERMETIC_SERVER_TEMPLATE_DIR ?? '').trim();
    if (!databasePath || existsSync(databasePath)) return;
    if (!templateDir || !existsSync(join(templateDir, 'happier-server-light.sqlite'))) {
        process.stderr.write(`hermetic server launcher: no migrated template at ${templateDir || '<unset>'}\n`);
        process.exit(70);
    }
    mkdirSync(dirname(databasePath), { recursive: true });
    for (const name of readdirSync(templateDir)) {
        if (!name.startsWith('happier-server-light.sqlite')) continue;
        copyFileSync(join(templateDir, name), join(dirname(databasePath), name.replace('happier-server-light.sqlite', databasePath.split('/').pop() ?? name)));
    }
}

seedDatabaseFromTemplate();
if (serverArgs.includes('--migrate-only')) {
    // The schema is the template's; there is nothing left to migrate.
    process.exit(0);
}

const child = spawn(process.execPath, ['--import', tsxHook, entry, ...serverArgs], {
    stdio: 'inherit',
    env: { ...process.env, HAPPIER_SQLITE_AUTO_MIGRATE: '0', HAPPY_SQLITE_AUTO_MIGRATE: '0' },
});
for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP'])) {
    process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 128 + 15 : 1));
});
