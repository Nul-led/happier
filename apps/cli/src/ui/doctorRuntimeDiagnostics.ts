import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { projectPath } from '@/projectPath';
import { isEmbeddedBunBundlePath } from '@/packagedRuntime/js/isEmbeddedBunBundlePath';
import { resolveRunningCliRuntimeIdentity } from '@/packagedRuntime/resolveRunningCliRuntimeIdentity';
import { getRuntime, type Runtime } from '@/utils/runtime';

export type DoctorRuntimeDiagnostics = Readonly<{
  runtime: Runtime;
  runtimeVersion: string;
  nodeCompatibilityVersion: string | null;
  isEmbeddedBundle: boolean;
  projectRoot: string;
  wrapperPath: string | null;
  cliEntrypointPath: string | null;
  wrapperExists: boolean | null;
  cliEntrypointExists: boolean | null;
}>;

export function buildDoctorRuntimeDiagnostics(params?: Readonly<{
  runtime?: Runtime;
  processVersion?: string;
  bunVersion?: string | null;
  nodeVersion?: string | null;
  projectRoot?: string;
  moduleUrl?: string;
  exists?: (path: string) => boolean;
}>): DoctorRuntimeDiagnostics {
  const runtime = params?.runtime ?? getRuntime();
  const processVersion = String(params?.processVersion ?? process.version ?? '').trim();
  const bunVersion = typeof params?.bunVersion === 'string'
    ? params.bunVersion.trim() || null
    : (typeof process.versions?.bun === 'string' ? process.versions.bun.trim() || null : null);
  const nodeVersion = typeof params?.nodeVersion === 'string'
    ? params.nodeVersion.trim() || null
    : (typeof process.versions?.node === 'string' ? process.versions.node.trim() || null : null);
  const resolvedProjectRoot = String(params?.projectRoot ?? projectPath()).trim();
  const exists = params?.exists ?? existsSync;
  const isEmbeddedBundle = runtime === 'bun' && isEmbeddedBunBundlePath(resolvedProjectRoot);

  if (isEmbeddedBundle) {
    return {
      runtime,
      runtimeVersion: bunVersion ?? processVersion,
      nodeCompatibilityVersion: processVersion || (nodeVersion ? `v${nodeVersion}` : null),
      isEmbeddedBundle,
      projectRoot: resolvedProjectRoot,
      wrapperPath: null,
      cliEntrypointPath: null,
      wrapperExists: null,
      cliEntrypointExists: null,
    };
  }

  const wrapperPath = join(resolvedProjectRoot, 'bin', 'happier.mjs');
  const cliEntrypointPath = resolveRunningCliRuntimeIdentity(params?.moduleUrl ?? import.meta.url).entrypoint;

  return {
    runtime,
    runtimeVersion: runtime === 'bun' ? (bunVersion ?? processVersion) : processVersion,
    nodeCompatibilityVersion: processVersion || (nodeVersion ? `v${nodeVersion}` : null),
    isEmbeddedBundle,
    projectRoot: resolvedProjectRoot,
    wrapperPath,
    cliEntrypointPath,
    wrapperExists: exists(wrapperPath),
    cliEntrypointExists: cliEntrypointPath ? exists(cliEntrypointPath) : null,
  };
}

export function formatDoctorRuntimeLabel(diagnostics: DoctorRuntimeDiagnostics): string {
  if (diagnostics.runtime === 'bun') {
    const suffix = diagnostics.isEmbeddedBundle ? ' (embedded binary)' : '';
    return `Bun ${diagnostics.runtimeVersion}${suffix}`;
  }
  if (diagnostics.runtime === 'deno') return `Deno ${diagnostics.runtimeVersion}`;
  if (diagnostics.runtime === 'node') return `Node.js ${diagnostics.runtimeVersion}`;
  return diagnostics.runtimeVersion ? `Unknown runtime ${diagnostics.runtimeVersion}` : 'Unknown runtime';
}

export function formatDoctorSpawnPathLabel(path: string | null): string {
  return path ? path : 'embedded in binary';
}
