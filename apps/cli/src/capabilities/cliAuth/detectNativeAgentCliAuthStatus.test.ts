import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNativeAgentCliAuthSpec } from '@/plugins/projection/registry/agentCliMetadata';
import { applyEnvValues, restoreEnvValues, snapshotEnvValues } from '@/testkit/env/envSnapshot';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';
import { detectNativeAgentCliAuthStatus } from './detectNativeAgentCliAuthStatus';

const ENV_KEYS = ['HOME', 'USERPROFILE', 'HAPPIER_HOME_DIR', 'CODEX_HOME', 'CODEX_API_KEY', 'OPENAI_API_KEY'] as const;

describe('native Agent auth probe admission', () => {
    let home: string;
    let baseline: ReturnType<typeof snapshotEnvValues>;

    beforeEach(() => {
        baseline = snapshotEnvValues(ENV_KEYS);
        home = createTempDirSync('happier-native-auth-admission-');
        applyEnvValues({
            HOME: home,
            USERPROFILE: home,
            HAPPIER_HOME_DIR: home,
            CODEX_HOME: home,
            CODEX_API_KEY: 'fixture-api-key',
            OPENAI_API_KEY: undefined,
        });
    });

    afterEach(() => {
        restoreEnvValues(baseline);
        removeTempDirSync(home);
    });

    function readRealSpec() {
        // Exercise the real host manifest projection without requiring unrelated
        // bundled-plugin publication in a credential-admission fixture.
        return createNativeAgentCliAuthSpec({
            executable: { binaryName: 'codex', sourcePreference: 'system-first' },
            install: { managed: null, manual: { kind: 'none' } },
            auth: { support: 'status_only', environmentVariables: ['CODEX_API_KEY', 'OPENAI_API_KEY'], loginLaunches: [] },
        });
    }

    it('does not admit a probe declared unsafe for background checks', async () => {
        // Change only the manifest-derived admission fact; retain the real native
        // probe/parser and isolated filesystem/environment, not an internal mock.
        const spec = await readRealSpec();
        const status = await detectNativeAgentCliAuthStatus({
            agentId: 'codex',
            resolvedPath: 'unused-for-api-key-auth',
            authSpec: { ...spec, isSafeForBackgroundChecks: false },
        });
        expect(status).toBeNull();
    });

    it('reports missing credentials from the effective launch environment without changing ambient auth', async () => {
        const launchContext = {
            agentId: 'codex',
            resolvedPath: 'unused-for-api-key-auth',
            authSpec: await readRealSpec(),
            processEnv: { ...process.env, CODEX_API_KEY: undefined },
        };
        const status = await detectNativeAgentCliAuthStatus(launchContext);
        expect(status?.state).toBe('logged_out');
        expect(process.env.CODEX_API_KEY).toBe('fixture-api-key');
    });

    it('retains real native auth facts for an equivalent effective environment', async () => {
        const launchContext = {
            agentId: 'codex',
            resolvedPath: 'unused-for-api-key-auth',
            authSpec: await readRealSpec(),
            processEnv: { ...process.env },
        };
        const status = await detectNativeAgentCliAuthStatus(launchContext);
        expect(status?.state).toBe('logged_in');
    });
});
