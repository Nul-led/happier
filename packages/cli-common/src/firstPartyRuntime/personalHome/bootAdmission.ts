import type { PersonalHomeRuntimeLayout } from './layout.js';
import { assertPersonalHomeRelocationSourceAllowsActivation } from './relocationCoordinator.js';
import {
  assertPersonalHomeRelocationDestinationAllowsActivation,
  assertPersonalHomeRelocationDestinationAllowsMaintenance,
} from './relocationDestination.js';
import { assertPersonalHomeRestoreAllowsActivation } from './restore.js';
import { readPersonalHomeUpdateRecoveryRecord } from './updateRecovery.js';

export type PersonalHomeBootAdmissionBlockReason =
  | 'restore_recovery_required'
  | 'relocation_source_blocked'
  | 'relocation_destination_blocked'
  | 'runtime_update_blocked';

export class PersonalHomeBootAdmissionError extends Error {
  readonly code = 'PERSONAL_HOME_BOOT_ADMISSION_BLOCKED';

  constructor(
    public readonly reason: PersonalHomeBootAdmissionBlockReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PersonalHomeBootAdmissionError';
  }
}

function blocked(
  reason: PersonalHomeBootAdmissionBlockReason,
  message: string,
  cause?: unknown,
): PersonalHomeBootAdmissionError {
  return new PersonalHomeBootAdmissionError(reason, message, cause === undefined ? undefined : { cause });
}

/**
 * The server-light process calls this before opening any writable Personal Home
 * resource. Operation owners remain the sole parsers and phase authorities; this
 * function only composes their activation decisions at the direct-start boundary.
 */
export async function assertPersonalHomeBootAdmission(
  layout: PersonalHomeRuntimeLayout,
  request: Readonly<
    | { kind: 'ordinary'; startupNonce?: string }
    | { kind: 'relocation-maintenance'; operationId: string; action: 'attest' | 'materialize_endpoint' }
  > = { kind: 'ordinary' },
): Promise<void> {
  try {
    const update = await readPersonalHomeUpdateRecoveryRecord(layout);
    if (update && update.phase !== 'committed') {
      const startupNonce = request.kind === 'ordinary' ? String(request.startupNonce ?? '').trim() : '';
      const exactCandidate = Boolean(update.expectedStartupNonce)
        && startupNonce === update.expectedStartupNonce;
      if (!exactCandidate) {
        throw new Error('This Personal Home has an unresolved runtime update. Recover or quarantine the update before starting it.');
      }
    }
  } catch (error) {
    if (error instanceof PersonalHomeBootAdmissionError) throw error;
    throw blocked(
      'runtime_update_blocked',
      error instanceof Error ? error.message : 'This Personal Home runtime update requires recovery before startup.',
      error,
    );
  }

  try {
    await assertPersonalHomeRestoreAllowsActivation(layout);
  } catch (error) {
    throw blocked(
      'restore_recovery_required',
      error instanceof Error
        ? error.message
        : 'This Personal Home restore state is unreadable. Recover the restore before starting it.',
      error,
    );
  }

  try {
    await assertPersonalHomeRelocationSourceAllowsActivation(layout.dataDir);
  } catch (error) {
    throw blocked(
      'relocation_source_blocked',
      error instanceof Error
        ? error.message
        : 'This Personal Home is a stopped relocation source. Finish or recover the move before starting it.',
      error,
    );
  }

  try {
    if (request.kind === 'relocation-maintenance') {
      await assertPersonalHomeRelocationDestinationAllowsMaintenance(layout.dataDir, {
        operationId: request.operationId,
        action: request.action,
      });
    } else {
      await assertPersonalHomeRelocationDestinationAllowsActivation(layout.dataDir);
    }
  } catch (error) {
    throw blocked(
      'relocation_destination_blocked',
      error instanceof Error
        ? error.message
        : 'This Personal Home is a staged relocation destination. Finish or abort the move before starting it.',
      error,
    );
  }
}
