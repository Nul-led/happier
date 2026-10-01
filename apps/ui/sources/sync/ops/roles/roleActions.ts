import type {
    ActionExecuteResult,
    RoleArtifactV1,
    RoleInstructionsOverrideV1,
    RoleOverrideV1,
} from '@happier-dev/protocol';

import { createFrontDoorActionExecute } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';

/**
 * Role writes from the product UI. Every write is the canonical Action on the one front door
 * (§3.5): policy, approval and the Artifact CAS belong to the Action host, never to this module.
 */
let execute: ReturnType<typeof createFrontDoorActionExecute> | null = null;

function run(actionId: Parameters<ReturnType<typeof createFrontDoorActionExecute>>[0], input: unknown): Promise<ActionExecuteResult> {
    execute ??= createFrontDoorActionExecute();
    return execute(actionId, input, { surface: 'ui' });
}

export type RoleArtifactRevision = Readonly<{ headerVersion: number; bodyVersion: number }>;

export const roleActions = {
    setApprovalReviewer: (sessionId: string, enabled: boolean) => run('session.approval_reviewer.set', { sessionId, enabled }),
    create: (role: RoleArtifactV1) => run('roles.create', { role }),
    update: (roleId: string, role: RoleArtifactV1, expectedRevision: RoleArtifactRevision) =>
        run('roles.update', { roleId, role, expectedRevision }),
    remove: (roleId: string, expectedRevision: RoleArtifactRevision) => run('roles.delete', { roleId, expectedRevision }),
    setOverride: (override: RoleInstructionsOverrideV1) => run('roles.override.set', override),
    resetOverride: (roleId: string) => run('roles.override.reset', { roleId }),
    setSessionRole: (sessionId: string, roleId: string) => run('session.role.set', { sessionId, roleId }),
    setSessionOverride: (sessionId: string, override: RoleOverrideV1) =>
        run('session.roles.override.set', { ...override, sessionId }),
    clearSessionOverride: (sessionId: string, roleId: string) => run('session.roles.override.clear', { sessionId, roleId }),
    addSessionRole: (sessionId: string, roleId: string, role: RoleArtifactV1) =>
        run('session.roles.add', { sessionId, roleId, role }),
    removeSessionRole: (sessionId: string, roleId: string) => run('session.roles.remove', { sessionId, roleId }),
    setSessionNotes: (sessionId: string, notes: string) => run('session.notes.set', { sessionId, notes }),
    applyToReports: (sessionId: string) => run('session.roles.apply_to_reports', { sessionId }),
};
