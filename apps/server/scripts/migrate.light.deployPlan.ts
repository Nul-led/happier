import { resolveManagedServerLightPathEnvValue } from '@happier-dev/cli-common/firstPartyRuntime';

export type LightMigrateDeployPlan = {
    dataDir: string;
    prismaDeployArgs: string[];
};

export function requireLightDataDir(env: NodeJS.ProcessEnv): string {
    const raw = resolveManagedServerLightPathEnvValue(env, 'HAPPIER_SERVER_LIGHT_DATA_DIR', 'HAPPY_SERVER_LIGHT_DATA_DIR');
    if (raw.trim() === '') {
        throw new Error('Missing HAPPIER_SERVER_LIGHT_DATA_DIR/HAPPY_SERVER_LIGHT_DATA_DIR (set it or ensure applyLightDefaultEnv sets it)');
    }
    return raw.trim();
}

export function buildLightMigrateDeployPlan(env: NodeJS.ProcessEnv): LightMigrateDeployPlan {
    const dataDir = requireLightDataDir(env);
    return {
        dataDir,
        prismaDeployArgs: ['-s', 'migrate:light:deploy'],
    };
}
