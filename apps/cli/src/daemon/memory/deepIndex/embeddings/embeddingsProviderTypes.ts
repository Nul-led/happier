import type { OperationalMemoryEmbeddingsDiagnostics } from '@/daemon/memory/resolveOperationalMemoryEmbeddingsSettings';

export type EmbeddingsProvider = Readonly<{
  providerKind: 'local_transformers' | 'openai_compatible';
  modelId: string;
  embedQuery: (text: string, signal?: AbortSignal) => Promise<Float32Array>;
  embedDocuments: (texts: readonly string[], signal?: AbortSignal) => Promise<Float32Array[]>;
}>;

export type EmbeddingsProviderResolution = Readonly<{
  provider: EmbeddingsProvider | null;
} & OperationalMemoryEmbeddingsDiagnostics>;
