import { CLI_ACQUISITION_PROGRESS_EVENT, type CliAcquisitionProgress } from '@happier-dev/protocol';
import type { InteractiveSystemTaskEventInput } from '@happier-dev/cli-common/systemTasks';

/** Projects acquisition producer facts onto the existing local task stream. */
export function reportCliAcquisitionProgress(emit: (event: InteractiveSystemTaskEventInput) => void) {
  return (progress: CliAcquisitionProgress): void => emit({
    type: CLI_ACQUISITION_PROGRESS_EVENT,
    stepId: 'setup.thisComputer.ensureCli',
    data: progress,
  });
}
