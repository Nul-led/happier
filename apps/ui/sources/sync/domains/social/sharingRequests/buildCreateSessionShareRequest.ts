import type {
    ReleasedDirectSessionShareCreateRequestV1,
    SessionAccessLevelV1,
} from '@happier-dev/protocol';

export function buildCreateSessionShareRequest(params: {
    sessionEncryptionMode: 'e2ee' | 'plain' | undefined;
    userId: string;
    accessLevel: SessionAccessLevelV1;
    canApprovePermissions?: boolean;
    encryptedDataKey?: string;
}): ReleasedDirectSessionShareCreateRequestV1 {
    const { sessionEncryptionMode, userId, accessLevel, canApprovePermissions } = params;

    const base: ReleasedDirectSessionShareCreateRequestV1 = {
        userId,
        accessLevel,
        ...(canApprovePermissions !== undefined ? { canApprovePermissions } : {}),
    };

    if (sessionEncryptionMode === 'plain') {
        return base;
    }

    const encryptedDataKey = params.encryptedDataKey;
    if (typeof encryptedDataKey !== 'string' || encryptedDataKey.length === 0) {
        throw new Error('encryptedDataKey required');
    }
    return { ...base, encryptedDataKey };
}
