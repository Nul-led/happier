import { resolvePypiWheelAssetHostCompatibility } from './pypiWheelAsset/platform.js';

export type ManagedDependencyReleaseDeclaration = Readonly<{
  assetNamePrefix: string;
  targetByPlatform: Readonly<Record<string, string>>;
}>;

export type ManagedDependencyReleaseAsset = Readonly<{
  name: string;
  url: string;
  digest: string | null;
  tag: string | null;
  version: string | null;
}>;

export function selectManagedDependencyReleaseAsset(
  release: unknown,
  declaration: ManagedDependencyReleaseDeclaration,
): ManagedDependencyReleaseAsset {
  const platformKey = process.platform === 'linux'
    ? `${process.platform}-${process.arch}-${resolvePypiWheelAssetHostCompatibility().linuxLibc === 'glibc' ? 'gnu' : 'musl'}`
    : `${process.platform}-${process.arch}`;
  const target = declaration.targetByPlatform[platformKey];
  if (!target) throw new Error(`Unsupported ${declaration.assetNamePrefix} platform: ${process.platform}/${process.arch}`);
  const parsed = release && typeof release === 'object' ? release as { tag_name?: unknown; assets?: unknown } : {};
  const tag = typeof parsed.tag_name === 'string' && parsed.tag_name.trim() ? parsed.tag_name.trim() : null;
  const version = tag ? /^v?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.exec(tag)?.[1] ?? null : null;
  const extension = process.platform === 'win32' ? '.zip' : '.tar.gz';
  const assets = Array.isArray(parsed.assets) ? parsed.assets.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as { name?: unknown; browser_download_url?: unknown; digest?: unknown };
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const url = typeof raw.browser_download_url === 'string' ? raw.browser_download_url.trim() : '';
    return name && url ? [{ name, url, digest: typeof raw.digest === 'string' ? raw.digest.trim() : null }] : [];
  }) : [];
  const preferredName = version ? `${declaration.assetNamePrefix}-${version}-${target}${extension}` : null;
  const selected = (preferredName ? assets.find((asset) => asset.name === preferredName) : undefined)
    ?? assets.find((asset) => asset.name.includes(target) && asset.name.endsWith(extension));
  if (!selected) throw new Error(`No ${declaration.assetNamePrefix} release asset found for ${target}`);
  return { ...selected, tag, version };
}
