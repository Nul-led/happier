import * as React from 'react';

import {
    readTokenOnlyAuthRequestPrompt,
    respondToTokenOnlyAuthRequestPrompt,
    type SystemTaskAuthRequestApproval,
    type SystemTaskUnmanagedCliDecision,
} from './approveSystemTaskAuthRequestPrompt';
import { presentUnmanagedCliConsent } from './presentUnmanagedCliConsent';
import type { SystemTaskRunner } from './types';

/**
 * The one desktop owner that answers blocking token-only pairing prompts raised by a local
 * system task (`setup.thisComputer.v1`, `setup.repairThisComputer.v1`). The prompt's target
 * identity is validated against the expected Home before any credential is read, and the answer
 * itself never carries credential material.
 *
 * The confirmation for a CLI the managed install path did not place is wired here rather than by
 * each caller, so every consumer of this owner — the onboarding checklist step, the Personal Home
 * bootstrap runtime, local daemon control and the relay-drift banner — inherits the same single
 * question instead of each deciding whether a human may be asked.
 *
 * The three-argument runner subscription replays already-recorded events, so a prompt emitted
 * between `runner.start()` and this subscription is still delivered here; the signature set keeps
 * handling exactly-once across replays. Without an `approval` target no prompt is answered — a
 * caller that starts a pairing-capable task must supply one, or the task waits forever.
 */
export function useSystemTaskAuthRequestApproval(params: Readonly<{
    runner: SystemTaskRunner;
    taskId: string | null;
    approval?: SystemTaskAuthRequestApproval;
    /** Overrides the shared confirmation presenter; every 0.3 surface has a modal host. */
    confirmUnmanagedCli?: (decision: SystemTaskUnmanagedCliDecision) => Promise<boolean>;
}>): void {
    const { runner, taskId } = params;
    const expectedRelayUrl = params.approval?.expectedRelayUrl;
    const approvalServerId = params.approval?.serverId;
    const handledPromptSignaturesRef = React.useRef(new Set<string>());
    // Read through a ref so a caller passing an inline presenter does not resubscribe the runner
    // on every render, and so the value used is the one current when a prompt actually arrives.
    const confirmUnmanagedCliRef = React.useRef(params.confirmUnmanagedCli);
    confirmUnmanagedCliRef.current = params.confirmUnmanagedCli;

    React.useEffect(() => {
        if (!taskId || !expectedRelayUrl) {
            return;
        }
        const handled = handledPromptSignaturesRef.current;
        return runner.subscribe(
            taskId,
            (event) => {
                const prompt = readTokenOnlyAuthRequestPrompt(event);
                if (!prompt) {
                    return;
                }
                const signature = `${event.taskId}:${event.tsMs}:${prompt.publicKey}:${prompt.response}`;
                if (handled.has(signature)) {
                    return;
                }
                handled.add(signature);
                void respondToTokenOnlyAuthRequestPrompt({
                    prompt,
                    approval: {
                        expectedRelayUrl,
                        ...(approvalServerId ? { serverId: approvalServerId } : {}),
                    },
                    confirmUnmanagedCli: confirmUnmanagedCliRef.current ?? presentUnmanagedCliConsent,
                    respond: (answer) => runner.respond(taskId, answer),
                });
            },
            () => {},
        );
    }, [approvalServerId, expectedRelayUrl, runner, taskId]);
}
