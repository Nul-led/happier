import { Platform } from 'react-native';

import { desktopHostKind } from '@/utils/platform/desktopHost';

import { createSystemTaskBridge } from './createSystemTaskBridge';
import { createSystemTaskRunner } from './createSystemTaskRunner';
import type { SystemTaskRunner, SystemTaskRunnerMode } from './types';
import { resolveSystemTaskRunnerMode } from './systemTaskRunnerMode';

let sharedRunner: SystemTaskRunner | null = null;

function resolveRunnerMode(): SystemTaskRunnerMode {
    return resolveSystemTaskRunnerMode({
        explicitMode: String(process.env.EXPO_PUBLIC_SYSTEM_TASKS_RUNNER_MODE ?? ''),
        desktopHostKind: desktopHostKind(),
        nodeEnv: process.env.NODE_ENV,
        platformOS: String(Platform.OS ?? ''),
    });
}

export function getSystemTasksRunner(): SystemTaskRunner {
    if (sharedRunner) {
        return sharedRunner;
    }

    const mode = resolveRunnerMode();
    const bridge = createSystemTaskBridge({
        mode,
    });
    sharedRunner = createSystemTaskRunner({ bridge, mode });
    return sharedRunner;
}
