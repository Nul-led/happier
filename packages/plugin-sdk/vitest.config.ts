import { defineConfig } from 'vitest/config';

export const PLUGIN_SDK_AUTHORED_TEST_INCLUDE = ['src/**/*.test.ts'] as const;

export default defineConfig({
    test: {
        // Package-local publishers can hold complete `.tmp.*` copies beside
        // `src` while a prepared reader runs. Only the authored source tree
        // owns this Vitest lane; copied package trees and example builds have
        // their own explicit package-boundary tests.
        include: [...PLUGIN_SDK_AUTHORED_TEST_INCLUDE],
        exclude: ['src/declarationClosureIdentity.test.ts'],
        // Several authored suites construct complete TypeScript programs or
        // run real bundlers. Parallel files multiply those subprocesses until
        // their bounded commands time out and Vitest's worker RPC stalls.
        fileParallelism: false,
    },
});
