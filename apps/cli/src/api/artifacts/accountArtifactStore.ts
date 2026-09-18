import axios from 'axios';
import { randomUUID } from 'node:crypto';

import {
  ARTIFACT_PLAIN_DATA_KEY_MARKER,
  decodePlainArtifactStoredContent,
  encodePlainArtifactStoredContent,
  isPlainArtifactDataKeyMarker,
  openEncryptedDataKeyEnvelopeV1,
  sealEncryptedDataKeyEnvelopeV1,
} from '@happier-dev/protocol';

import type { Credentials, StoredCredentials } from '@/persistence';
import type { ConnectedServiceAccountEncryptionMode } from '@/api/client/connectedServiceCredentialApi';
import { createConnectedServiceCredentialApi } from '@/api/client/connectedServiceCredentialApi';
import { requireCurrentAccountStoredContentServerCompatibility } from '@/api/clientCompatibility/accountStoredContentActivation';
import {
  decodeBase64,
  decryptWithDataKey,
  encodeBase64,
  encryptWithDataKey,
  getRandomBytes,
  libsodiumPublicKeyFromSecretKey,
} from '@/api/encryption';
import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { deriveKey } from '@/utils/deriveKey';

export type AccountArtifactRevision = Readonly<{ headerVersion: number; bodyVersion: number }>;
export type AccountArtifact = Readonly<{
  artifactId: string;
  header: Readonly<Record<string, unknown>>;
  body: string | null;
  revision: AccountArtifactRevision;
  seq: number;
  createdAt: number;
  updatedAt: number;
}>;
export type AccountArtifactHeader = Readonly<{
  artifactId: string; header: Readonly<Record<string, unknown>>; headerVersion: number;
  seq: number; createdAt: number; updatedAt: number;
}>;
export function encodeAccountArtifactListCursor(item: Pick<AccountArtifactHeader, 'artifactId' | 'updatedAt'>): string {
  return Buffer.from(JSON.stringify({ updatedAt: item.updatedAt, id: item.artifactId }), 'utf8').toString('base64url');
}

type StoredArtifact = Readonly<{
  id: string; header: string; headerVersion: number; body: string; bodyVersion: number;
  dataEncryptionKey: string; seq: number; createdAt: number; updatedAt: number;
}>;

type Codec = Readonly<{
  mode: 'plain' | 'e2ee'; dataEncryptionKey: string;
  encode(value: unknown): string; decode(value: string): unknown | null;
}>;

function readNonnegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

export const ARTIFACT_ENCRYPTION_MATERIAL_UNAVAILABLE = 'artifact_encryption_material_unavailable' as const;
export class ArtifactEncryptionMaterialUnavailableError extends Error {
  readonly code = ARTIFACT_ENCRYPTION_MATERIAL_UNAVAILABLE;
  constructor() { super('Artifact encryption material is unavailable'); this.name = 'ArtifactEncryptionMaterialUnavailableError'; }
}

function requireCredentials(credentials: StoredCredentials): Credentials {
  if (!credentials.encryption) throw new ArtifactEncryptionMaterialUnavailableError();
  return credentials;
}

async function recipientSecret(credentials: Credentials): Promise<Uint8Array> {
  return credentials.encryption.type === 'dataKey'
    ? credentials.encryption.machineKey
    : deriveKey(credentials.encryption.secret, 'Happy EnCoder', ['content']);
}

async function createCodec(params: Readonly<{
  credentials: StoredCredentials; mode: ConnectedServiceAccountEncryptionMode;
  requirePlainWriteCompatibility: () => Promise<void>;
}>): Promise<Codec> {
  if (params.mode === 'plain') {
    await params.requirePlainWriteCompatibility();
    return { mode: 'plain', dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
      encode: encodePlainArtifactStoredContent, decode: decodePlainArtifactStoredContent };
  }
  if (params.mode === 'unknown') throw Object.assign(new Error('account_encryption_mode_unavailable'), { code: 'account_encryption_mode_unavailable' });
  const credentials = requireCredentials(params.credentials);
  const key = getRandomBytes(32);
  const publicKey = credentials.encryption.type === 'dataKey'
    ? credentials.encryption.publicKey
    : libsodiumPublicKeyFromSecretKey(await recipientSecret(credentials));
  return {
    mode: 'e2ee',
    dataEncryptionKey: encodeBase64(sealEncryptedDataKeyEnvelopeV1({ dataKey: key, recipientPublicKey: publicKey, randomBytes: getRandomBytes }), 'base64'),
    encode: (value) => encodeBase64(encryptWithDataKey(value, key), 'base64'),
    decode: (value) => decryptWithDataKey(decodeBase64(value), key),
  };
}

