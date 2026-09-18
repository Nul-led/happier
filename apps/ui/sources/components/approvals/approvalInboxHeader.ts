import { approvalArtifactBodyMatchesHeaderV1 } from '@happier-dev/protocol';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

export function isOpenApprovalInboxArtifact(artifact: DecryptedArtifact): boolean {
  const parsed = approvalArtifactBodyMatchesHeaderV1(artifact.header ?? {}, artifact.body);
  return parsed?.request.status === 'open';
}
