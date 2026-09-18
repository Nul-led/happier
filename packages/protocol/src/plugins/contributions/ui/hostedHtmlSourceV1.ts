import { z } from 'zod';

/**
 * Leaves headroom beneath WebView2's 2 MiB total HTML-string boundary for the
 * host-composed CSP/bootstrap shell around the caller's source document.
 */
export const MAX_PLUGIN_HOSTED_HTML_SOURCE_UTF8_BYTES_V1 = 1024 * 1024;

const UTF8_ENCODER = new TextEncoder();

/** Closed source data; frame isolation and Host API authority belong to the mounted host. */
export const PluginHostedHtmlSourceV1Schema = z.object({
  kind: z.literal('html'),
  html: z.string().refine(
    (value) => UTF8_ENCODER.encode(value).byteLength <= MAX_PLUGIN_HOSTED_HTML_SOURCE_UTF8_BYTES_V1,
    'Hosted HTML exceeds the inline document UTF-8 byte limit.',
  ),
}).strict();
export type PluginHostedHtmlSourceV1 = z.infer<typeof PluginHostedHtmlSourceV1Schema>;