async function openCodec(credentialsInput: StoredCredentials, dataEncryptionKey: string): Promise<Codec> {
  if (isPlainArtifactDataKeyMarker(dataEncryptionKey)) return {
    mode: 'plain', dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
    encode: encodePlainArtifactStoredContent, decode: decodePlainArtifactStoredContent,
  };
  const credentials = requireCredentials(credentialsInput);
  const key = openEncryptedDataKeyEnvelopeV1({
    envelope: decodeBase64(dataEncryptionKey), recipientSecretKeyOrSeed: await recipientSecret(credentials),
  });
  if (!key) throw new ArtifactEncryptionMaterialUnavailableError();
  return { mode: 'e2ee', dataEncryptionKey,
    encode: (value) => encodeBase64(encryptWithDataKey(value, key), 'base64'),
    decode: (value) => decryptWithDataKey(decodeBase64(value), key) };
}

function decode(codec: Codec, value: string): unknown {
  try {
    const decoded = codec.decode(value);
    if (decoded === null) throw new ArtifactEncryptionMaterialUnavailableError();
    return decoded;
  } catch (error) {
    if (error instanceof ArtifactEncryptionMaterialUnavailableError) throw error;
    throw new ArtifactEncryptionMaterialUnavailableError();
  }
}

function parseStoredArtifact(raw: unknown): StoredArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.header !== 'string' || typeof value.body !== 'string' || typeof value.dataEncryptionKey !== 'string') return null;
  const headerVersion = readNonnegativeSafeInteger(value.headerVersion);
  const bodyVersion = readNonnegativeSafeInteger(value.bodyVersion);
  const seq = readNonnegativeSafeInteger(value.seq);
  const createdAt = readNonnegativeSafeInteger(value.createdAt);
  const updatedAt = readNonnegativeSafeInteger(value.updatedAt);
  if (headerVersion === null || bodyVersion === null || seq === null || createdAt === null || updatedAt === null) return null;
  return { id: value.id, header: value.header, headerVersion, body: value.body,
    bodyVersion, dataEncryptionKey: value.dataEncryptionKey, seq, createdAt, updatedAt };
}

