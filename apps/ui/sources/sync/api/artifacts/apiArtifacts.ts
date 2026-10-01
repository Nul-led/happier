import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { backoff } from '@/utils/timing/time';
import { Artifact, ArtifactCreateRequest, ArtifactUpdateRequest, ArtifactUpdateResponse } from '@/sync/domains/artifacts/artifactTypes';
import { HappyError } from '@/utils/errors/errors';
import { serverFetch, type ServerFetch } from '@/sync/http/client';
import {
    ArtifactAccessErrorCodeV1Schema,
    ArtifactAccessGrantsListResponseV1Schema,
    ArtifactAccessGrantMutationResponseV1Schema,
    ArtifactAccessRecipientCensusResponseV1Schema,
    isPlainArtifactDataKeyMarker,
    ArtifactRecipientKeyEnvelopeCommitResponseV1Schema,
    type ArtifactAccessGrantsListInputV1,
    type ArtifactAccessGrantSetInputV1,
    type ArtifactAccessGrantRemoveInputV1,
    type ArtifactRecipientKeyEnvelopeCommitInputV1,
} from '@happier-dev/protocol';

const artifactAuthorityProjectionSchema = ArtifactAccessRecipientCensusResponseV1Schema.pick({
    ownerAccountId: true, access: true, encryptionMode: true,
});

function readArtifactResponse(value: unknown): Artifact {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HappyError('Artifact content is unavailable', false, { code: 'artifact_content_unavailable' });
    }
    const projection = artifactAuthorityProjectionSchema.safeParse({
        ownerAccountId: Reflect.get(value, 'ownerAccountId'),
        access: Reflect.get(value, 'access'),
        encryptionMode: Reflect.get(value, 'encryptionMode'),
    });
    if (!projection.success) {
        throw new HappyError('Artifact content is unavailable', false, { code: 'artifact_content_unavailable' });
    }
    if ((projection.data.encryptionMode === 'plain') !== isPlainArtifactDataKeyMarker(Reflect.get(value, 'dataEncryptionKey'))) {
        throw new HappyError('Artifact content does not match its owner Account mode', false, { code: 'artifact_account_mode_mismatch' });
    }
    return { ...value as Artifact, ...projection.data };
}

export type ArtifactApiOptions = Readonly<{
    retry?: 'default' | 'none';
    request?: ServerFetch;
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
    /** Inventory selection only; the server remains the access authority. */
    ownerAccountId?: string;
}>;

/** The existing Artifact HTTP owner carries grants and fenced recipient keys. */
export function createArtifactAccessApi(credentials: AuthCredentials, opts: Pick<ArtifactApiOptions, 'request'> = {}) {
    const send = async <T>(artifactId: string, leaf: string, schema: { parse: (value: unknown) => T },
        method?: string, input?: unknown, signal?: AbortSignal): Promise<T> => {
        signal?.throwIfAborted();
        const response = await (opts.request ?? serverFetch)(`/v1/artifacts/${encodeURIComponent(artifactId)}/access/${leaf}`, {
            ...(method ? { method } : {}),
            headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
            ...(signal ? { signal } : {}),
        }, { includeAuth: false, retry: 'none' });
        signal?.throwIfAborted();
        const value: unknown = await response.json().catch(() => null);
        signal?.throwIfAborted();
        if (!response.ok) {
            const known = ArtifactAccessErrorCodeV1Schema.safeParse(value && typeof value === 'object' ? Reflect.get(value, 'error') : undefined);
            const code = known.success ? known.data
                : response.status === 404 || response.status === 405 ? 'artifact_access_unavailable' : 'artifact_access_failed';
            throw Object.assign(new Error(code), { code });
        }
        return schema.parse(value);
    };
    return {
        list: (input: ArtifactAccessGrantsListInputV1, signal?: AbortSignal) =>
            send(input.artifactId, 'grants', ArtifactAccessGrantsListResponseV1Schema, undefined, undefined, signal),
        set: (input: ArtifactAccessGrantSetInputV1, signal?: AbortSignal) =>
            send(input.artifactId, 'grants', ArtifactAccessGrantMutationResponseV1Schema, 'PUT', input, signal),
        remove: (input: ArtifactAccessGrantRemoveInputV1, signal?: AbortSignal) =>
            send(input.artifactId, 'grants', ArtifactAccessGrantMutationResponseV1Schema, 'DELETE', input, signal),
        readRecipients: (artifactId: string, signal?: AbortSignal) =>
            send(artifactId, 'recipients', ArtifactAccessRecipientCensusResponseV1Schema, undefined, undefined, signal),
        commitKeyEnvelopes: (input: ArtifactRecipientKeyEnvelopeCommitInputV1, signal?: AbortSignal) =>
            send(input.artifactId, 'key-envelopes', ArtifactRecipientKeyEnvelopeCommitResponseV1Schema, 'POST', input, signal),
    };
}

/**
 * Fetch all artifacts for the account
 */
