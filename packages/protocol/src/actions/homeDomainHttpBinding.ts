import type { z } from 'zod';

export type HomeDomainHttpRequestV1 = Readonly<{
  method: string;
  path: string;
  body: unknown | undefined;
}>;

function appendQueryValue(query: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    query.append(key, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(query, key, item);
    return;
  }
  throw new TypeError(`Home-domain GET field cannot be encoded in a query: ${key}`);
}

/**
 * Bind one already-declared Home Action row to its exact HTTP request.
 *
 * The Action input stays the single public intent contract. Path parameters are
 * consumed by name, GET remainder becomes a query, and mutation remainder stays
 * a body. Existing unparameterized POST rows therefore retain their byte-level
 * shape while REST-shaped families avoid a second client-owned route table.
 */
export function bindHomeDomainHttpRequestV1(params: Readonly<{
  transport: Readonly<{ method: string; path: string }>;
  inputSchema: z.ZodTypeAny;
  input: unknown;
}>): HomeDomainHttpRequestV1 {
  const parsed = params.inputSchema.parse(params.input);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Home-domain Action input must be an object');
  }
  const remaining: Record<string, unknown> = { ...parsed as Record<string, unknown> };
  const path = params.transport.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, key: string) => {
    const value = remaining[key];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`Home-domain Action input is missing path field: ${key}`);
    }
    delete remaining[key];
    return encodeURIComponent(String(value));
  });

  if (params.transport.method.toUpperCase() === 'GET') {
    delete remaining.v;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(remaining)) appendQueryValue(query, key, value);
    const encoded = query.toString();
    return {
      method: params.transport.method,
      path: encoded.length > 0 ? `${path}?${encoded}` : path,
      body: undefined,
    };
  }

  return { method: params.transport.method, path, body: remaining };
}
