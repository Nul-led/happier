import type { DesktopHostKind } from '@/utils/platform/desktopHost';
import type { SystemTaskRunnerMode } from './types';

/** Selects the existing bridge without loading native transports or the app runtime. */
export function resolveSystemTaskRunnerMode(params: Readonly<{
    explicitMode: string;
    desktopHostKind: DesktopHostKind | null;
    nodeEnv: string | undefined;
    platformOS: string;
}>): SystemTaskRunnerMode {
    const explicitMode = params.explicitMode.trim();
    if (explicitMode === 'tauri' || explicitMode === 'native' || explicitMode === 'dev' || explicitMode === 'unavailable') {
        return explicitMode;
    }
    // Both desktop shells implement the same command/event ABI through bundled hsetup.
    if (params.desktopHostKind !== null) {
        return 'tauri';
    }
    if (params.platformOS === 'ios' || params.platformOS === 'android') {
        return 'native';
    }
    if (params.nodeEnv === 'test') {
        return 'dev';
    }
    return 'unavailable';
}
