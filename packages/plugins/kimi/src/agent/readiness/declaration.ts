/**
 * Provider-owned readiness data for the Kimi system tool entry.
 *
 * Selection between current Kimi Code and the superseded Python `kimi-cli` is
 * by observed command behavior only. Retired `kimi-cli` releases sort above
 * current Kimi Code releases, and a legacy install may own the `kimi` name
 * while answering `kimi acp` without the `migrate` command surface — so the
 * generic system-tool resolution owner probes every runnable `kimi` candidate
 * with the ACP initialize fingerprint below plus `migrate --help`, selects the
 * first current fingerprint, and otherwise fails with the guidance below.
 * `kimi-cli` names only inform the legacy diagnostic; they are never granted
 * or launched. There is deliberately no version field anywhere in this shape.
 */
export const KIMI_SYSTEM_TOOL_READINESS = Object.freeze({
  acpProbeArgs: Object.freeze(['acp']),
  currentFingerprint: Object.freeze({
    loadSession: true,
    sessionCapabilities: Object.freeze(['list', 'resume', 'close', 'delete', 'fork']),
    absentSessionCapabilities: Object.freeze([]),
    mcpHttp: true,
    mcpSse: true,
  }),
  legacyFingerprint: Object.freeze({
    loadSession: true,
    sessionCapabilities: Object.freeze(['list', 'resume']),
    absentSessionCapabilities: Object.freeze(['close', 'delete', 'fork']),
    mcpHttp: true,
    mcpSse: false,
  }),
  commandSurfaceArgs: Object.freeze(['migrate', '--help']),
  legacyExecutableNames: Object.freeze(['kimi-cli']),
  legacyGuidance:
    'Install the current Kimi Code CLI, then run `kimi migrate` manually. Happier never runs migration automatically.',
  unidentifiedGuidance: 'Install the current Kimi Code CLI and retry.',
});
