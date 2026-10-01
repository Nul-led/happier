import type {
  AgentSessionModelsSnapshot,
  AgentSessionModelsSource,
} from '@happier-dev/plugin-sdk/agents/runtime';

import { buildPiRuntimeModelsSnapshot } from '../models/catalog.js';

export function createPiSessionModelsSource(params: Readonly<{
  readState(): Promise<unknown>;
  onError(error: unknown): void;
}>): AgentSessionModelsSource & Readonly<{
  observeCatalog(result: Readonly<{ models: unknown[] }> | Readonly<{ error: string }>): void;
  refresh(): Promise<void>;
  dispose(): void;
}> {
  let disposed = false;
  let refreshGeneration = 0;
  let snapshot: AgentSessionModelsSnapshot = Object.freeze({ models: null });
  let state: unknown;
  let catalog: Readonly<{ models: unknown[]; observedAt: number }> | null = null;
  const listeners = new Set<(value: AgentSessionModelsSnapshot) => void>();

  const publish = () => {
    const next = buildPiRuntimeModelsSnapshot({ state, availableModels: catalog ?? { models: [] } });
    if (!next) throw new Error('Pi returned an invalid model catalog');
    snapshot = Object.freeze(catalog
      ? { ...next, observedAt: catalog.observedAt }
      : { ...next, models: null });
    for (const listener of listeners) listener(snapshot);
  };

  return Object.freeze({
    read: () => snapshot,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      listener(snapshot);
      return { dispose: () => { listeners.delete(listener); } };
    },
    observeCatalog(result) {
      if (disposed) return;
      if ('error' in result) {
        params.onError(new Error(`Pi model discovery failed: ${result.error}`));
        return;
      }
      if (!buildPiRuntimeModelsSnapshot({ state, availableModels: result })) {
        params.onError(new Error('Pi returned an invalid model catalog'));
        return;
      }
      catalog = { models: result.models, observedAt: Date.now() };
      publish();
    },
    async refresh() {
      if (disposed) return;
      const generation = ++refreshGeneration;
      try {
        const nextState = await params.readState();
        if (disposed || generation !== refreshGeneration) return;
        state = nextState;
        publish();
      } catch (error) {
        params.onError(error);
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  });
}
