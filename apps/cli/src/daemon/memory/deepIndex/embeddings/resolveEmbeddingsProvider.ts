import type { OperationalMemoryEmbeddingsSettings } from '@/daemon/memory/resolveOperationalMemoryEmbeddingsSettings';
import { logger } from '@/ui/logger';
import { createHash } from 'node:crypto';

import {
  createFeatureExtractionPipelineWithFallback,
  createLocalTransformersEmbeddingsProvider,
  importTransformersModuleWithFallback,
} from './createLocalTransformersEmbeddingsProvider';
import { createOpenAiCompatibleEmbeddingsProvider } from './createOpenAiCompatibleEmbeddingsProvider';
import type { EmbeddingsProviderResolution } from './embeddingsProviderTypes';

export type EmbeddingsProviderCache = Map<string, Promise<EmbeddingsProviderResolution>>;

export function createEmbeddingsProviderCache(): EmbeddingsProviderCache {
  return new Map();
}

async function awaitProviderResolution(
  promise: Promise<EmbeddingsProviderResolution>,
  signal?: AbortSignal,
): Promise<EmbeddingsProviderResolution> {
  if (!signal) return await promise;
  signal.throwIfAborted();
  return await new Promise<EmbeddingsProviderResolution>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function buildCacheKey(params: Readonly<{
  cacheDir: string;
  providerConfig: NonNullable<OperationalMemoryEmbeddingsSettings['providerConfig']> | null;
}>): string {
  const providerConfig = params.providerConfig;
  const providerConfigKey = (() => {
    if (!providerConfig) return null;
    if (providerConfig.kind === 'local_transformers') {
      return {
        kind: providerConfig.kind,
        modelId: providerConfig.modelId,
        queryPrefix: providerConfig.queryPrefix ?? null,
        documentPrefix: providerConfig.documentPrefix ?? null,
      };
    }

    const apiKeyMaterial =
      providerConfig.apiKey?.encryptedValue?.c ??
      providerConfig.apiKey?.value ??
      '';
    return {
      kind: providerConfig.kind,
      baseUrl: providerConfig.baseUrl ?? null,
      model: providerConfig.model,
      dimensions: providerConfig.dimensions ?? null,
      apiKeyHash: createHash('sha256').update(apiKeyMaterial).digest('hex'),
    };
  })();

  return JSON.stringify({
    cacheDir: params.cacheDir,
    providerConfig: providerConfigKey,
  });
}

function hasRequiredProviderConfig(
  providerConfig: NonNullable<OperationalMemoryEmbeddingsSettings['providerConfig']>,
): boolean {
  if (providerConfig.kind === 'local_transformers') {
    return String(providerConfig.modelId ?? '').trim().length > 0;
  }

  return (
    String(providerConfig.baseUrl ?? '').trim().length > 0 &&
    String(providerConfig.model ?? '').trim().length > 0 &&
    (
      String(providerConfig.apiKey?.value ?? '').trim().length > 0 ||
      String(providerConfig.apiKey?.encryptedValue?.c ?? '').trim().length > 0
    )
  );
}

export async function resolveEmbeddingsProvider(params: Readonly<{
  settings: OperationalMemoryEmbeddingsSettings | null;
  cacheDir: string;
  settingsSecretsReadKeys?: ReadonlyArray<Uint8Array | null | undefined>;
  signal?: AbortSignal;
  cache?: EmbeddingsProviderCache;
}>): Promise<EmbeddingsProviderResolution> {
  const settings = params.settings;
  if (!settings?.enabled || !settings.providerConfig || !settings.providerKind || !settings.modelId) {
    return {
      provider: null,
      mode: settings?.mode ?? 'disabled',
      presetId: settings?.presetId ?? null,
      providerKind: settings?.providerKind ?? null,
      modelId: settings?.modelId ?? null,
      runtimeState: 'unavailable',
      usingFallback: false,
      lastError: null,
    };
  }
  const providerConfig = settings.providerConfig!;
  const providerKind = settings.providerKind!;
  const modelId = settings.modelId!;
  if (!hasRequiredProviderConfig(providerConfig)) {
    return {
      provider: null,
      mode: settings.mode,
      presetId: settings.presetId,
      providerKind,
      modelId,
      runtimeState: 'unavailable',
      usingFallback: false,
      lastError: null,
    };
  }

  const cacheKey = buildCacheKey({
    cacheDir: params.cacheDir,
    providerConfig,
  });
  const cached = params.cache?.get(cacheKey);
  if (cached) return await awaitProviderResolution(cached, params.signal);

  const promise = (async (): Promise<EmbeddingsProviderResolution> => {
    try {
      const provider =
        providerConfig.kind === 'local_transformers'
          ? await createLocalTransformersEmbeddingsProvider({
            config: providerConfig,
            cacheDir: params.cacheDir,
          })
          : await createOpenAiCompatibleEmbeddingsProvider({
            config: providerConfig,
            settingsSecretsReadKeys: params.settingsSecretsReadKeys ?? [],
          });

      return {
        provider,
        mode: settings.mode,
        presetId: settings.presetId,
        providerKind: provider.providerKind,
        modelId: provider.modelId,
        runtimeState: 'ready',
        usingFallback: false,
        lastError: null,
      };
    } catch (error) {
      logger.warn('[memoryWorker] Embeddings unavailable; using keyword-search fallback', {
        providerKind,
        modelId,
        message: error instanceof Error ? error.message : String(error),
      });
      params.cache?.delete(cacheKey);
      return {
        provider: null,
        mode: settings.mode,
        presetId: settings.presetId,
        providerKind,
        modelId,
        runtimeState: 'error',
        usingFallback: true,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  params.cache?.set(cacheKey, promise);
  return await awaitProviderResolution(promise, params.signal);
}

export { importTransformersModuleWithFallback };
export { createFeatureExtractionPipelineWithFallback };
