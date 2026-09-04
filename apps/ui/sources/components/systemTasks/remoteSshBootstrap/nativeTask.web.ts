import type { NativeSshTaskCredentials } from '../bridges/native';
import type { RunNativeRemoteSshBootstrapTaskParams } from './nativeTask';

function nativeSshUnavailable(): Error {
    return new Error('native_ssh_engine_unavailable');
}

export function readNativeSshTaskCredentials(_spec: Readonly<{
    kind: string;
    params: unknown;
}>): NativeSshTaskCredentials {
    throw nativeSshUnavailable();
}

export async function runNativeRemoteSshBootstrapTask(
    _params: RunNativeRemoteSshBootstrapTaskParams,
): Promise<never> {
    throw nativeSshUnavailable();
}
