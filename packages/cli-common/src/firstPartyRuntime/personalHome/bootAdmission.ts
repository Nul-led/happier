import type { PersonalHomeRuntimeLayout } from './layout.js';
import { assertPersonalHomeRelocationSourceAllowsActivation } from './relocationCoordinator.js';
import { assertPersonalHomeRelocationDestinationAllowsActivation } from './relocationDestination.js';
import { assertPersonalHomeRestoreAllowsActivation } from './restore.js';

export type PersonalHomeBootAdmissionBlockReason =
  | 'restore_recovery_required'
  | 'relocation_source_blocked'
  | 'relocation_destination_blocked';

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
): Promise<void> {
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
    await assertPersonalHomeRelocationDestinationAllowsActivation(layout.dataDir);
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
