import { configDefaults, defineConfig } from 'vitest/config'
import type { Alias } from 'vite'
import { realpathSync } from 'node:fs'
import { join, resolve as resolvePath, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { resolveVitestFeatureTestExcludeGlobs } from '../../scripts/testing/featureTestGating'
import {
    workspacePackageOptimizationExcludes,
    workspacePackageSourcesPlugin,
} from './scripts/vitestWorkspacePackageResolution'

const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const resolve = (...paths: string[]) => resolvePath(packageRoot, ...paths)

const testEnv = dotenv.config({
    path: resolve('.env.integration-test')
}).parsed

const mergedTestEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...testEnv,
};

if (mergedTestEnv.HAPPIER_SERVER_URL && !mergedTestEnv.HAPPIER_WEBAPP_URL) {
    mergedTestEnv.HAPPIER_WEBAPP_URL = mergedTestEnv.HAPPIER_SERVER_URL;
}

// CLI tests should not inherit embedded build-policy gating (set in CI).
// Clear it by default so feature tests can opt-in explicitly per case.
mergedTestEnv.HAPPIER_FEATURE_POLICY_ENV = '';

// Claude's own `CLAUDE_CONFIG_DIR` outranks Happier's `HAPPIER_CLAUDE_CONFIG_DIR`
// in the Agent's config-root resolver. A developer or agent session that exports
// it would silently redirect every External Sessions source validation to that
// ambient root and fail tests that stub only the Happier variable. Clear it so a
// case that needs a config root sets one explicitly.
mergedTestEnv.CLAUDE_CONFIG_DIR = '';

const cliSourceRoot = resolve('./src')
const uiSourceRoot = resolve('../ui/sources')

// `@/…` is a package-relative source alias that the CLI and the UI both declare. A few CLI tests
// compose real UI source across an explicit package seam (the Agent-realtime Voice service), and
// that source resolves `@/…` against the UI package. Pick the root from the importing file so a
// single alias stays correct for both sides instead of giving either package a second alias.
const packageSourceAlias: Alias = {
    find: /^@\//u,
    replacement: '@/',
    async customResolver(id, importer, options) {
        const importerPath = importer?.split('?')[0];
        const root = importerPath?.startsWith(`${uiSourceRoot}${sep}`)
            ? uiSourceRoot
            : cliSourceRoot;
        const target = join(root, id.slice('@/'.length));
        const resolved = await this.resolve(target, importer, { skipSelf: true, ...options });
        return resolved ?? { id: target };
    },
}

export default defineConfig({
    test: {
        // Keep per-file module isolation so cross-file mocks/env mutations cannot leak.
        // This matches our integration suite configuration and prevents order-dependent failures.
        isolate: true,
        // Multiple CLI unit tests mutate `process.env.HAPPIER_HOME_DIR` / config at runtime.
        // Running them in isolated forked processes prevents cross-file env races.
        pool: 'forks',
        maxWorkers: 6,
        globals: false,
        environment: 'node',
        // CLI "unit" tests include real filesystem/process work; 5s default is too tight under fork pools.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        setupFiles: ['./src/vitestSetup.ts'],
        include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        exclude: [
            ...configDefaults.exclude,
            '**/*.slow.test.ts',
            '**/*.integration.test.ts',
            '**/*.real.integration.test.ts',
            '**/*.integration.spec.ts',
            '**/*.e2e.test.ts',
            ...resolveVitestFeatureTestExcludeGlobs(process.env),
        ],
        globalSetup: ['./src/test-setup.unit.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                '**/*.config.*',
                '**/mockData/**',
            ],
        },
        env: {
            ...mergedTestEnv,
        }
    },
    optimizeDeps: {
        exclude: workspacePackageOptimizationExcludes,
    },
    resolve: {
        alias: [
            packageSourceAlias,
            { find: /^react$/u, replacement: resolve('../ui/node_modules/react/index.js') },
            { find: /^react\/jsx-runtime$/u, replacement: resolve('../ui/node_modules/react/jsx-runtime.js') },
            { find: /^react\/jsx-dev-runtime$/u, replacement: resolve('../ui/node_modules/react/jsx-dev-runtime.js') },
            { find: /^react-dom\/client$/u, replacement: resolve('../ui/node_modules/react-dom/client.js') },
            { find: /^react-dom$/u, replacement: resolve('../ui/node_modules/react-dom/index.js') },
            { find: /^react-native$/u, replacement: resolve('../ui/node_modules/react-native-web/dist/index.js') },
        ],
        dedupe: ['react', 'react-dom'],
    },
    server: {
        fs: {
            allow: [resolve('../..'), realpathSync(tmpdir())],
        },
    },
    plugins: [workspacePackageSourcesPlugin],
})
