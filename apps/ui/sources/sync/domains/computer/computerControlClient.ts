import {
    ComputerActionResultV1Schema,
    ComputerCaptureResponseV1Schema,
    ComputerControlStatusResponseV1Schema,
    ComputerOpenSettingsResponseV1Schema,
    ComputerSelectedTargetResponseV1Schema,
    ComputerTargetsListResponseV1Schema,
    type ActionExecuteResult,
    type ActionExecutorContext,
    type ActionId,
    type ComputerActionResultV1,
    type ComputerAccessV1,
    type ComputerCaptureResponseV1,
    type ComputerControlStatusResponseV1,
    type ComputerSelectedTargetResponseV1,
    type ComputerTargetsListResponseV1,
    type ComputerTargetV1,
} from '@happier-dev/protocol';
import type { z } from 'zod';

/** The Session and machine whose shared window the person is acting on. */
export type ComputerSessionScope = Readonly<{
    serverId?: string | null;
    sessionId: string;
    machineId: string;
}>;

export type ComputerActionExecute = (actionId: ActionId, input: unknown, context: ActionExecutorContext) => Promise<ActionExecuteResult>;

export type ComputerOutcome<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>;

/**
 * The person's computer controls through the one Action front door (Actions settings, the present-user
 * floor and the output schema all apply there). Each call names the Session and the machine; the payload
 * comes back parsed by the Action's own schema or as a stable failure code.
 */
export function createComputerControlClient(scope: ComputerSessionScope, execute: ComputerActionExecute) {
    const context: ActionExecutorContext = {
        surface: 'ui',
        // A person's press in Happier; the daemon route stamps the same authority and checks it again.
        authority: 'present_user',
        defaultSessionId: scope.sessionId,
        ...(scope.serverId ? { serverId: scope.serverId } : {}),
    };
    const machine = { machineId: scope.machineId };
    async function run<T>(actionId: ActionId, input: unknown, schema: z.ZodType<T>): Promise<ComputerOutcome<T>> {
        let result: ActionExecuteResult;
        try {
            result = await execute(actionId, input, context);
        } catch {
            return { ok: false, code: 'machine_unreachable' };
        }
        if (!result.ok) return { ok: false, code: result.errorCode };
        const parsed = schema.safeParse(result.result);
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'invalid_action_output' };
    }
    return {
        getTarget: () => run<ComputerSelectedTargetResponseV1>('computer.target.get', machine, ComputerSelectedTargetResponseV1Schema),
        listTargets: () => run<ComputerTargetsListResponseV1>('computer.targets.list', machine, ComputerTargetsListResponseV1Schema),
        selectTarget: (target: ComputerTargetV1, access: ComputerAccessV1 = 'use') => run<ComputerSelectedTargetResponseV1>(
            'computer.target.select', { ...machine, target, access }, ComputerSelectedTargetResponseV1Schema),
        openSettings: (permission: 'capture' | 'input') => run(
            'computer.permissions.openSettings', { ...machine, permission }, ComputerOpenSettingsResponseV1Schema),
        status: () => run<ComputerControlStatusResponseV1>('computer.control.status', machine, ComputerControlStatusResponseV1Schema),
        interrupt: () => run<ComputerActionResultV1>('computer.control.interrupt', machine, ComputerActionResultV1Schema),
        handBack: () => run<ComputerActionResultV1>('computer.control.handBack', machine, ComputerActionResultV1Schema),
        /** A fresh look at the window by the person: what confirms an unconfirmed stop. */
        observe: () => run<ComputerCaptureResponseV1>('computer.capture', machine, ComputerCaptureResponseV1Schema),
        stopSharing: () => run<ComputerActionResultV1>('computer.target.close', machine, ComputerActionResultV1Schema),
    };
}

export type ComputerControlClient = ReturnType<typeof createComputerControlClient>;
