import type {
    ReleasedDirectSessionShareCreateRequestV1,
    SessionAccessLevelV1,
} from '@happier-dev/protocol';
import type { ScopedRpcSessionEncryptionContext } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedRpcTypes';
import { HappyError } from '@/utils/errors/errors';
import { t } from '@/text';
import { readTransferableSessionDataKey } from './readTransferableSessionDataKey';
import { encryptDataKeyForRecipientV0, verifyRecipientContentPublicKeyBinding } from './directShareEncryption';
import { buildCreateSessionShareRequest } from '@/sync/domains/social/sharingRequests/buildCreateSessionShareRequest';

export type PrepareLegacySessionShareRequestParams = Readonly<{
    sessionEncryptionMode: 'plain' | 'e2ee';
    callerDataKeyEnvelope: string | null;
    encryption: Pick<ScopedRpcSessionEncryptionContext, 'decryptEncryptionKey'> | null;
    recipient: Readonly<{
        id: string;
        publicKey: string | null;
        contentPublicKey: string | null;
        contentPublicKeySig: string | null;
    }>;
    accessLevel: SessionAccessLevelV1;
    canApprovePermissions: boolean;
}>;

/** Released Account-only transport; its caller supplies captured Home/Account material. */
export async function prepareLegacySessionShareRequest(
    params: PrepareLegacySessionShareRequestParams,
): Promise<ReleasedDirectSessionShareCreateRequestV1> {
    let encryptedDataKey: string | undefined;
    if (params.sessionEncryptionMode === 'e2ee') {
        const recipient = params.recipient;
        if (!recipient.publicKey || !recipient.contentPublicKey || !recipient.contentPublicKeySig) {
            throw new HappyError(t('session.sharing.recipientMissingKeys'), false, { code: 'recipient_missing_keys' });
        }
        if (!verifyRecipientContentPublicKeyBinding({
            signingPublicKeyHex: recipient.publicKey,
            contentPublicKeyB64: recipient.contentPublicKey,
            contentPublicKeySigB64: recipient.contentPublicKeySig,
        })) {
            throw new HappyError(t('errors.operationFailed'), false, { code: 'invalid_recipient_binding' });
        }
        const key = await readTransferableSessionDataKey(params);
        if (!key) {
            throw new HappyError(t('errors.sessionNotFound'), false, { code: 'session_data_key_unavailable' });
        }
        encryptedDataKey = encryptDataKeyForRecipientV0(key, recipient.contentPublicKey);
    }
    return buildCreateSessionShareRequest({
        sessionEncryptionMode: params.sessionEncryptionMode,
        userId: params.recipient.id,
        accessLevel: params.accessLevel,
        canApprovePermissions: params.canApprovePermissions,
        ...(encryptedDataKey ? { encryptedDataKey } : {}),
    });
}
