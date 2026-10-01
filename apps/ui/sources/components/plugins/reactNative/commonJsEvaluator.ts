import { PLUGIN_UI_COMMON_JS_HOST_MODULES } from './hostModules';

export type PluginUiCommonJsHostModules = Readonly<Record<string, unknown>>;

export type PluginUiCommonJsArtifactIdentity = Readonly<{
    pluginId: string;
    artifactId: string;
    digest: string;
}>;

export type PluginUiCommonJsEvaluationErrorCode =
    | 'module_instantiation_failed'
    | 'unknown_host_module'
    | 'invalid_executable_export';

export class PluginUiCommonJsEvaluationError extends Error {
    readonly code: PluginUiCommonJsEvaluationErrorCode;
    readonly identity: PluginUiCommonJsArtifactIdentity;
    readonly requestedExport: string;

    constructor(input: Readonly<{
        code: PluginUiCommonJsEvaluationErrorCode;
        identity: PluginUiCommonJsArtifactIdentity;
        requestedExport: string;
    }>) {
        super(`${input.code}:${input.identity.pluginId}:${input.identity.artifactId}`);
        this.name = 'PluginUiCommonJsEvaluationError';
        this.code = input.code;
        this.identity = input.identity;
        this.requestedExport = input.requestedExport;
    }
}

function fail(input: Readonly<{
    code: PluginUiCommonJsEvaluationErrorCode;
    identity: PluginUiCommonJsArtifactIdentity;
    requestedExport: string;
}>): never {
    throw new PluginUiCommonJsEvaluationError(input);
}

function boundedSourceUrl(identity: PluginUiCommonJsArtifactIdentity): string {
    const safe = `${identity.pluginId}-${identity.artifactId}`
        .replace(/[^a-zA-Z0-9._-]/gu, '-')
        .slice(0, 160);
    return `\n//# sourceURL=happier-plugin-ui-${safe}.cjs`;
}

export function evaluatePluginUiCommonJsBundle(input: Readonly<{
    bytes: Uint8Array;
    identity: PluginUiCommonJsArtifactIdentity;
    requestedExport: string;
    hostModules?: PluginUiCommonJsHostModules;
}>): (...args: never[]) => unknown {
    let source: string;
    try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    } catch {
        fail({
            code: 'module_instantiation_failed',
            identity: input.identity,
            requestedExport: input.requestedExport,
        });
    }

    const module = { exports: {} as unknown };
    const exports = module.exports;
    const hostModules = input.hostModules ?? PLUGIN_UI_COMMON_JS_HOST_MODULES;
    const requireHostModule = (specifier: string): unknown => {
        if (!Object.prototype.hasOwnProperty.call(hostModules, specifier)) {
            fail({
                code: 'unknown_host_module',
                identity: input.identity,
                requestedExport: input.requestedExport,
            });
        }
        return (hostModules as Readonly<Record<string, unknown>>)[specifier];
    };

    try {
        const instantiate = new Function(
            'module',
            'exports',
            'require',
            `"use strict";\n${source}${boundedSourceUrl(input.identity)}`,
        ) as (module: { exports: unknown }, exports: unknown, require: (specifier: string) => unknown) => void;
        instantiate(module, exports, requireHostModule);
    } catch (error) {
        if (error instanceof PluginUiCommonJsEvaluationError) throw error;
        fail({
            code: 'module_instantiation_failed',
            identity: input.identity,
            requestedExport: input.requestedExport,
        });
    }

    const namespace = module.exports;
    const exported = namespace && (typeof namespace === 'object' || typeof namespace === 'function')
        ? Reflect.get(namespace, input.requestedExport)
        : undefined;
    if (typeof exported !== 'function') {
        fail({
            code: 'invalid_executable_export',
            identity: input.identity,
            requestedExport: input.requestedExport,
        });
    }
    return exported as (...args: never[]) => unknown;
}
