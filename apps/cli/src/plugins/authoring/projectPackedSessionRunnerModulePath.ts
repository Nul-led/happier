import { posix } from 'node:path';

const PACKED_ESM_EXTENSIONS = new Set(['.js', '.mjs']);

/** The publisher and retained reader share one portable module projection. */
export function projectPackedSessionRunnerModulePath(params: Readonly<{
  daemonEntrypoint: string;
  locatorModule: string;
}>): string {
  const daemonPath = params.daemonEntrypoint.replaceAll('\\', '/').replace(/^\.\//u, '');
  const daemonExtension = posix.extname(daemonPath).toLowerCase();
  if (!PACKED_ESM_EXTENSIONS.has(daemonExtension)) {
    throw new Error('Code-defined plugin daemon entrypoint must use .js or .mjs for ESM packing');
  }
  const locatorPath = params.locatorModule.replace(/^\.\//u, '');
  const locatorExtension = posix.extname(locatorPath).toLowerCase();
  const outputExtension = locatorExtension || daemonExtension;
  if (!PACKED_ESM_EXTENSIONS.has(outputExtension) || outputExtension !== daemonExtension) {
    throw new Error(
      `Session runner module '${params.locatorModule}' must use the packed daemon extension '${daemonExtension}'`,
    );
  }
  return posix.join(
    posix.dirname(daemonPath),
    locatorExtension ? locatorPath : `${locatorPath}${daemonExtension}`,
  );
}
