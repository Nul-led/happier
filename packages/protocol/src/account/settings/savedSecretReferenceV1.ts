export const SHARED_SAVED_SECRET_REF_V1_PREFIX = 'happier:shared-secret:v1:';

export type SavedSecretRefV1 =
  | Readonly<{ kind: 'personal'; personalId: string }>
  | Readonly<{ kind: 'shared_resource'; resourceId: string }>;

export const SAVED_SECRET_REF_MAX_LENGTH_V1 = 256;

function assertSharedSavedSecretResourceIdV1(resourceId: unknown): asserts resourceId is string {
  if (
    typeof resourceId !== 'string'
    || resourceId.length === 0
    || resourceId.trim() !== resourceId
    || /[\u0000-\u001f\u007f]/u.test(resourceId)
    || SHARED_SAVED_SECRET_REF_V1_PREFIX.length + resourceId.length
      > SAVED_SECRET_REF_MAX_LENGTH_V1
  ) {
    throw new Error('Shared SavedSecret resource id is invalid');
  }
}

export function parseSavedSecretRefV1(value: string): SavedSecretRefV1 {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('SavedSecret reference is invalid');
  }
  if (!value.startsWith(SHARED_SAVED_SECRET_REF_V1_PREFIX)) {
    // Personal ids predate the shared namespace and deliberately remain
    // opaque here. Collision migration happens before shared activation; the
    // pure codec must not retroactively narrow valid legacy personal ids.
    return Object.freeze({ kind: 'personal', personalId: value });
  }
  const resourceId = value.slice(SHARED_SAVED_SECRET_REF_V1_PREFIX.length);
  assertSharedSavedSecretResourceIdV1(resourceId);
  return Object.freeze({ kind: 'shared_resource', resourceId });
}

export function formatSharedSavedSecretRefV1(resourceId: string): string {
  assertSharedSavedSecretResourceIdV1(resourceId);
  return `${SHARED_SAVED_SECRET_REF_V1_PREFIX}${resourceId}`;
}
