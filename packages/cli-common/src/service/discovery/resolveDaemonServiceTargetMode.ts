/** Explicit persisted declarations win; filenames describe only legacy definitions. */
export function resolveDaemonServiceTargetMode(
  declaredMode: string | null | undefined,
  legacyMode: 'pinned' | 'default-following',
): 'pinned' | 'default-following' {
  const mode = String(declaredMode ?? '').trim().toLowerCase();
  return mode === 'pinned' || mode === 'default-following' ? mode : legacyMode;
}
