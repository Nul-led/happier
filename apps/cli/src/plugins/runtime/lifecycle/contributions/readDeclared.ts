import type {
    ParsedPluginEventContributionV1,
    PluginSystemToolContributionV1,
} from '@happier-dev/protocol';

import { isRecord } from '../utils';

/**
 * Readers that pull the runtime metadata consumed by the activated registry
 * off a raw (already schema validated) plugin manifest `contributes` value.
 */

export function readDeclaredEventContributions(value: unknown): readonly ParsedPluginEventContributionV1[] {
    if (!isRecord(value) || !Array.isArray(value.events)) {
        return Object.freeze([]);
    }
    return Object.freeze(value.events.flatMap((definition) => {
        if (!isRecord(definition)) {
            return [];
        }
        const id = typeof definition.id === 'string' ? definition.id.trim() : '';
        return id.length > 0 ? [definition as ParsedPluginEventContributionV1] : [];
    }));
}

export function readDeclaredSystemToolContributions(value: unknown): readonly PluginSystemToolContributionV1[] {
    if (!isRecord(value) || !Array.isArray(value.systemTools)) {
        return Object.freeze([]);
    }
    return Object.freeze(value.systemTools as PluginSystemToolContributionV1[]);
}
