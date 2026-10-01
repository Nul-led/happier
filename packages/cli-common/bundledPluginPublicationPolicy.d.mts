export declare const REQUIRED_BUNDLED_PLUGIN_PACKAGES: readonly string[];
export declare const BUNDLED_PLUGIN_PUBLICATION_FAILURES_RELATIVE_PATH: '.project/tmp/bundled-plugin-publication/failures.json';
export declare const BUNDLED_PLUGIN_PUBLICATION_DIAGNOSTIC_CODES: readonly [
  'plugin_package_build_failed', 'plugin_manifest_invalid', 'plugin_ui_artifact_invalid',
];
export type BundledPluginPublicationDiagnosticCode = (typeof BUNDLED_PLUGIN_PUBLICATION_DIAGNOSTIC_CODES)[number];
export declare function isRequiredBundledPluginPackage(packageName: string): boolean;
export declare function parseBundledPluginPublicationFailures(raw: string): readonly Readonly<{
  packageName: string;
  pluginId: string;
  diagnostic: Readonly<{ code: BundledPluginPublicationDiagnosticCode; message: string }>;
}>[];
export declare function assertHostCanExcludeBundledPlugin(repoRoot: string, packageName: string, originalError?: unknown): void;
