import { storage } from '@/sync/domains/state/storage';
import {
    resolveWorkspaceTargetForSessionFromState,
    type WorkspaceTargetForSession,
} from './resolveWorkspaceTargetForSessionFromState';
import type { ExactSessionMachineTargetIdentity } from './resolveMachineTargetForSessionFromState';

export type { WorkspaceTargetForSession };

export function resolveWorkspaceTargetForSession(
    session: string | ExactSessionMachineTargetIdentity,
): WorkspaceTargetForSession | null {
    return resolveWorkspaceTargetForSessionFromState(storage.getState(), session);
}
