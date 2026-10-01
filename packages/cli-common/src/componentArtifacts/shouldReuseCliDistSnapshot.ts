import cliDistBuildManifest from '../../cliDistBuildManifest.cjs';

export async function shouldReuseCliDistSnapshot(params: Readonly<{
  distEntrypointPath: string;
  requiredInputFingerprint?: string;
}>): Promise<boolean> {
  const requiredInputFingerprint = String(params.requiredInputFingerprint ?? '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(requiredInputFingerprint)) return false;
  const distManifest = cliDistBuildManifest.readCliDistBuildManifest(params.distEntrypointPath);
  return distManifest.ok
    && distManifest.manifest?.inputFingerprint === requiredInputFingerprint;
}
