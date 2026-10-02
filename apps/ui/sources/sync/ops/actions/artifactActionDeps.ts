import { ArtifactActionInputSchemasV1, createArtifactPublicLinkActionsV1, type ArtifactPublicLinkIssuedV1, type ActionExecutorDeps } from '@happier-dev/protocol';
import { getRandomBytes } from '@/platform/cryptoRandom';
import { ArtifactQuotaExceededError } from '@/sync/api/artifacts/apiArtifacts';
import { HappyError } from '@/utils/errors/errors';
import type { LazyActionAccountContext } from './actionAccountContext';

/** Ordinary Artifact Actions use the captured Account transport and canonical sync codecs. */
export function createUiArtifactAction(account: LazyActionAccountContext, options?: Readonly<{
    onPublicLinkIssued?: (link: ArtifactPublicLinkIssuedV1) => void | Promise<void>;
}>): NonNullable<ActionExecutorDeps['artifactAction']> {
    const publicLinks = createArtifactPublicLinkActionsV1({
        read: account.readArtifactPublicLinkResource, randomBytes: getRandomBytes,
        onPublicLinkIssued: options?.onPublicLinkIssued,
        request: async ({ method, path, body, signal }) => {
            account.assertCurrent();
            const response = await account.request(path, { method, signal,
                headers: { Authorization: `Bearer ${account.credentials.token}`, 'Content-Type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            account.assertCurrent();
            if (!response.ok) throw Object.assign(new Error('public_share_request_failed'), { code: 'public_share_request_failed' });
            return await response.json();
        },
    });
    return async ({ actionId, input, signal }) => {
        try {
            account.assertCurrent();
            signal?.throwIfAborted();
            switch (actionId) {
                case 'artifact.public_link.create':
                case 'artifact.public_link.list':
                case 'artifact.public_link.revoke':
                    return await publicLinks({ actionId, input, signal });
                case 'artifact.revisions.list': {
                    const args = ArtifactActionInputSchemasV1[actionId].parse(input);
                    return await account.listArtifactRevisions(args.artifactId, signal);
                }
                case 'artifact.revisions.restore':
                    return await account.restoreArtifactRevision(ArtifactActionInputSchemasV1[actionId].parse(input), signal);
                case 'artifact.storage.usage':
                    return await account.readArtifactStorageUsage(signal);
                default:
                    return { ok: false, errorCode: 'unsupported_action', error: `unsupported_action:${actionId}` };
            }
        } catch (error) {
            account.assertCurrent();
            signal?.throwIfAborted();
            if (error instanceof ArtifactQuotaExceededError)
                return { ok: false, errorCode: 'quota_exceeded', error: 'quota_exceeded', details: error.quota };
            const code = error instanceof HappyError && error.status === 404 ? 'not_found'
                : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'action_failed';
            return { ok: false, errorCode: code, error: error instanceof Error ? error.message : code };
        }
    };
}
