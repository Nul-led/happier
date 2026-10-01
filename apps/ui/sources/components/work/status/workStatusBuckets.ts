import { HAPPIER_WORK_STATUS_BUCKETS } from '@happier-dev/plugin-ui/presentation';

import { t } from '@/text';

import type { WorkStatusBucket } from './resolveWorkStatusTone';

/**
 * The shared status buckets in reading order: the columns of By status and the groups of every status
 * list. The order is owned by the shared Work presentation plugin authors use.
 */
export const WORK_STATUS_BUCKETS: readonly WorkStatusBucket[] = HAPPIER_WORK_STATUS_BUCKETS;

/** The one label for a status bucket (Needs you · Working · Finished · Idle · Offline). */
export function describeWorkStatusBucket(bucket: WorkStatusBucket): string {
    return t(`workStatus.buckets.${bucket}`);
}
