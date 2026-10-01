import { execFileWithDeadline } from '@happier-dev/cli-common/process';

import { killProcessTree } from '@/agent/runtime/process/killProcessTree';

/** Installer commands share the daemon's existing process-tree cancellation owner. */
export const executeInstallCommand: typeof execFileWithDeadline = (command, args, options = {}) =>
    execFileWithDeadline(command, args, {
        ...options,
        terminateOnAbort: (child) => killProcessTree(child),
    });
