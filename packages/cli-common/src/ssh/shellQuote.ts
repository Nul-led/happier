export function safeBashSingleQuote(value: string): string {
  const raw = String(value ?? '');
  if (raw === '') return "''";
  return `'${raw.replaceAll("'", `'\"'\"'`)}'`;
}

/** Expand only the remote home prefix; all remaining path bytes stay literal. */
export function quoteRemotePathWithHomeExpansion(path: string): string {
  if (path === '$HOME') return '"$HOME"';
  if (path.startsWith('$HOME/')) {
    return `"$HOME"/${safeBashSingleQuote(path.slice('$HOME/'.length))}`;
  }
  return safeBashSingleQuote(path);
}
