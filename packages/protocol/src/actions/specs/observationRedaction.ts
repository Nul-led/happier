import type { PreNormalizedActionSpec } from '../actionSpecs.js';

/**
 * Observation redaction for Action inputs that legitimately carry write-only
 * material.
 *
 * `projectObservationInput` is the canonical seam the executor uses before it
 * hands an invocation to `observeActionExecution` — which reaches every
 * installed plugin's `action.execute.after` hook and the durable approval
 * record. An Action whose strict input contains a managed IdP client secret,
 * a GitHub App private key or a one-time result handle must therefore drop
 * those exact fields here rather than rely on each observer to behave.
 *
 * The projection is deliberately field-shaped, not a value scan: the Action's
 * own schema already names which fields are secret, so a heuristic redactor
 * would be a second, weaker decision about the same fact.
 */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Drops the named dot-paths from an observed Action input, preserving every
 * other field so the observation still explains what was attempted.
 *
 * A path whose parent is absent or is not an object is left alone: the
 * executor validated the input against the Action schema before this runs, so
 * a missing optional secret arm is ordinary rather than a redaction failure.
 */
export function redactObservationInputPaths(
  ...paths: readonly [string, ...string[]]
): NonNullable<PreNormalizedActionSpec['projectObservationInput']> {
  return (input: unknown) => {
    if (!isPlainObject(input)) return {};
    const redactPath = (
      value: Readonly<Record<string, unknown>>,
      segments: readonly string[],
    ): Readonly<Record<string, unknown>> => {
      const [head, ...rest] = segments;
      if (head === undefined || !(head in value)) return value;
      if (rest.length === 0) {
        const { [head]: _redacted, ...safe } = value;
        return safe;
      }
      const child = value[head];
      if (!isPlainObject(child)) return value;
      return { ...value, [head]: redactPath(child, rest) };
    };
    return paths.reduce<Readonly<Record<string, unknown>>>(
      (value, path) => redactPath(value, path.split('.')),
      input,
    );
  };
}
