import type { PromptLibraryArtifactStore } from '@happier-dev/protocol';

import { storage } from '@/sync/domains/state/storage';
import type { ArtifactHeader } from '@/sync/domains/artifacts/artifactTypes';
import { sync } from '@/sync/sync';
import { throwIfAborted } from '@/utils/runtime/abortSignals';

export const uiPromptLibraryArtifactStore: PromptLibraryArtifactStore = {
  read: async (artifactId, options) => {
    throwIfAborted(options?.signal);
    const local = storage.getState().artifacts[artifactId] ?? null;
    if (local?.body === undefined || local.bodyVersion === undefined) {
      const full = await sync.fetchArtifactWithBody(artifactId);
      if (full) storage.getState().updateArtifact(full);
    }
    throwIfAborted(options?.signal);
    const artifact = storage.getState().artifacts[artifactId] ?? null;
    if (!artifact) return null;
    if (artifact.bodyVersion === undefined) throw new Error('artifact_missing_revision');
    return {
      id: artifactId,
      revision: { headerVersion: artifact.headerVersion, bodyVersion: artifact.bodyVersion },
      header: artifact.header ?? null,
      body: typeof artifact.body === 'string' ? artifact.body : null,
    };
  },
  update: async ({ artifactId, expectedRevision, header, body, signal }) => {
    throwIfAborted(signal);
    await sync.updateArtifactWithHeader(artifactId, header as ArtifactHeader, body, { expectedRevision, signal });
    throwIfAborted(signal);
  },
  create: async ({ header, body, signal }) => {
    throwIfAborted(signal);
    const artifactId = await sync.createArtifactWithHeader(header as ArtifactHeader, body);
    throwIfAborted(signal);
    return artifactId;
  },
};
