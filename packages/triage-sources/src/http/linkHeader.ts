/**
 * RFC 8288 `Link` header parsing, shared by the forge sources whose APIs paginate that
 * way.
 *
 * The header is a provider-published standard rather than a per-forge rule, so it is
 * parsed once. What the parsed `next` means, and whether it may be followed, stays with
 * each source: this module resolves no URL, admits no origin, and asserts nothing about
 * pagination geometry.
 *
 * `link-value`s are separated only by the commas BETWEEN them, so the split looks ahead
 * for the next `<`. Splitting on every comma loses a next page whose URL carries a
 * literal comma in its query.
 */

const LINK_VALUE_SEPARATOR = /,(?=\s*<)/u;
const LINK_VALUE = /^\s*<([^>]+)>\s*;\s*(.+)$/u;
const REL_PARAMETER = /(?:^|;)\s*rel\s*=\s*"?([^";]+)"?/u;

export type ForgeLinkHeaderParseResult =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'malformed' }>
  | Readonly<{ kind: 'parsed'; links: Readonly<Record<string, string>> }>;

/**
 * Parses one `Link` header value into its lower-cased `rel` → URL map.
 *
 * Absence and malformed provider evidence stay distinct so a pagination consumer
 * cannot turn syntax it failed to understand into a clean end-of-collection claim.
 */
export function parseForgeLinkHeader(
  value: string | null | undefined,
): ForgeLinkHeaderParseResult {
  if (value === undefined || value === null || value.trim() === '') {
    return Object.freeze({ kind: 'absent' });
  }

  const links: Record<string, string> = {};
  for (const section of value.split(LINK_VALUE_SEPARATOR)) {
    const linkValue = LINK_VALUE.exec(section);
    if (linkValue === null) return Object.freeze({ kind: 'malformed' });
    const url = linkValue[1]?.trim();
    const parameters = linkValue[2];
    if (url === undefined || url === '' || parameters === undefined) {
      return Object.freeze({ kind: 'malformed' });
    }
    const relationValue = REL_PARAMETER.exec(parameters)?.[1]?.trim().toLowerCase();
    if (relationValue === undefined || relationValue === '') {
      return Object.freeze({ kind: 'malformed' });
    }
    for (const rel of relationValue.split(/\s+/u)) {
      // A duplicated relation leaves two possible provider frontiers. Reject the
      // header rather than making a local choice the provider did not authorize.
      if (rel in links) return Object.freeze({ kind: 'malformed' });
      links[rel] = url;
    }
  }
  return Object.freeze({ kind: 'parsed', links: Object.freeze(links) });
}

/** Reads the `Link` response header under any casing, trimmed, or `null`. */
export function readForgeLinkHeaderValue(
  headers: Readonly<Record<string, string>>,
): string | null {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'link');
  const value = entry?.[1]?.trim();
  return value === undefined || value === '' ? null : value;
}
