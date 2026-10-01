import { z } from 'zod';

/** Canonical origin only: no credentials, path, query, fragment or trailing slash. */
export const CanonicalHttpOriginSchema = z.string().superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value) throw new Error();
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Expected a canonical http/https origin without credentials.' });
  }
});
