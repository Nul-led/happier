import type { PersonalHomeRuntimeLayout } from './layout.js';
import { withPersonalHomeOperationLock, type PersonalHomeOperationKind } from './lock.js';
import {
  assertPersonalHomeRelocationSourceAllowsActivation,
  assertPersonalHomeRelocationSourceAllowsAdministration,
  assertPersonalHomeRelocationSourceAllowsOperation,
} from './relocationCoordinator.js';
import {
  assertPersonalHomeRelocationDestinationAllowsActivation,
  assertPersonalHomeRelocationDestinationAllowsOperation,
} from './relocationDestination.js';
import { inspectPersonalHomeRestoreRecovery } from './restore.js';
import { readPersonalHomeUpdateRecoveryRecord } from './updateRecovery.js';

export type PersonalHomeOperationAdmissionTarget = Readonly<{
  layout: PersonalHomeRuntimeLayout;
  canonicalServerUrl: string | null;
  homeServerIdentityId: string | null;
}>;

export type PersonalHomeOperationAdmissionRequest =
  | Readonly<{ kind: Exclude<PersonalHomeOperationKind, 'relocate' | 'lifecycle'> }>
  | Readonly<{ kind: 'relocate'; role: 'source' | 'destination'; operationId: string }>;

export class PersonalHomeOperationAdmissionError extends Error {
  constructor(public readonly code: 'operation_recovery_required' | 'restore_recovery_required' | 'purpose_not_personal_home', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PersonalHomeOperationAdmissionError';
  }
}

/** One administrative admission boundary. Runtime adapters supply freshly validated canonical
 * layout/purpose/identity facts; this owner pins them across lock acquisition and composes the
 * existing recovery authorities. It never grants ordinary boot authority to a recovery copy. */
export async function withPersonalHomeOperationAdmission<T>(params: Readonly<{
  request: PersonalHomeOperationAdmissionRequest;
  readValidatedTarget(): Promise<PersonalHomeOperationAdmissionTarget>;
  isHomeRunning(): Promise<boolean>;
  movedToDataDir?: string;
}>, operation: (target: PersonalHomeOperationAdmissionTarget) => Promise<T>): Promise<T> {
  const initial = await params.readValidatedTarget();
  return withPersonalHomeOperationLock(initial.layout.dataDir, params.request.kind, async () => {
    const current = await params.readValidatedTarget();
    if (JSON.stringify(initial) !== JSON.stringify(current)) {
      throw new PersonalHomeOperationAdmissionError('purpose_not_personal_home', 'Personal Home identity, purpose, or canonical layout changed while waiting for the operation lease.');
    }
    const { request } = params;
    if (request.kind !== 'inspect') {
      const update = await readPersonalHomeUpdateRecoveryRecord(current.layout);
      // Even a committed record still owns cleanup. In particular, uninstall must not remove
      // the selected payload before the updater can finish its terminal reconciliation.
      if (update && request.kind !== 'upgrade') {
        throw new PersonalHomeOperationAdmissionError('operation_recovery_required', 'Personal Home runtime update recovery must complete before another operation can continue.');
      }
      try {
        if (request.kind === 'relocate' && request.role === 'source') {
          await assertPersonalHomeRelocationSourceAllowsOperation(current.layout.dataDir, request.operationId);
        } else if (['backup', 'verify_backup', 'erase', 'uninstall'].includes(request.kind)) {
          await assertPersonalHomeRelocationSourceAllowsAdministration(current.layout.dataDir, params.isHomeRunning);
        } else {
          await assertPersonalHomeRelocationSourceAllowsActivation(current.layout.dataDir);
        }
        if (request.kind === 'relocate' && request.role === 'destination') {
          await assertPersonalHomeRelocationDestinationAllowsOperation(current.layout.dataDir, request.operationId);
        } else {
          await assertPersonalHomeRelocationDestinationAllowsActivation(current.layout.dataDir);
        }
      } catch (cause) {
        throw new PersonalHomeOperationAdmissionError('operation_recovery_required', cause instanceof Error ? cause.message : 'Personal Home operation recovery is required.', { cause });
      }
      // Restore and destination relocation own their existing journal recovery. Facade operations
      // reconcile it through that owner before proceeding; raw runtime mutations must not bypass it.
      if (request.kind === 'upgrade' || request.kind === 'uninstall') {
        const restore = await inspectPersonalHomeRestoreRecovery(current.layout);
        if (restore.status !== 'none') {
          throw new PersonalHomeOperationAdmissionError('restore_recovery_required', 'Personal Home restore recovery must complete before changing the runtime.');
        }
      }
    }
    return operation(current);
  }, params.movedToDataDir ? { movedToDataDir: params.movedToDataDir } : {});
}