export function createAccountArtifactStore(params: Readonly<{
  credentials: StoredCredentials;
  getAccountEncryptionMode: () => Promise<ConnectedServiceAccountEncryptionMode>;
  requirePlainWriteCompatibility: () => Promise<void>;
}>) {
  const headers = () => ({ ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(), Authorization: `Bearer ${params.credentials.token}`, 'Content-Type': 'application/json' });
  const fetchStored = async (artifactId: string, signal?: AbortSignal): Promise<StoredArtifact | null> => {
    const response = await axios.get(`${resolveServerHttpBaseUrl()}/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      headers: headers(), timeout: 15_000, ...(signal ? { signal } : {}), validateStatus: () => true,
    });
    if (response.status === 404) return null;
    if (response.status === 500 && response.data?.error === 'Failed to get artifact') throw new ArtifactEncryptionMaterialUnavailableError();
    return response.status >= 200 && response.status < 300 ? parseStoredArtifact(response.data) : null;
  };
  const read = async (artifactId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<AccountArtifact | null> => {
    options?.signal?.throwIfAborted();
    const stored = await fetchStored(artifactId, options?.signal);
    if (!stored) return null;
    const codec = await openCodec(params.credentials, stored.dataEncryptionKey);
    const header = decode(codec, stored.header);
    const body = decode(codec, stored.body) as { body?: unknown };
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
    return { artifactId: stored.id, header: header as Readonly<Record<string, unknown>>,
      body: typeof body?.body === 'string' ? body.body : null,
      revision: { headerVersion: stored.headerVersion, bodyVersion: stored.bodyVersion },
      seq: stored.seq, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
  };
  return {
    read,
    list: async (options?: Readonly<{ limit?: number; cursor?: string; signal?: AbortSignal }>): Promise<Readonly<{ items: readonly AccountArtifactHeader[]; nextCursor?: string }>> => {
      options?.signal?.throwIfAborted();
      const url = new URL('/v1/artifacts', resolveServerHttpBaseUrl());
      if (options?.limit !== undefined) url.searchParams.set('limit', String(options.limit));
      if (options?.cursor) url.searchParams.set('cursor', options.cursor);
      const response = await axios.get(url.toString(), { headers: headers(), timeout: 15_000,
        ...(options?.signal ? { signal: options.signal } : {}), validateStatus: () => true });
      if (response.status === 500 && response.data?.error === 'Failed to get artifacts') throw new ArtifactEncryptionMaterialUnavailableError();
      if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
        throw Object.assign(new Error(response.status === 400 ? 'artifact_list_cursor_invalid' : 'artifact_list_failed'), {
          code: response.status === 400 ? 'invalid_cursor' : 'list_failed',
        });
      }
      const items: AccountArtifactHeader[] = [];
      for (const raw of response.data) {
        if (!raw || typeof raw !== 'object') continue;
        const value = raw as Record<string, unknown>;
        if (typeof value.id !== 'string' || typeof value.header !== 'string' || typeof value.dataEncryptionKey !== 'string') continue;
        const headerVersion = readNonnegativeSafeInteger(value.headerVersion);
        const seq = readNonnegativeSafeInteger(value.seq);
        const createdAt = readNonnegativeSafeInteger(value.createdAt);
        const updatedAt = readNonnegativeSafeInteger(value.updatedAt);
        if (headerVersion === null || seq === null || createdAt === null || updatedAt === null) continue;
        const codec = await openCodec(params.credentials, value.dataEncryptionKey);
        const header = decode(codec, value.header);
        if (!header || typeof header !== 'object' || Array.isArray(header)) continue;
        items.push({ artifactId: value.id, header: header as Readonly<Record<string, unknown>>,
          headerVersion, seq, createdAt, updatedAt });
      }
      const last = response.data.at(-1) as Record<string, unknown> | undefined;
      const requestedLimit = options?.limit;
      const nextCursor = requestedLimit !== undefined && response.data.length === requestedLimit
        && typeof last?.id === 'string' && typeof last?.updatedAt === 'number'
        ? encodeAccountArtifactListCursor({ updatedAt: last.updatedAt, artifactId: last.id })
        : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    create: async (input: Readonly<{ artifactId?: string; header: Readonly<Record<string, unknown>>; body: string; signal?: AbortSignal }>) => {
      input.signal?.throwIfAborted();
      const codec = await createCodec({ credentials: params.credentials, mode: await params.getAccountEncryptionMode(), requirePlainWriteCompatibility: params.requirePlainWriteCompatibility });
      const artifactId = input.artifactId ?? randomUUID();
      const response = await axios.post(`${resolveServerHttpBaseUrl()}/v1/artifacts`, {
        id: artifactId, header: codec.encode(input.header), body: codec.encode({ body: input.body }), dataEncryptionKey: codec.dataEncryptionKey,
      }, { headers: headers(), timeout: 15_000, ...(input.signal ? { signal: input.signal } : {}), validateStatus: () => true });
      if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(response.status === 409 ? 'artifact_create_conflict' : 'artifact_create_failed'), { code: response.status === 409 ? 'conflict' : 'create_failed' });
      return { artifactId: typeof response.data?.id === 'string' ? response.data.id : artifactId, revision: { headerVersion: 1, bodyVersion: 1 } };
    },
    update: async (input: Readonly<{ artifactId: string; expectedRevision: AccountArtifactRevision; header: Readonly<Record<string, unknown>>; body: string; signal?: AbortSignal }>) => {
      const stored = await fetchStored(input.artifactId, input.signal);
      if (!stored) return { ok: false, errorCode: 'not_found', error: 'artifact_not_found' } as const;
      const codec = await openCodec(params.credentials, stored.dataEncryptionKey);
      if (codec.mode === 'plain') await params.requirePlainWriteCompatibility();
      const response = await axios.post(`${resolveServerHttpBaseUrl()}/v1/artifacts/${encodeURIComponent(input.artifactId)}`, {
        header: codec.encode(input.header), expectedHeaderVersion: input.expectedRevision.headerVersion,
        body: codec.encode({ body: input.body }), expectedBodyVersion: input.expectedRevision.bodyVersion,
      }, { headers: headers(), timeout: 15_000, ...(input.signal ? { signal: input.signal } : {}), validateStatus: () => true });
      if (response.status === 404) return { ok: false, errorCode: 'not_found', error: 'artifact_not_found' } as const;
      if (response.status < 200 || response.status >= 300) return { ok: false, errorCode: 'update_failed', error: 'artifact_update_failed' } as const;
      if (response.data?.success === false && response.data?.error === 'version-mismatch') return { ok: false, errorCode: 'version_mismatch', error: 'artifact_version_mismatch' } as const;
      return response.data?.success === true
        ? { ok: true, revision: { headerVersion: Number(response.data.headerVersion ?? input.expectedRevision.headerVersion + 1), bodyVersion: Number(response.data.bodyVersion ?? input.expectedRevision.bodyVersion + 1) } } as const
        : { ok: false, errorCode: 'update_failed', error: 'artifact_update_failed' } as const;
    },
    delete: async (artifactId: string, options?: Readonly<{ signal?: AbortSignal }>) => {
      options?.signal?.throwIfAborted();
      const response = await axios.delete(`${resolveServerHttpBaseUrl()}/v1/artifacts/${encodeURIComponent(artifactId)}`, {
        headers: headers(), timeout: 15_000, ...(options?.signal ? { signal: options.signal } : {}), validateStatus: () => true,
      });
      if (response.status === 404) return { ok: false, errorCode: 'not_found', error: 'artifact_not_found' } as const;
      return response.status >= 200 && response.status < 300
        ? { ok: true } as const
        : { ok: false, errorCode: 'delete_failed', error: 'artifact_delete_failed' } as const;
    },
  };
}

export function createCredentialedAccountArtifactStore(credentials: StoredCredentials) {
  const accountModeApi = createConnectedServiceCredentialApi(credentials);
  return createAccountArtifactStore({
    credentials,
    getAccountEncryptionMode: () => accountModeApi.getAccountEncryptionMode(),
    requirePlainWriteCompatibility: async () => {
      await requireCurrentAccountStoredContentServerCompatibility();
    },
  });
}
