/**
 * The launchd override database's enable state for `label`, from `launchctl print-disabled
 * <domain-target>` ("Prints the list of disabled services"; `launchctl disable` persists across
 * boots, and the plist `Disabled` key is no longer where launchd keeps it). Lines read
 * `"<label>" => disabled|enabled` (older releases print `true|false`, `true` meaning disabled).
 * A label the database does not list starts at load as its definition says: Happier writes no
 * `Disabled` key, so that is enabled. `null` only when there is no output to read.
 */
export function readLaunchdServiceEnabled(params: Readonly<{ output: string | null; label: string }>): boolean | null {
  if (params.output === null) return null;
  for (const line of String(params.output).split(/\r?\n/u)) {
    const match = /^\s*"([^"]+)"\s*=>\s*(disabled|enabled|true|false)\s*$/iu.exec(line);
    if (!match || match[1] !== params.label) continue;
    const state = String(match[2]).toLowerCase();
    return state === 'enabled' || state === 'false';
  }
  return true;
}
