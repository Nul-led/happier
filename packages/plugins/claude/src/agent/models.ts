import {
    type AgentModelConfig,
    type AgentModelDescriptor,
} from '@happier-dev/plugin-sdk/agents';

import { ANTHROPIC_STATIC_MODELS } from '../provider/catalog.js';

export const CLAUDE_STATIC_MODELS: readonly AgentModelDescriptor[] = ANTHROPIC_STATIC_MODELS;

export const CLAUDE_AGENT_MODEL_CONFIG: AgentModelConfig = Object.freeze({
    supportsSelection: true,
    supportsFreeform: true,
    nonAcpApplyScope: 'next_prompt',
    dynamicProbe: 'auto',
    dynamicProbeControl: {
        accountSettingId: 'claudeDynamicModelProbeEnabled',
        environmentVariable: 'HAPPIER_CLAUDE_DYNAMIC_MODEL_PROBE_ENABLED',
    },
    nativeCatalogObservation: {
        providerLocalId: 'anthropic',
        purpose: 'model_upstream',
        connectedServiceId: 'claude-subscription',
        nativeBearer: {
            fileId: '.credentials.json',
            jsonPath: ['claudeAiOauth', 'accessToken'],
        },
    },
    defaultMode: 'default',
    allowedModes: CLAUDE_STATIC_MODELS.map((model) => model.id),
    staticModels: CLAUDE_STATIC_MODELS,
} satisfies AgentModelConfig);
