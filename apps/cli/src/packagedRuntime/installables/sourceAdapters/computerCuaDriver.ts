import { installPinnedArchive, resolveInstalledPinnedArchiveExecutable, type PinnedArchiveAsset } from './pinnedArchive';
import { ARCHIVE_DOWNLOAD_INSTALLABLE_SOURCE_KIND, type ArchiveDownloadInstallableAdapter } from './browserChromium';

export const COMPUTER_CUA_DRIVER_INSTALLABLE_KEY = 'computer-cua-driver';
export const COMPUTER_CUA_DRIVER_VERSION = '0.31.0';

// MIT native core only, pinned to cua-driver-rs-v0.31.0 (5272e492d61b96caf08e3bf434d91126c1f3dccc).
// Binary archives include required companion libraries, but no optional perception models.
const releaseBase = 'https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.31.0';
const nativeAssets: Readonly<Record<string, Readonly<{ name: string; sha256: string }>>> = {
  'darwin-x64': { name: 'darwin-universal-binary.tar.gz', sha256: '06cd80b153bdf046dc067fb593e0fc648e780afa37a902ca0515ac25f32f9a4f' },
  'darwin-arm64': { name: 'darwin-universal-binary.tar.gz', sha256: '06cd80b153bdf046dc067fb593e0fc648e780afa37a902ca0515ac25f32f9a4f' },
  'linux-x64': { name: 'linux-x86_64-binary.tar.gz', sha256: '59d7d027ad0f24410e88e0cf239a04f8e724de400b5c418fab259f3b5c285ff1' },
  'linux-arm64': { name: 'linux-arm64-binary.tar.gz', sha256: 'a960ffe07869846dde1e2a193c7c3236d530f31631b035c637b7dd701dd6dc6f' },
  'win32-x64': { name: 'windows-x86_64-binary.zip', sha256: '461c7d4acd12685ab777fa4a3800e25f75d2f06e8a67ab7a1778701eb25e6728' },
  'win32-arm64': { name: 'windows-arm64-binary.zip', sha256: 'a65898dfaee3fe7f78671ed2db0b7dc06a3c297ab856a8b70bf7a8c69bf59b95' },
};

function resolveAsset(platform: string, arch: string): PinnedArchiveAsset | null {
  const asset = nativeAssets[`${platform}-${arch}`];
  return asset ? {
    archiveUrl: `${releaseBase}/cua-driver-rs-${COMPUTER_CUA_DRIVER_VERSION}-${asset.name}`,
    sha256: asset.sha256,
    executableSubpath: platform === 'win32' ? 'cua-driver.exe' : 'cua-driver',
  } : null;
}

export function getComputerCuaDriverArchiveDownloadInstallableAdapter(): ArchiveDownloadInstallableAdapter {
  return {
    key: COMPUTER_CUA_DRIVER_INSTALLABLE_KEY,
    sourceKind: ARCHIVE_DOWNLOAD_INSTALLABLE_SOURCE_KIND,
    async resolveInstalledExecutable(params = {}) {
      const platform = params.platform ?? process.platform;
      const asset = resolveAsset(platform, params.arch ?? process.arch);
      return asset ? await resolveInstalledPinnedArchiveExecutable({
        installId: COMPUTER_CUA_DRIVER_INSTALLABLE_KEY,
        executableSubpath: asset.executableSubpath,
        version: COMPUTER_CUA_DRIVER_VERSION,
        platform,
      }) : null;
    },
    async installOrUpgrade(params = {}) {
      const platform = params.platform ?? process.platform;
      const asset = resolveAsset(platform, params.arch ?? process.arch);
      if (!asset) return { ok: false, errorMessage: `Unsupported native computer driver platform: ${platform}/${params.arch ?? process.arch}` };
      const result = await installPinnedArchive({ installId: COMPUTER_CUA_DRIVER_INSTALLABLE_KEY, version: COMPUTER_CUA_DRIVER_VERSION, asset, platform });
      return result.ok ? { ok: true, executablePath: result.executablePath, pinnedVersion: result.version, integrityDigest: result.integrityDigest } : result;
    },
  };
}
