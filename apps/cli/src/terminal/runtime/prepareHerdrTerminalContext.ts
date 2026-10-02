import { admitHerdrServer } from '@/integrations/herdr/adapter';
import { createHerdrClient } from '@/integrations/herdr/client';
import { HERDR_ACTION_TIMEOUT_MS, HERDR_STARTUP_TIMEOUT_MS, resolveHerdrRuntimeBinary } from '@/integrations/herdr/runtimeBinary';
import { TerminalHostCreationError, TerminalHostStartupError } from '@/integrations/terminal/host/errors';
import { readTerminalHostAttachmentState } from '@/terminal/attachment/terminalAttachmentInfo';

/** Endpoint selection is distinct from later exact attachment adoption. */
export async function resolveHerdrTerminalContext(params: Readonly<{
    happyHomeDir: string;
    sessionName: string;
    socketPath?: string;
    existingSessionId?: string;
}>): Promise<Readonly<{ sessionName: string; socketPath?: string }> | null> {
    if (params.existingSessionId) {
        const state = await readTerminalHostAttachmentState({ happyHomeDir: params.happyHomeDir, sessionId: params.existingSessionId });
        if (state.status === 'unreadable') return null;
        if (state.status === 'present' && state.info.handle.kind === 'herdr') {
            return { sessionName: state.info.handle.sessionName, socketPath: state.info.handle.socketPath };
        }
    }
    return { sessionName: params.sessionName, ...(params.socketPath ? { socketPath: params.socketPath } : {}) };
}

/** Capture the terminal owner's endpoint before provider authentication changes child environment. */
export async function prepareHerdrTerminalContext(params: Parameters<typeof resolveHerdrTerminalContext>[0] & Readonly<{
    processEnv: NodeJS.ProcessEnv;
}>): Promise<Readonly<{ sessionName: string; socketPath: string }>> {
    const context = await resolveHerdrTerminalContext(params);
    if (!context) throw new TerminalHostCreationError([], 'Retained Herdr endpoint cannot be verified', {
        creationDisposition: 'not_created', cleanupIncomplete: false,
    });
    const binary = await resolveHerdrRuntimeBinary({ actionTimeoutMs: HERDR_ACTION_TIMEOUT_MS, processEnv: params.processEnv });
    if (!binary) throw new TerminalHostStartupError({ hostKind: 'herdr', reason: 'installation_unavailable',
        message: 'Herdr installation is unavailable', creationFailure: {
            creationDisposition: 'not_created', cleanupIncomplete: false,
        },
    });
    const socketPath = await admitHerdrServer(createHerdrClient({ binary, ...context, processEnv: params.processEnv,
        actionTimeoutMs: HERDR_ACTION_TIMEOUT_MS, startupTimeoutMs: HERDR_STARTUP_TIMEOUT_MS }));
    return { sessionName: context.sessionName, socketPath };
}
