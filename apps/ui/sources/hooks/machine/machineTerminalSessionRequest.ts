import type { DaemonTerminalEnsureRequest, DaemonTerminalLaunchIntent } from '@happier-dev/protocol';

export function buildMachineTerminalSessionRequest(input: Readonly<{
    terminalKey: string;
    cwd: string | null;
    cols?: number;
    rows?: number;
    launch?: DaemonTerminalLaunchIntent | null;
    initialCommand?: string;
}>): DaemonTerminalEnsureRequest {
    return input.launch
        ? { terminalKey: input.terminalKey, cols: input.cols, rows: input.rows, launch: input.launch,
            ...(input.launch.kind === 'package_script' ? { cwd: input.cwd ?? undefined } : {}) }
        : { terminalKey: input.terminalKey, cwd: input.cwd ?? undefined, cols: input.cols, rows: input.rows, initialCommand: input.initialCommand };
}
