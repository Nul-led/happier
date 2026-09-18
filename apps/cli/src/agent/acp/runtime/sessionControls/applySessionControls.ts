import { logger } from '@/ui/logger';
import { getAgentModelConfig, type AgentId } from '@happier-dev/agents';

type AcpRuntimeSessionControlBackend = Readonly<{
  setSessionMode?: (sessionId: string, modeId: string) => Promise<void>;
  setSessionModel?: (
    sessionId: string,
    modelId: string,
    requestMeta?: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  setSessionConfigOption?: (
    sessionId: string,
    configId: string,
    value: string,
  ) => Promise<unknown>;
}>;

type AcpRuntimeSessionControlContext = Readonly<{
  provider: string;
  getSessionId: () => string | null;
  ensureBackend: () => Promise<AcpRuntimeSessionControlBackend>;
}>;

function resolveModelConfigOptionId(provider: string): string {
  // An Agent that contributes no bundled model facts uses the ACP default.
  return getAgentModelConfig(provider as AgentId)?.acpModelConfigOptionId ?? 'model';
}

function normalizeSessionConfigOptionValue(value: string | number | boolean | null): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

export async function applyAcpRuntimeSessionMode(
  context: AcpRuntimeSessionControlContext,
  modeId: string,
): Promise<void> {
  const normalizedModeId = typeof modeId === 'string' ? modeId.trim() : '';
  if (!normalizedModeId) return;

  const sessionId = context.getSessionId();
  if (!sessionId) {
    throw new Error(`${context.provider} ACP session was not started`);
  }

  const backend = await context.ensureBackend();
  if (!backend.setSessionMode) return;
  await backend.setSessionMode(sessionId, normalizedModeId);
}

export async function applyAcpRuntimeSessionModel(
  context: AcpRuntimeSessionControlContext,
  modelId: string,
  requestMeta?: Readonly<Record<string, unknown>>,
): Promise<void> {
  const normalizedModelId = typeof modelId === 'string' ? modelId.trim() : '';
  if (!normalizedModelId) return;

  const sessionId = context.getSessionId();
  if (!sessionId) {
    throw new Error(`${context.provider} ACP session was not started`);
  }

  const modelConfigOptionId = resolveModelConfigOptionId(context.provider);
  const backend = await context.ensureBackend();

  if (backend.setSessionModel) {
    try {
      await backend.setSessionModel(sessionId, normalizedModelId, requestMeta);
      return;
    } catch (error) {
      // Only a settled provider rejection may activate the compatibility path. A local timeout
      // cannot establish whether the first effect occurred and must never launch a second write.
      if (requestMeta || !backend.setSessionConfigOption) throw error;
      try {
        await backend.setSessionConfigOption(sessionId, modelConfigOptionId, normalizedModelId);
        return;
      } catch {
        throw error;
      }
    }
  }

  if (backend.setSessionConfigOption) {
    await backend.setSessionConfigOption(sessionId, modelConfigOptionId, normalizedModelId);
  }
}

export async function applyAcpRuntimeSessionConfigOption(
  context: AcpRuntimeSessionControlContext,
  configId: string,
  value: string | number | boolean | null,
): Promise<void> {
  const normalizedConfigId = typeof configId === 'string' ? configId.trim() : '';
  if (!normalizedConfigId) return;

  const normalizedValue = normalizeSessionConfigOptionValue(value);
  if (!normalizedValue) return;

  const sessionId = context.getSessionId();
  if (!sessionId) return;

  const backend = await context.ensureBackend();
  if (!backend.setSessionConfigOption) return;
  await backend.setSessionConfigOption(sessionId, normalizedConfigId, normalizedValue);
}
