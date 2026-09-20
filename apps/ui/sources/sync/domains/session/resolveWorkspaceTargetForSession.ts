import { storage } from '@/sync/domains/state/storage';
import {
    resolveWorkspaceTargetForSessionFromState,
    type WorkspaceTargetForSession,
} from './resolveWorkspaceTargetForSessionFromState';
import type { SessionMachineTargetIdentity } from './resolveMachineTargetForSessionFromState';

export type { WorkspaceTargetForSession };

export function resolveWorkspaceTargetForSession(
    session: SessionMachineTargetIdentity,
): WorkspaceTargetForSession | null {
    return resolveWorkspaceTargetForSessionFromState(storage.getState(), session);
}
