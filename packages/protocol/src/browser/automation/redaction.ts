import { isRecord } from '../../common/records.js';
import { normalizeTelemetryDataKey } from '../../common/sensitiveKeys.js';
import { isForbiddenBrowserEgressKey } from '../diagnostics/egress/keyRejection.js';
import { stripUrlValuesInString } from '../diagnostics/egress/url.js';

// Matches BrowserElementPickedV1's accessibleName convention. This is presentation only.
export const BROWSER_AUTOMATION_TARGET_LABEL_MAX_LENGTH = 512;

export function redactBrowserAutomationTargetLabel(value: string): string | undefined {
  const label = stripUrlValuesInString(value).replace(/\s+/gu, ' ').trim()
    .slice(0, BROWSER_AUTOMATION_TARGET_LABEL_MAX_LENGTH);
  return label || undefined;
}

function compactKey(key: string): string {
  return normalizeTelemetryDataKey(key).replaceAll('-', '');
}

function lengthKeyFor(key: string): string | null {
  const compact = compactKey(key);
  if (compact === 'text' || compact === 'typedtext' || compact === 'value' || compact === 'expression') {
    return `${compact}Length`;
  }
  return null;
}

type BrowserAutomationDetailRedactionOptions = Readonly<{
  preserveLocatorValues: boolean;
}>;

function locatorNeedsRedaction(value: unknown): boolean {
  if (typeof value === 'string') return stripUrlValuesInString(value) !== value;
  if (Array.isArray(value)) return value.some(locatorNeedsRedaction);
  if (isRecord(value)) return Object.entries(value).some(([key, nested]) => isForbiddenBrowserEgressKey(key) || locatorNeedsRedaction(nested));
  return false;
}

function redactRecord(
  value: Record<string, unknown>,
  depth: number,
  options: BrowserAutomationDetailRedactionOptions,
): Record<string, unknown> {
  if (!options.preserveLocatorValues && depth > 8) {
    return { truncated: true };
  }

  const redacted: Record<string, unknown> = {};
  let projectedTruncated = false;
  for (const [key, nested] of Object.entries(value)) {
    const compact = compactKey(key);
    if (isForbiddenBrowserEgressKey(key)) {
      continue;
    }

    if (compact === 'selector' || compact === 'locator' || compact === 'cssselector') {
      if (!options.preserveLocatorValues) {
        redacted[`${compact}Available`] = typeof nested === 'string' ? nested.length > 0 : isRecord(nested);
      } else if (locatorNeedsRedaction(nested)) {
        // A sanitized locator would select a different target. Omit it rather than lie about
        // executable data, while retaining the same URL/secret egress floor as every result.
        redacted[`${compact}Available`] = false;
        projectedTruncated = true;
      } else {
        redacted[key] = redactBrowserAutomationDetails(nested, depth + 1, options);
      }
      continue;
    }

    if (typeof nested === 'string') {
      const lengthKey = lengthKeyFor(key);
      if (lengthKey && !options.preserveLocatorValues) {
        redacted[lengthKey] = nested.length;
        continue;
      }
      // L2-3: URL redaction classifies by VALUE SHAPE — every string is inspected regardless of
      // its key, so a token URL under `href`/`src`/an arbitrary key never reaches the timeline.
      const safeValue = stripUrlValuesInString(nested);
      redacted[key] = options.preserveLocatorValues ? safeValue : safeValue.slice(0, 256);
      if (!options.preserveLocatorValues && safeValue.length > 256) projectedTruncated = true;
      continue;
    }

    redacted[key] = redactBrowserAutomationDetails(nested, depth + 1, options);
    if (!options.preserveLocatorValues && Array.isArray(nested) && nested.length > 25) projectedTruncated = true;
  }
  if (projectedTruncated) redacted.truncated = true;
  return redacted;
}

function redactBrowserAutomationDetails(
  value: unknown,
  depth: number,
  options: BrowserAutomationDetailRedactionOptions,
): unknown {
  if (Array.isArray(value)) {
    const items = options.preserveLocatorValues ? value : value.slice(0, 25);
    return items.map((item) => redactBrowserAutomationDetails(item, depth + 1, options));
  }
  if (isRecord(value)) {
    return redactRecord(value, depth, options);
  }
  if (typeof value === 'string') {
    const safeValue = stripUrlValuesInString(value);
    return options.preserveLocatorValues ? safeValue : safeValue.slice(0, 256);
  }
  return value;
}

export function redactBrowserAutomationTimelineDetails(value: unknown, depth = 0): unknown {
  return redactBrowserAutomationDetails(value, depth, { preserveLocatorValues: false });
}

export function redactBrowserAutomationActionResultDetails(value: unknown): unknown {
  return redactBrowserAutomationDetails(value, 0, { preserveLocatorValues: true });
}
