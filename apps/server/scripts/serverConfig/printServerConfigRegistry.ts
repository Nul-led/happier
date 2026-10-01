import { SERVER_CONFIG_REGISTRY_BASE, type ServerConfigEntry } from '@happier-dev/protocol';

import { API_RATE_LIMIT_GLOBAL_SERVER_CONFIG, API_ROUTE_RATE_LIMIT_SERVER_CONFIG } from '@/app/api/utils/apiRateLimitDefaults';
import { FEATURE_SERVER_CONFIG } from '@/app/features/catalog/featureServerConfig';
import { RETENTION_DOMAIN_SERVER_CONFIG, RETENTION_SERVER_CONFIG } from '@/app/retention/config/retentionServerConfig';
import { SERVER_CONFIG_REGISTRY } from '@/config/serverConfigRegistry';

/**
 * Prints the composed server configuration registry as JSON for the docs generator
 * (`apps/docs/scripts/generateServerConfigReference.mjs`), which cannot import server TypeScript.
 * `origin` names the declaring owner so the feature page can select the feature family.
 */
type Origin = 'base' | 'features' | 'rateLimits' | 'retention';

const origins = new Map<string, Origin>();
const mark = (origin: Origin, entries: Iterable<ServerConfigEntry>) => {
    for (const entry of entries) origins.set(entry.key, origin);
};
mark('base', Object.values(SERVER_CONFIG_REGISTRY_BASE));
mark('features', FEATURE_SERVER_CONFIG instanceof Array ? FEATURE_SERVER_CONFIG : Object.values(FEATURE_SERVER_CONFIG));
mark('rateLimits', [...Object.values(API_RATE_LIMIT_GLOBAL_SERVER_CONFIG), ...API_ROUTE_RATE_LIMIT_SERVER_CONFIG]);
mark('retention', [...Object.values(RETENTION_SERVER_CONFIG), ...RETENTION_DOMAIN_SERVER_CONFIG]);

const entries = Object.values(SERVER_CONFIG_REGISTRY).map((entry) => ({ ...entry, origin: origins.get(entry.key) ?? 'base' }));
process.stdout.write(`${JSON.stringify({ entries })}\n`);
