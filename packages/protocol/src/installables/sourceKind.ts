import { z } from 'zod';

export const InstallableSourceKindSchema = z.enum([
  'github_release_binary',
  'managed_package',
  'managed_pypi_wheel_asset',
  'pinned_archive',
  'vendor_recipe',
  'manual_only',
]);
export type InstallableSourceKind = z.infer<typeof InstallableSourceKindSchema>;

export const ManagedPypiWheelAssetPlatformSchema = z.enum([
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64',
]);

export const ManagedPypiWheelAssetInstallConsentSchema = z.enum(['host_managed_required']);

export const ManagedPypiWheelAssetAutoUpdateModeSchema = z.enum(['off', 'notify', 'auto']);

export const GitHubReleaseBinaryInstallableSourceSchema = z.object({
  kind: z.literal('github_release_binary'),
  repo: z.string().trim().regex(/^[^/\s]+\/[^/\s]+$/),
  distTag: z.string().trim().min(1).optional(),
}).strict();

export const ManagedPackageInstallableSourceSchema = z.object({
  kind: z.literal('managed_package'),
  packageName: z.string().trim().min(1),
  packageManager: z.literal('managed_js_runtime'),
  version: z.string().trim().min(1).optional(),
}).strict();

export const ManagedPypiWheelAssetInstallableSourceSchema = z.object({
  kind: z.literal('managed_pypi_wheel_asset'),
  distribution: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
  versionSpecifier: z.string().trim().min(1),
  assetPathByPlatform: z.record(
    z.string(),
    z.string().trim().min(1).refine((value) => {
      if (value.startsWith('/') || value.startsWith('\\')) return false;
      return !value.split(/[\\/]+/).some((segment) => segment === '' || segment === '.' || segment === '..');
    }, 'Asset path must be a relative exact wheel member path'),
  ).superRefine((value, ctx) => {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one platform asset path is required',
      });
    }
    for (const key of keys) {
      if (!ManagedPypiWheelAssetPlatformSchema.safeParse(key).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Unsupported managed PyPI wheel asset platform',
        });
      }
    }
  }),
  executable: z.literal(true),
  compatibilityProbe: z.string().trim().min(1).optional(),
  installConsent: ManagedPypiWheelAssetInstallConsentSchema,
  autoUpdateMode: ManagedPypiWheelAssetAutoUpdateModeSchema,
  trustedPublisher: z.string().trim().min(1).optional(),
  maxWheelSizeBytes: z.number().int().positive().optional(),
  maxAssetSizeBytes: z.number().int().positive().optional(),
}).strict();

export const PinnedArchivePlatformSchema = ManagedPypiWheelAssetPlatformSchema;

export const PinnedArchiveInstallableAssetSchema = z.object({
  archiveUrl: z.string().url().refine((value) => value.startsWith('https://'), 'Pinned archive URL must use HTTPS'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  executableSubpath: z.string().trim().min(1).refine((value) => {
    if (/^(?:[A-Za-z]:)?[\\/]/.test(value)) return false;
    return value.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  }, 'Pinned archive executable path must be a safe relative path'),
  args: z.array(z.string()).optional(),
}).strict();
export type PinnedArchiveInstallableAsset = z.infer<typeof PinnedArchiveInstallableAssetSchema>;

export const PinnedArchiveAssetsByPlatformSchema = z.object({
  'darwin-arm64': PinnedArchiveInstallableAssetSchema.optional(),
  'linux-x64': PinnedArchiveInstallableAssetSchema.optional(),
  'linux-arm64': PinnedArchiveInstallableAssetSchema.optional(),
  'win32-x64': PinnedArchiveInstallableAssetSchema.optional(),
  'win32-arm64': PinnedArchiveInstallableAssetSchema.optional(),
}).strict().refine((assets) => Object.values(assets).some(Boolean), 'Pinned archive source requires at least one platform asset');

/**
 * One immutable, digest-pinned per-platform archive. The publishing artifact is
 * pinned, so there is no version discovery: the declared `version` is both the
 * installed and the available version.
 */
export const PinnedArchiveInstallableSourceSchema = z.object({
  kind: z.literal('pinned_archive'),
  version: z.string().trim().min(1),
  assetsByPlatform: PinnedArchiveAssetsByPlatformSchema,
}).strict();

export const VendorRecipeInstallableSourceSchema = z.object({
  kind: z.literal('vendor_recipe'),
  recipeId: z.string().trim().min(1),
  commandsPreview: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const ManualOnlyInstallableSourceSchema = z.object({
  kind: z.literal('manual_only'),
  setupUrl: z.string().trim().url().optional(),
  instructionsKey: z.string().trim().min(1).optional(),
}).strict();

export const InstallableSourceSchema = z.discriminatedUnion('kind', [
  GitHubReleaseBinaryInstallableSourceSchema,
  ManagedPackageInstallableSourceSchema,
  ManagedPypiWheelAssetInstallableSourceSchema,
  PinnedArchiveInstallableSourceSchema,
  VendorRecipeInstallableSourceSchema,
  ManualOnlyInstallableSourceSchema,
]);
export type InstallableSource = z.infer<typeof InstallableSourceSchema>;
