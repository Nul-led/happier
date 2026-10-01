/** The browser locator grammar shared by automation and human-facing action references. */
export type ParsedLocator =
  | Readonly<{ strategy: 'role'; role: string; name?: string }>
  | Readonly<{ strategy: 'text'; text: string }>
  | Readonly<{ strategy: 'testid'; testId: string }>
  | Readonly<{ strategy: 'css'; selector: string }>;

const ROLE_NAME_PATTERN = /^([A-Za-z][\w-]*)(?:\[name=(?:"([^"]*)"|'([^']*)'|([^\]]*))\])?$/u;

function stripPrefix(input: string, prefix: string): string | null {
  return input.startsWith(prefix) ? input.slice(prefix.length) : null;
}

export function parseLocator(rawInput: string): ParsedLocator {
  const input = rawInput.trim();
  const roleBody = stripPrefix(input, 'role=');
  if (roleBody !== null) {
    const match = ROLE_NAME_PATTERN.exec(roleBody.trim());
    if (match) {
      const name = match[2] ?? match[3] ?? match[4];
      return name !== undefined && name.length > 0
        ? { strategy: 'role', role: match[1].toLowerCase(), name }
        : { strategy: 'role', role: match[1].toLowerCase() };
    }
    return { strategy: 'role', role: roleBody.trim().toLowerCase() };
  }
  const textBody = stripPrefix(input, 'text=');
  if (textBody !== null) return { strategy: 'text', text: unquote(textBody.trim()) };
  const testIdBody = stripPrefix(input, 'data-testid=') ?? stripPrefix(input, 'testid=');
  if (testIdBody !== null) return { strategy: 'testid', testId: unquote(testIdBody.trim()) };
  return { strategy: 'css', selector: input };
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  }
  return value;
}