export async function fetchArtifacts(
    credentials: AuthCredentials,
    opts: ArtifactApiOptions = {},
): Promise<Artifact[]> {
    const run = async () => {
        const query = new URLSearchParams();
        if (opts.limit !== undefined) query.set('limit', String(opts.limit));
        if (opts.cursor !== undefined) query.set('cursor', opts.cursor);
        const search = query.toString();
        const response = await (opts.request ?? serverFetch)(`/v1/artifacts${search ? `?${search}` : ''}`, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        }, { includeAuth: false, retry: opts.retry });

        if (!response.ok) {
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                let message = 'Failed to fetch artifacts';
                try {
                    const error = await response.json();
                    if (error?.error) message = error.error;
                } catch {
                    // ignore
                }
                throw new HappyError(message, false, { status: response.status, ...(response.status === 400 ? { code: 'invalid_cursor' } : {}) });
            }
            throw new HappyError(`Failed to fetch artifacts: ${response.status}`, true, { status: response.status });
        }

        const value: unknown = await response.json();
        if (!Array.isArray(value)) {
            throw new HappyError('Artifact content is unavailable', false, { code: 'artifact_content_unavailable' });
        }
        const data = value.map(readArtifactResponse);
        return opts.ownerAccountId === undefined ? data : data.filter(artifact => artifact.ownerAccountId === opts.ownerAccountId);
    };

    if (opts.retry === 'none') {
        return await run();
    }

    return await backoff(run);
}

/**
 * Fetch a single artifact with full body
 */
export async function fetchArtifact(
    credentials: AuthCredentials,
    artifactId: string,
    opts: ArtifactApiOptions = {},
): Promise<Artifact> {
    const run = async () => {
        const response = await (opts.request ?? ((path, init, requestOptions) => serverFetch(path, init, {
            includeAuth: false,
            retry: requestOptions?.retry,
        })))(`/v1/artifacts/${artifactId}`, {
            ...(opts.signal ? { signal: opts.signal } : {}),
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        }, { includeAuth: false, retry: opts.retry });

        if (!response.ok) {
            if (response.status === 404) {
                throw new HappyError('Artifact not found', false, { status: 404, code: 'not_found' });
            }
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                let message = 'Failed to fetch artifact';
                try {
                    const error = await response.json();
                    if (error?.error) message = error.error;
                } catch {
                    // ignore
                }
                throw new HappyError(message, false, { status: response.status });
            }
            throw new HappyError(`Failed to fetch artifact: ${response.status}`, true, { status: response.status });
        }

        return readArtifactResponse(await response.json());
    };

    if (opts.retry === 'none') {
        return await run();
    }

    return await backoff(run);
}

/**
 * Create a new artifact
 */
export async function createArtifact(
    credentials: AuthCredentials, 
    request: ArtifactCreateRequest,
    opts: ArtifactApiOptions = {},
): Promise<Artifact> {
    const run = async () => {
        const response = await (opts.request ?? ((path, init) => serverFetch(path, init, { includeAuth: false })))('/v1/artifacts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            if (response.status === 409) {
                throw new HappyError('Artifact ID already exists', false, { status: 409, code: 'conflict' });
            }
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                let message = 'Failed to create artifact';
                try {
                    const error = await response.json();
                    if (error?.error) message = error.error;
                } catch {
                    // ignore
                }
                throw new HappyError(message, false, { status: response.status });
            }
            throw new HappyError(`Failed to create artifact: ${response.status}`, true, { status: response.status });
        }

        return readArtifactResponse(await response.json());
    };

    if (opts.retry === 'none') {
        return await run();
    }

    return await backoff(run);
}

/**
 * Update an existing artifact
 */
export async function updateArtifact(
    credentials: AuthCredentials,
    artifactId: string,
    request: ArtifactUpdateRequest,
    opts: ArtifactApiOptions = {},
): Promise<ArtifactUpdateResponse> {
    const run = async () => {
        const response = await (opts.request ?? ((path, init) => serverFetch(path, init, { includeAuth: false })))(`/v1/artifacts/${artifactId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new HappyError('Artifact not found', false, { status: 404, code: 'not_found' });
            }
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                let message = 'Failed to update artifact';
                try {
                    const error = await response.json();
                    if (error?.error) message = error.error;
                } catch {
                    // ignore
                }
                throw new HappyError(message, false, { status: response.status });
            }
            throw new HappyError(`Failed to update artifact: ${response.status}`, true, { status: response.status });
        }

        const data = await response.json() as ArtifactUpdateResponse;
        return data;
    };

    if (opts.retry === 'none') {
        return await run();
    }

    return await backoff(run);
}

/**
 * Delete an artifact
 */
export async function deleteArtifact(
    credentials: AuthCredentials,
    artifactId: string,
    opts: ArtifactApiOptions = {},
): Promise<void> {
    const run = async () => {
        const response = await (opts.request ?? serverFetch)(`/v1/artifacts/${artifactId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        }, { includeAuth: false, retry: opts.retry });

        if (!response.ok) {
            if (response.status === 404) {
                throw new HappyError('Artifact not found', false, { status: 404, code: 'not_found' });
            }
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                let message = 'Failed to delete artifact';
                try {
                    const error = await response.json();
                    if (error?.error) message = error.error;
                } catch {
                    // ignore
                }
                throw new HappyError(message, false, { status: response.status });
            }
            throw new HappyError(`Failed to delete artifact: ${response.status}`, true, { status: response.status });
        }
    };

    if (opts.retry === 'none') {
        await run();
        return;
    }

    await backoff(run);
}
